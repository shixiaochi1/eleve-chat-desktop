# 事故报告：插件黑名单致画布按钮消失 + 群聊异常（r121，2026-10-13）

> 现象：安装版（E:\Eleve，9-17 r118 包）主窗口左侧图标栏**画布按钮消失**、群聊/私聊一直「加载中」，重启不复现修复。
> 结论：**非代码 bug、非安装包缺文件、非后端故障**——运行时持久化数据（localStorage 插件黑名单）被批量写入所致。

## 1. 根因

安装版页面 origin（`http://tauri.localhost`）的 localStorage 中：

```json
eleve.plugins.disabled = ["canvas","hello","bots"]
```

三个 bundled 插件（`src/contrib/plugins.ts` 的 `BUNDLED`）全部被禁用：

- `canvas` 被禁 → `plugins/canvas/plugin.tsx` 不执行 `ctx.register('iconBar.action')` → **画布按钮不渲染**；
- `bots` 被禁 → 群聊入口/rooms 首拉链路异常 → **「加载群聊…」卡死**；
- `hello` 被禁（无界面影响）。

机制：`contrib/plugins-store.ts` 的 `loadDisabled()` 读黑名单 → `initializePlugins()` 跳过 loadOne（仅 publish 记录）→ IconBar 的 `AREA_ICON_BAR_ACTION` 贡献区无 canvas 项。

## 2. 取证矩阵（排除过程）

| 嫌疑 | 实测 | 结果 |
|---|---|---|
| 后端未起/RPC 故障 | node 内置 WebSocket 直连 `ws://127.0.0.1:62447/api/ws` 发 JSON-RPC | ✅ ping/session.list/bot.rooms.list 全部正常 |
| 安装包缺 canvas 文件 | `curl /plugins/canvas/index.html` | ✅ 200（安装内置位兜底） |
| 渲染进程崩溃 | crashpad reports、renderer CPU | ✅ 无崩溃、JS 活跃 |
| HEAD 前端坏 | Edge 无头 + vite dev（CDP） | ✅ 按钮正常 |
| dist(r118) 坏 | Edge 无头 + vite preview serve dist | ✅ 按钮正常 |
| debug 壳+dist+WebView2 | debug 壳加载 24243(dist) | ✅ 按钮正常 |
| release 形态差异 | 临时 profile `inherits="release"` 编译 | ✅ 按钮正常 |
| **9-17 安装 exe 实机** | **HKLM 策略开 CDP 直连** | ❌ **`pluginsDisabled=["canvas","hello","bots"]`、按钮缺失——实锤** |

排障期间获知的附带事实：

- WebView2 已从 9 月版本升级到 **154.0.4258.62**（大版本更新），但矩阵证明它与本故障无关；
- 9-17 exe 内嵌 conf 与磁盘 conf 不同（exe 内 title="Eleve Chat"，磁盘已改 "Eleve"）——考古 exe 行为不可拿磁盘 conf 推断；
- 后端日志 `E:\Eleve\data\logs\`：9-17 17:35–21:20 有 CanvasWS 连接（画布正常使用 4 小时），**9-18 起再无 CanvasWS** → 黑名单写入时间窗 = **9-17 21:20 ~ 9-18 07:12**。

## 3. 修复（已执行）

CDP `Runtime.evaluate` 删除黑名单键并 reload：

```js
localStorage.removeItem('eleve.plugins.disabled'); location.reload();
```

验证：画布按钮回归（visible=true）、Hello/群聊图标恢复。随后重启干净正式实例（无调试端口）。

## 4. 🔴 遗留隐患（待查）

**黑名单为何被批量写入三个全禁**未查明。嫌疑方向（按优先级）：

1. 设置面板插件开关在 `records` 尚未 `publishPlugin` 时渲染为「关」，用户看到三个全关逐一点击「打开」——但 `setPluginEnabled(id, true)` 走 `disabled.delete` 不会写入，此路径**不成立**；
2. 某处代码直接调用 `setPluginEnabled(id, false)` 或直接写 `eleve.plugins.disabled`（grep dist 压缩 JS 只见 plugins-store 一处写入点，仍需对照 9-18 前的 dist 版本确认）；
3. localStorage 键被其它写入方覆盖/损坏。

**复现观测点**：若再现「插件莫名被禁」，第一时间 CDP 读该键 + 查设置面板开关渲染时序。

## 5. 方法论沉淀（复用）

1. **前端「功能消失」第一顺位查 localStorage 持久态**（origin 隔离：安装版=tauri.localhost，与 dev/浏览器互不可见）。leveldb 字节 grep「没搜到」不可信（UTF-16/compact 漏检），权威手段 = CDP `Runtime.evaluate` 直读。
2. **WebView2 开 CDP**：tauri 传 additionalBrowserArgs 时 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量被忽略（154 实测）、HKCU 策略不生效；用 `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`，值名=宿主 exe 名，值=`--remote-debugging-port=9222`；用完必须删除。
3. 零依赖 CDP 探测：node 22 内置 WebSocket 连 page 的 `webSocketDebuggerUrl`，收 `Runtime.consoleAPICalled`/`exceptionThrown` + `evaluate` 查 DOM/localStorage。脚本留存于后端仓 `scratch/cdp_probe_*.mjs`、`scratch/cdp_fix_20261013.mjs`（scratch 为 gitignore 目录，仅本机留存）。
4. release 形态等价复现：`[profile.<名>] inherits="release"` + `cargo build --profile <名>`（嵌 dist、非安装件）。
5. 本机 `Get-Process` 查不到部分进程，判进程死活用 `tasklist /FI` / `Get-CimInstance Win32_Process`。
