# ELEVE 桌面端右侧抽屉「预览系统」— Hermes 对齐深审（2026-08-28）

> 审查对象：**eleve-chat-desktop 前端**右侧抽屉预览系统（画布只是插件，不在本次范围）
> 代码基线：`main @ fb640f5`
> 对齐基准：`hermes-agent/apps/desktop`（`store/preview.ts` 352 行 + `app/right-sidebar` + `preview-artifact.tsx`）
> 涉及文件：`src/store/preview.ts`、`src/components/RightSidebarTabs.tsx`、`src/components/preview/*`（6 件）、`src/lib/preview-events.ts / preview-targets.ts / local-preview.ts / preview-reader.ts / preview-edit.ts`、`src/App.tsx`、`src/store/artifacts.ts`

---

## 一、总评

**ELEVE 桌面端的预览系统是真正按 Hermes 模型移植的（2026-08-05 起，多轮对齐），对齐度约 80%。**
单一入口、统一 target、持久化、重启状态机、console/read_preview RPC、三种渲染 Pane 都已落地且注释即契约。但有 **4 个真差距 + 2 个死链**，其中宫格模式预览黑洞和 webview 跨 tab 销毁是用户可感知的功能缺口。

### 已对齐 ✅（7 原则对照）

| Hermes 原则 | ELEVE 落地 | 证据 |
|---|---|---|
| ① One way in | ✅ 7 个调用方全走 `openPreview`，无旁路 | preview.open 工具事件 `preview-events.ts:165`；#preview/file: 链接 `StreamBlocks.tsx:179`、`ToolEntry.tsx:223`；附件 pill `AgentCardComposer.tsx:402`；文件树双击 `FileBrowserPanel.tsx:573`；artifact 卡片 `ArtifactPanel.tsx:295`；空态手动输入 `PreviewCenter.tsx:118` |
| ② 统一 PreviewTarget | ✅ `kind: url\|file\|artifact` + dataUrl | `store/preview.ts:16-31` |
| ③ 全局 tab + 持久化 | ✅ `eleve.previewTabs.v1` + `eleve.rightPane.v1`（open/tab/宽度，对齐 $rightRailActiveTabId） | `store/preview.ts:65-115`、`hooks/usePanelLayout.ts:47-91` |
| ④ source 仅元数据 | ➖ ELEVE 无 PreviewRecordSource（url/file 渲染不依赖来源；影响面小，Hermes 只用它定 renderMode 首值） | — |
| ⑤ 重开不重复 | ⚠️ 去重选中 ✅ 但**不刷新 target**（见差距 1） | `store/preview.ts:169-175` |
| ⑥ 持久化带裁剪 | ✅ `isPersistableTab` 只留 url/file（artifact 不落盘=对齐 Hermes encode 过滤）；但无 dataUrl 剥离（见死链 5） | `store/preview.ts:67-77` |
| ⑦ 生命周期集中清理 | ⚠️ tab 关闭/⌘W ✅（App:1386-1392 对齐 view.closeTab）；**artifact 清理无联动**（见差距 3） | `store/preview.ts:189-218` |

### 对齐到位的机制细节（本次逐条验证）
- 重启状态机 begin/progress/complete/fail + `restart.status==='success' && url 匹配 → preview_webview_reload`（`PreviewWebPane.tsx` restart effect ✅）
- read_preview WS RPC：`preview.read.request` → webview eval 读文本 → `preview.read.respond`；file tab 回身份提示（对齐 Hermes preview-reader）
- console 按 label 分流 + **seq 断档 → snapshot 全量补拉** + module mime 错误检测（对齐 isModuleMimeError）
- webview effect 依赖 `[tab.target.url]`：同 URL 切预览内部 tab 保留页面状态，URL 变才重建
- 渲染分发三 Pane：图片/md/文本（512KB 截断 + WindowedSourceView 200 行 chunk + 行引用 `@file:"p:s-e"`）/二进制拦截/spot editor（CodeMirror + stale-on-disk 冲突保护 + dirty 圆点）
- ArtifactPreviewPane：html→iframe srcDoc、svg→data URL、渲染/源码双模式、版本计数

---

## 二、真差距 🔴（按优先级）

### 1. `openPreview` 不刷新已存在 tab 的 target（对齐 Hermes ⑤ 缺半）
`store/preview.ts:169-175`：同 kind+url 已存在 → 只 `selectTab` + `requestPaneOpen`。
Hermes（preview.ts:216-227）re-front 时用**新 target 原位替换**："Re-opening an existing tab refreshes its target so a stale label/path can't outlive the thing it points at"。
ELEVE 后果：同名文件被移动/重命名后旧 path 存活；label 变化不更新。
**修法**：existing 分支改为 `tabs.map(t => t.id===existing.id ? {...t, target, label: labelFor(target)} : t)`，一行级。

### 2. 宫格模式预览黑洞（用户可感知）
`App.tsx:154-158`：`paneOpenRequest` 仅 `viewMode==='single'` 消费；`GridModeView` 全文 grep preview/openPreview **零命中**。
后果：宫格模式下点消息里预览链接 / agent `open_preview` 事件 → tab 静默写入 store，**UI 无任何反应**。
对照：artifactOpen 在宫格有浮层承载（App:141-143 "宫格模式无右栏语义 → 浮层由 GridModeView 内挂载承载"），preview 没有同款。
**修法**：照抄 artifact 浮层模式，GridModeView 挂轻量 PreviewCenter 浮层；或至少切单视图提示。

### 3. artifact tab 生命周期无收口（对齐 Hermes ⑦ 缺口）
Hermes `closeArtifactPreviewTabs`（preview.ts:291）在 artifact 清理时主动关闭对应预览 tab。
ELEVE：`store/artifacts.ts`（LRU prune :52、registry 清空 :233）与 preview store **零联动**（grep closeTab/preview 零命中）→ 被清理的 artifact 的预览 tab 永久残留"产物已不在注册表"空态（ArtifactPreviewPane :48-56），只能手动关。
**修法**：artifacts store prune/清空后派发事件 → preview store 关闭失配 artifactId 的 tab。

### 4. 右栏大 tab 切换销毁 webview → 页面状态丢失（同栏待遇不一致）
`App.tsx:1916` 条件渲染 `{rightTab==='preview' && <PreviewCenter/>}` → 切到 files/terminal/artifacts 即卸载 → `PreviewWebPane` cleanup `preview_webview_close`（:143-151）→ 切回**重新 create webview**（:129）→ SPA 路由/表单/滚动全丢。
对照：同一右栏里终端特意常驻 hidden 保 PTY（App:1904-1906 "shell 存活于隐藏"）；PreviewCenter:159-162 注释宣称"同 URL 切 tab 保留页面状态"仅在预览中心**内部** tab 切换成立，跨大 tab 失效——注释承诺半失效。
**修法**：preview tab 也走 terminal 的 `terminalMounted` 常驻模式（首次可见才挂载，之后 CSS hidden；Rust 侧 webview 存活），或 URL 未变时 close/create 改为 hide/show。

---

## 三、死链/幽灵 ⚠️

### 5. `PreviewTarget.dataUrl` 半接线（消费在、生产无）
消费端：`PreviewFilePane.tsx:69` `inlineDataUrl = tab.target.dataUrl` → 图片直渲染 ✅。
生产端：**全库零写入**——`local-preview.ts` 只产 url/file，无粘贴/拖拽截图路径。
即 Hermes 的"粘贴/拖拽截图即时预览"场景 ELEVE 静默缺失，字段与注释（store/preview.ts:28-30）是幽灵承诺。与画布插件 `previewUrl` 幽灵字段同款病。
**修法**：接线（截图粘贴→dataUrl target + transient 语义）或删字段注释；接线时同步给 `isPersistableTab` 加 dataUrl 剥离（Hermes encode 明确剥离防 localStorage 膨胀）。

### 6. PDF 预览缺失
Hermes：`previewKind: 'pdf'` + `isPdfFileTarget`（path/source/url 三重检测）+ decode 迁移（binary→pdf）一整套。
ELEVE：`PreviewFilePane` 无 pdf 分支（IMAGE/MARKDOWN 集合之外）→ .pdf 走 readTextFile → `isLikelyBinary` 拦截为"二进制文件"。文件树双击 PDF 无法预览。
**修法**：加 pdf 分支（readFile → blob URL → iframe），对齐 Hermes previewKind。

---

## 四、小项 🟡

- `PreviewTabBar` 关闭菜单 Ctrl/⌘+W 提示与 App:1386 快捷键一致 ✅（无需改）
- 无 legacy storage key 清理（Hermes :161-168）——`v1` 刚启用无历史包袱，暂不需要
- `preview-targets.ts` #preview 协议、`previewName` 编解码 ✅ 对齐
- ELEVE 无 PreviewRecordSource：Hermes 仅用 source 定 renderMode 首值（file-browser→source 其余→preview）；ELEVE 文件默认源码视图、url 默认渲染，行为等价，可不补

---

## 五、修复顺序建议

- **P0**：差距 1（openPreview re-front 刷新，一行级）+ 差距 2（宫格预览承载）
- **P1**：差距 4（webview 常驻，参照 terminalMounted 模式）+ 差距 3（artifact 清理联动关 tab）+ 死链 6（PDF 分支）
- **P2**：死链 5（dataUrl 接线 or 删）+ 小项

每步 `commit + push` 并汇报（打包仍需单独授权）。

---

## 七、第二轮深审追记（修复提交 2de8b05 之后）

### 已修（二轮发现，随 2de8b05 之后的提交落地）
- **🔴 相对路径 #preview 链接黑洞（真 bug，二轮实测发现）**：Hermes 侧 markdown 链接 → `<PreviewAttachment>` 组件内部 resolve 时**全部带 session cwd**（preview-attachment.tsx:63 `requestCwd`；preview-row:30、attachments:137、panes:74 同）；ELEVE 的 StreamBlocks:179 / ToolEntry:223 / AgentCardComposer:402 / PreviewCenter:118 点击时 `normalizeOrLocalPreviewTarget(raw)` 不传 cwd → 工具输出相对路径链接 `#preview/src/index.html` 生成相对 file target → 读取失败。
  **修法（对齐 Hermes $currentCwd atom 架构）**：新增 `lib/session-cwd.ts` 模块级单例（唯一写入方 = App sessionCwd effect；对齐 Hermes store/session.ts $currentCwd），5 个调用点全部接入；preview-events 的 `options.getCwd` App 闭包双轨删除，统一走单例（消除两个 cwd 真相源）。宫格下 cwd 经 onSessionCwd → handleSessionInfoCwd → setSessionCwd → 单例，链路已验证连通。

### 二轮核实无差距的段（逐段读完）
- PreviewWebPane 中段（:380-470）：外部打开 shellOpen、iframe 错误三分类（serverNotFound/failed/moduleMime）、devtools、webview visible 与错误覆盖层联动、重启归属判定（restart.url === currentUrl）、45s 超时、完成/失败通知——全部对齐 Hermes，无差距。
- preview-edit.ts 全文：dirty 按 url 键控 + useSyncExternalStore，与 Hermes preview-edit.ts 等价。
- WindowedSourceView：200 行 chunk + overscan + 行引用协议，对齐 Hermes SourceView 且有增强。

### 记录在案的架构差异（有意为之，非遗漏）
1. **closeRightRail 清 tabs vs ELEVE 关右栏保留 tabs**：Hermes closeRightRail 是"关 rail 本体"（"Close every tab so the rail's panes leave the tree"）；ELEVE 右栏 onClose 是 layout 收起（terminal PTY 仍活）。若机械对齐会清掉用户 tabs——ELEVE 语义更接近"折叠"，保留。若未来做"真正关闭预览面"入口，应调 closeAllTabs（已存在）。
2. **无 Browser singleton tab**：Hermes URL tab 重键单例（decodePreviewTabs 只保最后一个 URL tab）；ELEVE 无 Browser surface，多 URL tab 各自存在 + openPreview 按 kind+url 去重，行为等价合理。
3. **宫格↔单视图切换会重建 webview**：两视图各挂一份 PreviewCenter（互斥渲染），跨视图切换属大切换，页面状态丢失可接受（Hermes 无宫格概念，无从对齐）。

### 二轮后状态
- 提交 1：`2de8b05`（P0-P2 六项修复）
- 提交 2：cwd 单例修复（本轮，见 git log）
- 验证：tsc -b ✅ + vite build ✅（两轮均过）

---

## 八、第三轮深审追记（用户质疑③后的彻底核查，2026-08-28 02:4x）

### 🔴 ③是错误结论，已修正
**"宫格↔单视图切换重建 webview"不成立。** 实地核查：
- `<Pane side="right">`（含 previewMounted 常驻的 PreviewCenter/webview）在 **PaneShell 层**（App:1913），与 `<PaneMain>` 平级；`viewMode==='grid' ? <GridModeView/> : 单视图` 分支只在 PaneMain **内部**（App:1548）。
- `rightOpen={rightOpen}` 不分视图模式传入（App:1489），全库无任何"宫格切换时动 rightOpen"的代码。
- → 宫格↔单视图切换**右栏 PreviewCenter/webview 始终存活**（previewMounted 常驻生效），页面状态不丢。上一轮报告写错，向用户致歉并更正。

### 🔴 由③引出的架构修订：宫格预览浮层方案废弃
- 浮层方案（2de8b05 引入 PreviewFloatingOverlay）建立在"宫格无右栏"的错误假设上。实测：**右栏 Pane 在宫格下照常挂载可用**。
- 浮层 + 右栏 = 双 PreviewCenter 实例 → 同 URL 双 webview + `registerActivePreviewWebview`（read_preview 目标）与 restart 归属互相覆盖——架构不干净。
- **修订**：删除 PreviewFloatingOverlay；App 的 paneOpenRequest 消费去掉 `viewMode==='single'` 限制（App:156）——宫格下 open_preview/#preview 链接直接开右栏「预览」tab，与单视图行为完全一致，全局唯一 PreviewCenter/webview。
- artifact 浮层不动：纯 DOM 无 webview，双实例无害，且"点卡片就地浮层"是既有产品交互。

### 🔴 close_preview 端到端链路补齐（二轮漏掉的真缺失）
- Hermes：`close_preview(url?)` 工具（desktop_ui toolset，close_preview_tool.py）→ emit `preview.close` → 前端 use-preview-routing:108-140（聚焦会话门禁；无 url=closeRightRail 清全部；有 url=closePreviewMatching 按 [raw, resolved.url] 候选精确关）。
- ELEVE 三层全缺（后端无工具、前端无分支）。**本轮补齐**：
  - 后端 `eleve-tools-native/src/close_preview.rs`（对齐 open_preview.rs 模式：ELEVE_DESKTOP gate、normalize_target 复用、session 归属 emit `preview.close`）+ lib.rs 注册。
  - Gateway 6-G2 desktop_events listener 是**通用事件转发**（event 名参数化），零改动。
  - 前端 `preview-events.ts` 加 `preview.close` 分支（同 open 门禁；无 target→closeAllTabs；有 target→[raw, resolved.url] 候选匹配 closeTab）。

### ①语义重定位（原"有意差异"论证作废，实为对齐无误）
- Hermes `closeRightRail()` 的**唯一生产调用方是 agent 的 close_preview 工具**（无参=清全部 tabs）；**UI 上不存在"用户关 rail 清 tabs"的入口**（rail 显隐走 layout store 的 selectRightRailTab）。
- ELEVE 右栏 X（收起面板保留 tabs）对应的正是 Hermes 的 rail 显隐语义 ✅；ELEVE 的 closeAllTabs 对应 Hermes 的 closeRightRail（agent 清场）✅。**语义对齐无误**，原①"差异"条目撤销。

### ②维持差异（论证补强）
- Hermes Browser singleton（URL tab 重键单例 + restore 只保最后一个）的前提是"浏览器是 rail 里的一个 surface"（openBrowserTab 由 command-palette 触发）。
- ELEVE 无 Browser surface，多 URL tab 各自持久化 + openPreview 按 kind+url 去重——是 Hermes 行为的**严格超集**（多开自由 + 不重复），无功能遗失。维持。

### 本轮验证
- 前端：tsc -b ✅ + vite build ✅；后端：cargo check -p eleve-tools-native ✅（mxapi.rs/media_artifacts.rs 的**他人遗留脏改动**（取证 debug_save_image，E0382 moved value）经 stash 隔离后验证，验证完已原样恢复，未动其内容——该半成品编译错误需其归属会话自行收尾）。
