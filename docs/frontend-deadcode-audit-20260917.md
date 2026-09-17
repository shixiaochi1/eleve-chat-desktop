# 前端死代码审计报告（2026-09-17）

> 仓库：`eleve-chat-desktop`（分支 main，基线 `502aead`）
> 触发：老大要求「死代码千万要分析梳理清楚，千万不能遗失功能」
> **本轮只审计，未改任何源码。**

---

## 0. 结论摘要

死代码有**两个维度**，必须分开看——只看 `tsc` 会漏掉最危险的一半：

| 维度 | 手段 | 规模 | tsc 能看到吗 |
|---|---|---|---|
| **A 符号级** | `tsc --noUnusedLocals --noUnusedParameters` | 180 条 | ✅ 能 |
| **B 文件级** | 零消费者扫描 + **可达性分析**（自建） | **22 个文件 / ≈4889 行** | ❌ **完全看不到** |

**核心结论：180 条告警里，不能直接删的至少有 6 条**——它们是「接了一半的线」或「从未接线的功能」，删掉就是真丢功能。另外发现 **2 个高危孤儿组件**（KanbanPanel 1190 行、SessionsPanel 763 行），它们已被替代但仍在被误维护。

处置分四类：

| 类 | 含义 | 数量 | 动作 |
|---|---|---|---|
| **甲** | 真废弃残留 | ≈135 条 | 可安全删（分批 + 每批验证） |
| **乙** | 接口冗余（父传子不用） | ≈20 条 | 可删，需成对改调用方 |
| **丙** | **断链 / 疑似功能缺口** | **6 条** | **不许删，需你拍板** |
| **丁** | 高危孤儿文件 | 3 组（1953+ 行） | **不许自行删**，需决策 |

---

## 1. 方法：为什么不能照 tsc 告警删

`noUnusedLocals` / `noUnusedParameters` 只证明「**本文件内没有读取**」，它**无法区分**四种性质完全不同的情况：

| 性质 | 例子 | 处置 |
|---|---|---|
| ① 真废弃残留 | 重构时删了消费点、声明忘了删 | 删 |
| ② 接口冗余 | 父组件仍传、子组件不用 | 删（成对改） |
| ③ **该用没用**（功能缺失） | 算了结果没接到 UI 上 | **修，不是删** |
| ④ **从未接线**（半成品） | 定义/实现齐备但无调用方 | **需决策** |

因此每条都做了**三重取证**：

1. **读实现体与上下文**（本仓铁律：引用注释前必读实现）
2. **全仓引用点**（含字符串、动态 import、注册表、测试）
3. **git 历史 `-S`**：该符号的引用是「曾经有、后来被删」还是「从来没有」——这是区分 ①/④ 的关键判据

**动态引用面已逐一排除**（避免误删）：
- JSX runtime = `react-jsx`（自动）⇒ React 默认导入删除**安全**（已验证 `tsconfig.json:17`）
- 无 `React.lazy` / 无 `import()` 动态加载 / 无 `import.meta.glob` ⇒ 静态分析可靠
- 插件贡献走 manifest 静态 import，无字符串组件注册表

---

## 2. 丙类：断链 / 疑似功能缺口（**严禁当死代码删**）

这 6 条是本次审计最重要的产出。它们**看起来**是「未使用」，实际是**功能问题**。

### 丙-1 `lib/session-window.ts` —— 会话独立窗口「触发链断了」⚠️ 高危

**是什么**：把某个会话「弹」成一个**独立的操作系统窗口**（Tauri `WebviewWindow`），可拖到主窗口外单独摆放，用于一边跑别的、一边盯着某个会话。对齐 Hermes `openSession(target='window')`。

| 环节 | 状态 | 证据 |
|---|---|---|
| ① 触发入口 | ❌ **不存在** | 全仓零调用 `openSessionWindow()`（`lib/session-window.ts` 入度 0） |
| ② 创建窗口 | ⚠️ **权限未开** | `capabilities/default.json:4-11` 的 `windows`/`webviews` 只列 `main`/`kanban`，而新窗口 label 是 `session-window:<id>` ⇒ **即使创建成功，该窗口自身拿不到 Tauri 权限**（它要 `invoke('get_gateway_port')` 才能连网关） |
| ③ 窗口端渲染 | ✅ 就绪 | `main.tsx:22-27` 处理 `?panel=session` → `SessionWindowApp`（142 行，复用 `useGridChat` + `AgentChatCard`，含 fail-closed 归属校验） |

**这不是「留下的垃圾」，而是「做了一多半的功能」**——底层为多窗口铺的路都在：
- `hooks/useGridChat.ts:154` 注释：*「防多窗口并发写污染主窗口的会话指针（窗口会话由 URL 显式指定）」「指针持久化（仅主视图；**独立窗口不写**防污染）」* ⇒ hook 层已支持"独立窗口"模式
- `useGridChat.ts:925` / `App.tsx:1716`：焦点卡片 cwd 推送「宫格/**独立窗口**文件面板跟随」
- `SessionWindowApp.tsx` 2026-08-13 还专门加固过 fail-closed 归属校验（URL 可篡改 → 校验 `session_id` 归属 profile）

**同款判据的对照**：看板独立窗口（`e3be54c`）被删的判据是「`openKanbanWindow()` 全库零调用 + 无人打开该 URL」——与本项一模一样，但当时**只删看板那条，会话这条被保留了**。

**两个选项（成本已查明）**：

| | 接线（让它可用） | 下线（照看板处理） |
|---|---|---|
| 前端 | 加 1 处入口调用（如会话行右键菜单「在独立窗口打开」） | 删 3 处：`lib/session-window.ts`(73 行) + `components/SessionWindowApp.tsx`(142 行) + `main.tsx` 的 `?panel=session` 分支与 import |
| 配置 | `capabilities/default.json` 的 `windows`/`webviews` 加 `"session-window:*"`（Tauri v2 支持 glob）——**不加则窗口连不上网关** | 顺手清 `kanban` 残留 |
| Rust | 零改动 | 零改动（无专用命令） |
| 收益 | 多窗口工作流，对齐 Hermes；成本极低 | 清 215 行未挂载代码 + 1 条告警 |

⚠️ **顺带发现（配置层残留）**：`capabilities/default.json` 有 3 处 `kanban` —— `:6` `:10`（`windows`/`webviews` 列表）与 `:73` **`allow-toggle-kanban-window`**（权限项指向 `e3be54c` 已删除的 Rust 命令 `toggle_kanban_window`）。看板独立窗口下线时**漏清了配置层**。

**✅ 已接线（commit `e083899`，2026-09-17）** —— 老大拍板「接线，看板先别动」：

| 改动 | 内容 |
|---|---|
| 入口 | `ProjectTreeItems.tsx` 的 `SessionRowActions` 增 `canOpenInWindow`（能力门控，**条件渲染**）+ `onOpenInWindow`；kebab 与右键菜单**各加**「在独立窗口打开」（icon `ExternalLink` ↔ Hermes `link-external`，位置在「复制会话 ID」之后）——**位置与门控方式都对齐 Hermes 的会话行动作菜单** |
| 实现 | `ProjectTreePanel.tsx` 的 `sessionActions` 传 `s.id` + `currentProfile`；门控在 Panel 层判定一次 ⇒ `ProjectTreeItems` 保持其文件头声明的定位「行组件全部 props 驱动，无平行状态源」 |
| 权限 | `capabilities/default.json` 的 `windows`/`webviews` 增 `"session-window:*"`（Tauri v2 文档确认支持 glob pattern） |
| 防御 | `openSessionWindow` 开头加 `isDesktop()` 判定（对齐 Hermes `canOpenSessionWindow`），浏览器模式直接返回而非抛错 |
| 验证 | `tsc -b` 0 error · `vitest` 26/354 · `npm run build` 11.34s · capability JSON 语法校验 · 无循环依赖 · 行尾 LF |

- ⏳ **未实机验证**：能否真正开窗（Tauri 多窗口 + 新窗口 capability 生效）需 dev 点一次；**capability 改动需重启 `tauri dev` 或重新构建才生效**
- 按指示**未动** kanban 残留（`default.json:6`/`:10`/`:73`）

**未实测提示**：接线后能否真的跑通（Tauri 创建多窗口 + 新窗口权限生效）我未实机验证，需 dev 环境点一次。



### 丙-2 `App.tsx:509 handleOpenModelPicker` + ModelPickerPanel overlay —— 永远打不开的 UI

**它是什么**：`components/ModelPickerPanel.tsx`（288 行）—— 一个**全屏浮层**里的模型选择面板：搜索框 + 按 provider 分组 + 加载骨架 + 空态 + 刷新按钮。数据源 = 全局 Provider 池（`provider.list` RPC，`ref = providerId/modelName`）。

```
App.tsx:508  const [showModelPicker, setShowModelPicker] = useState<boolean>(false);
App.tsx:509  const handleOpenModelPicker = useCallback(() => setShowModelPicker(true), []);  ← 零调用
App.tsx:2177 {showModelPicker && ( <OverlayView title="选择模型"> <ModelPickerPanel …/> )}
App.tsx:527  effect「打开模型选择器时自动 refresh」—— 因恒 false 而永不触发
```
- `setShowModelPicker(true)` **全仓仅此一处**且无人调用 ⇒ overlay 是**死 UI**（连带 527 行的自动 refresh effect 也死）

**模型选择本身没丢**——活的入口是 `ModelPill`（**更正**：此前记为「ContextBar 的模型菜单」，不准确）：
- `components/ModelPill.tsx` 常驻**输入区控制行**（`InputArea.tsx:892`）+ 宫格卡片（`AgentChatCard.tsx:432`）
- 紧凑下拉（`DropdownMenu`，256px），按 provider 分组、选中打勾、展开时刷新
- 数据经 `ModelContext` 全应用下发（`App.tsx:1600` 的 `modelContextValue`）
- 注释自陈「对齐 Hermes composer model-pill」
- ⇒ **与死 overlay 同一数据源（`grouped`）**，属职责重叠、形态不同的两套实现

**Hermes 只有一种形态**：没有全屏面板。它把搜索做在**下拉菜单内部**——
`app/shell/model-catalog-menu.tsx`（共享渲染器：`DropdownMenuSearch` 搜索 + `HighlightMatches` 命中高亮 + `collapseModelFamilies` provider 折叠 + `Skeleton`），用于 composer 的 `model-menu-panel.tsx`。
⇒ ELEVE 这个 overlay 是**自创的第三种形态，Hermes 无对应物**。

**🔴 意外发现（这才是与 Hermes 的真实差距）**：ELEVE **已经移植过** Hermes 那个带搜索的下拉 ——
`components/kanban/ModelCatalogMenu.tsx`（注释写明「对齐 Hermes ModelOverrideField + ModelCatalogMenu」，143 行用 `DropdownMenuSearch`，占位「搜索模型 / Provider…」）。
但它**只用在看板侧的「模型覆盖」字段**（CreateTaskDrawer / TaskDrawer）。**主流的 `ModelPill` 反而没有搜索**。

**三个选项**：

| | 做法 | 成本 | 与 Hermes 的关系 |
|---|---|---|---|
| a | 删 overlay（`handleOpenModelPicker` + 渲染分支 + effect + 288 行组件） | 4 处 + 删文件 | 承认被 ModelPill 取代 |
| b | 接线 overlay（某入口打开它） | 1 处调用 | 保留双形态，**与 Hermes 不齐** |
| **c ✅ 推荐** | 给 `ModelPill` **加搜索**（复用已有 `ui/dropdown-menu` 的 `DropdownMenuSearch` 基建，`kanban/ModelCatalogMenu:143` 有现成范例），然后删 overlay | a + ModelPill 约 30-50 行 | **正是 Hermes 的做法**（搜索在下拉内），且顺带清 288 行死代码 |

**✅ 已实施（方案 c · commit `260b4c8` · 2026-09-17）**：

| 改动 | 内容 |
|---|---|
| ModelPill 加搜索 | `DropdownMenuSearch` 作为 `DropdownMenuContent` **首个子元素**（该组件注释即为此设计："Drop it in as the first child of a DropdownMenuContent"）。过滤语义与仓内范例 `kanban/ModelCatalogMenu` **保持一致**：命中 model id 或 provider 名子串即保留；**provider 命中 ⇒ 该组整组保留**。新增「无匹配模型」空态；搜索框仅在确有模型可筛（非 loading/error/空池）时显示 |
| 退役 overlay | 删 `components/ModelPickerPanel.tsx`（288 行）+ `App.tsx` 4 处（import / `showModelPicker` state / `handleOpenModelPicker` · `handleCloseModelPicker` / 渲染分支）。原「打开时自动 refresh」effect 一并退役 —— 该需求已由 ModelPill 的 `onOpenChange → onRefresh` **承接**，代码内注释记录了去向 |
| 验证 | `tsc -b` 0 error · `vitest` 26/354 · `npm run build` 11.34s · 重扫 **84 → 83**（仅消除 `handleOpenModelPicker`，新增 0）· 行尾 LF |

⏳ 未实测搜索交互手感（展开 autofocus、方向键导航、provider 命中整组保留）—— 建议在输入区点一下模型胶囊试。


### 丙-3 `StatusBar.onOpenSettings` —— 传了但状态栏没有设置入口

- `AppShell.tsx:45` 明确传 `onOpenSettings={onOpenSettings}`
- `StatusBar.tsx` 解构了它，但组件内**只有 `onClick={handleCopySession}`**（复制会话 ID），**没有设置按钮**
- ⇒ 不是「按钮点不动」，而是这个 props 从未被用于 UI。**无功能丢失**（设置入口在别处），属乙类；但若设计意图是「状态栏放设置入口」，则是未完成的设计。

### 丙-4 `SettingsPanel:124 gatewayOnline` —— 网关在线状态没显示在设置面板

- `const [gatewayOnline, setGatewayOnline] = useState(false)`：**setter 在用**（`315/317/767` 三处写入），**值从不读取**
- 同类：`KanbanColumn:30 hovered`（`setHovered(false)` 在用）、`MediaProviderSection:83 settingsLoaded`（3 处 setter 在用）
- ⇒ 状态被精心维护但**无消费者**。要么是「曾经的指示器被删了」，要么是「该显示没显示」。**需确认是否有 UI 门控意图**。

### 丙-5 `useBootstrap depsReady` —— 算了门控但没人用

- `useBootstrap.ts:108` `loadMarkdownDeps().then(() => setDepsReady(true))`；hook 把它暴露给 `App.tsx:285`，但 **App 解构后不使用**
- ⇒ 要么 markdown 依赖门控是多余的，要么**某个应等依赖就绪的渲染没等**。需确认。

### 丙-6 `usePromptActions:98 compacting` —— 注释描述的行为没实现

```ts
// 压缩中状态（对齐 Hermes composer compacting：压缩中 busy 输入排队不打断，
// canSteer=false → busyAction=queue）。store/session-status 是既有权威源，不新建平行状态。
const compacting = useSessionStatus(sess.sessionId ?? '').compacting;   ← 读了不用
```
- 是 `store/session-status` 里 `compacting` 的**唯一读取点**，读完即弃
- 但**行为未必丢失**：`handleSend` 的 busy 决策已下沉后端（`usePromptActions.ts:191-197` 注释：由 `route_busy_submit` 决定 steer/interrupt/queue）
- 处置：**删变量 + 改注释**（注释描述的职责已不属于前端），零行为影响

---

## 3. 丁类：高危孤儿文件（tsc 完全看不到）

「零消费者」的**功能文件**——它们不是残留一两行，而是整份实现被替代后留在原地，**且仍在被误维护**。

### 丁-1 `components/KanbanPanel.tsx`（1190 行）⚠️⚠️

| 判据 | 证据 |
|---|---|
| 零 import | 无 `from './components/KanbanPanel'`、无 `../KanbanPanel` |
| 从未接线 | `git log -S "KanbanPanel" -- src/App.tsx` **为空**（App 历史上从未 import） |
| 全史命中 | `git log --all -S "./KanbanPanel'"` 仅 2 次：`5183c23`(init 搬入) 与 `e3be54c`(清理看板独立窗口) |
| 真实入口 | `KanbanPanelForSidebar.tsx`（`SidePanel.tsx:102` 注册「看板」面板）——**且它不引用 KanbanPanel** |
| **仍在被改** | 最近修改 `3f8b39c`(2026-08-16)「项目下拉名称丢失」+ `48b147e`「死 import 清理」 ⇒ **有人在给孤儿打补丁** |
| 告警 | 74 条（58 import + 16 处 state/setter） |

**不删**——1189 行的完整实现可能是「主看板」形态的保留版，删除前需能力对比，属功能决策。

### 丁-2 `components/SessionsPanel.tsx`（762 行）⚠️

**它是什么**：一个**完整的会话列表面板**（自述"Apple 风格会话列表"）——
虚拟滚动（`@tanstack/react-virtual`）+ 搜索（`lib/session-search`）+ 右键菜单（重命名/置顶/归档/导出/复制 ID/删除）
+ 批量删除（应用内确认浮层）+ 会话操作（`undo / compress / branch / usage`）+ 未读标记（`markSessionRead`）
+ 状态点（`SessionStatusDot`）+ 分页；**且是双 Tab**：会话 / 大纲（`:710 <OutlinePanel embedded />`）。

**为什么是孤儿**：`88a0fcc refactor(sidebar): Agent+会话合并统一侧栏 — 上部 Agent 卡片(42% 上限)/下部当前 Agent 会话列表，**删独立会话按钮**`
—— 那次把"独立会话面板"并入 Agent 面板 ⇒ **它失去入口**；此后 `App.tsx` / `SidePanel.tsx` 再无引用。
⚠️ 但它**一直被人维护到最后**（`e597ff2` round-106、`7e00e94` round-95、`c880ced` round-42/43…）⇒ 又一起「给孤儿打补丁」。

**职责被谁继承**：`ProjectTreePanel` / `ProjectTreeItems`（后者注释多处写「对齐 SessionsPanel」：
撤销/压缩/分支/用量、pin 共用同一 localStorage、归档切换、右键菜单全功能）；`CommandCenter` 也对齐它的 `HIDDEN_SOURCES`。

### 丁-4 级联孤儿 —— 零入度扫描的盲区（2026-09-17 补）

**盲区**：原先的「零消费者扫描」只统计**直接入度**，看不到「引用者自身已不可达」的级联。
补做**可达性分析**（从 `src/main.tsx` 出发 BFS，沿 import / re-export / 动态 import 建图）后，真孤儿 **19 → 22 个**，多抓出：

| 文件 | 行数 | 上游（死因） |
|---|---|---|
| `components/kanban/KanbanColumn.tsx` | **461** | 唯一消费者是孤儿 `KanbanPanel`；**活的侧栏看板 `SidebarKanbanBoard` 自己渲染列，不用它** |
| `components/OutlinePanel.tsx` | **341** | 唯一消费者是孤儿 `SessionsPanel`（`<OutlinePanel embedded />`） |
| `lib/session-search.ts` | 58 | 唯一消费者是孤儿 `SessionsPanel` |
| `ui/sheet.tsx` · `ui/separator.tsx` · `hooks/use-mobile.ts` | 140+32+4 | `ui/sidebar.tsx`（孤儿）的依赖链 |
| `hooks/use-resize-observer.ts` | 32 | 同为组件库依赖链 |

### 丁-3 `components/ui/*`（15 个文件 / ≈2041 行）—— 不算异常，但需知情

`alert / badge / card / checkbox / collapsible / disclosure-caret / fade-text / kbd / loader / scroll-area / select / separator / sheet / sidebar / tabs`

- shadcn 风格设计系统组件，**整体从未被使用**（含 `sidebar.tsx` 736 行、`loader.tsx` 557 行）
- 其中 `separator` / `sheet` / `use-mobile` 属**级联**（被孤儿 `ui/sidebar` 拉进来）
- 建议：**不删**。它们是通用 UI 库（无副作用、不影响功能），删除收益低、且可能是有意保留的设计系统基础。列为「知情项」。

**可达性口径合计：22 个文件 / ≈ 4889 行不可达**。
其余 3 个是类型声明文件，**正常**（`vite-env.d.ts` / `global.d.ts` / `unicode-animations.d.ts`）。


---

## 4. 甲类：可安全删除（真废弃残留，已逐条取证）

| 文件:行 | 符号 | 判定证据 |
|---|---|---|
| `ArtifactPanel.tsx:411` | `ArtifactListItem` | 私有函数、零引用；列表渲染已改（`727703a` 右栏化后弃用） |
| `ArtifactPanel.tsx:42` | `KIND_LABEL` | 同批引入、零引用（实际用 `KIND_ICON`） |
| `ProcessPanel.tsx:75` | `exited` | UI 只用 `running.length` / `processes.length`（顶栏文案可证） |
| `TaskDrawer.tsx:497` | `handleSaveAssignee` | **UI 走 `onChange` 实时保存**（`650` 行 `void saveAssigneeTo(v)`）⇒ 包裹函数成残留 |
| `App.tsx:1303` | `wasBusy` | 注释明确「🔴 2026-08-22 移除 `!wasBusy`…**无条件**执行」⇒ 条件删了、变量留下 |
| `AgentChatCard.tsx:331` | `wasBusy` | 同上（同批修复，注释在 `336` 行） |
| `useBootstrap.ts:119` | `portPromise` | 下方 `tryDiscover(0)` 已完整覆盖「发现 + 重试 + setPortReady」⇒ 该行是重构遗留的**重复调用**（缩进错位可证） |
| `usePromptActions.ts:98` | `compacting` | 见丙-6（决策已下沉后端） |
| `SettingsPanel.tsx:476-477` | `newDelProvider` / `newDelModel` | 零使用（连 if 分支都未用） |
| `MessageBubble.tsx:181` | `zoomedName` | 值从不读；`79987a0`「取消二次编辑入口」后残留 ⇒ 连同 `setZoomedName` 调用一并删 |
| `themes/derive.ts:177` | `isDark` 参数 | 颜色已由 `DerivedColors` 承载明暗（函数注释自证）⇒ 删参数 + 同步改调用方 |
| `themes/context.tsx:53` | `isDarkColor` | 零引用（同文件 `hexToRgb` 在用） |
| `Icons.tsx:72` | `ICON_SIZE_XL` | 常量零引用 |
| `useSSE.ts:180` | `RunCompleteChunk` | 类型零引用 |
| `ws-client.ts:29` | `JsonRpcResponse` | 类型零引用 |
| **import 类 115 条** | — | 见附录；细分：**KanbanPanel 58 条**（随丁-1 决策一起处理）+ 其它文件 57 条 |

---

## 5. 乙类：接口冗余（可删，需成对改调用方）

| 位置 | 符号 | 实况 |
|---|---|---|
| `ProjectTreeItems.tsx:566` | `onRowDragStart/onRowDragOver/onRowDrop/onRowDragEnd` | **父组件也不传**（`ProjectTreePanel:691` 只传 `isDragging/isDragOver`）；拖拽实现在外层 `data-drag-handle` div ⇒ **拖拽功能完好**，这 4 个是从未接线的接口定义 |
| `TerminalPanel.tsx:94` | `sessionId` | 组件只用 `cwd`（注释自证） |
| `SessionsPanel.tsx:217` | `isStreaming` | 组件内不读（且该组件本身是孤儿，见丁-2） |
| `ArtifactsGallery.tsx:105` | `onQueryChange` | `query` 在用、`onQueryChange` 不用（搜索框在父组件侧） |
| `AgentCardComposer.tsx:91` | `onClearFileError` | 父传 `clearFileError` 但组件不消费 |
| `ChatSettings.tsx:58` | `onSaved` | 调用方传的是空函数 `() => {}`（`SettingsPanel:835`）⇒ 纯冗余 |
| `SettingsPanel.tsx:124` | `gatewayOnline` | 见丙-4（含 UI 意图，需确认） |
| `FileBrowserPanel.tsx:368` | `loadingDirs` | hook 仍维护该字段，组件不读（可能缺加载态指示，**需确认**） |
| `GatewayPanel.tsx:219` | `platformLabel(name, state)` 的 `name` | 该函数只返回连接态文案，平台名在别处渲染 ⇒ 参数冗余 |
| `UsagePanel.tsx:436` | `hasChildren` | 算而不用（`SessionRowGroup` 自算）⇒ **需确认展开箭头逻辑** |
| `useGridChat.ts:834` | `dpGoal` | `delegate.progress` 分支解构未用（**需确认是否漏了 goal 提示**） |
| `chat-messages.ts:321` | `prevResult` | 签名位保留（同签名另一参数已用 `_` 前缀抑制告警）⇒ 改 `_prevResult` 即可 |
| `App.tsx:285` | `depsReady` 解构 | 见丙-5 |

---

## 6. 执行方案（分批，每批独立验证）

**顺序原则：先删「无争议」的，把「有意图」的留到最后问。**

### 第 1 批 ✅ 已完成（commit `927809c`，2026-09-17，已推送）

| 项 | 结果 |
|---|---|
| 范围 | 非 KanbanPanel 的 import 冗余 **57 个绑定 / 40 处语句 / 31 文件** + **8 处死符号** + 3 处级联殉葬 |
| 效果 | tsc 未使用告警 **180 → 115**（消除 65 条，与删除数完全吻合） |
| 验证 | `tsc -b` 0 error · `vitest` 26 files / 354 tests 全通过 · `npm run build` 成功(11.32s) · 行尾复核 LF |
| 未触碰 | KanbanPanel（丁-1）、乙类接口冗余、丙类断链 —— **全部保留** |
| 级联收敛 | `ArtifactPanel.KIND_ICON`（连同随之死亡的 `Icons` 三图标 import）· `ArtifactPanel.cn` · `themes/context.hexToRgb`（与 `hexToRgba` 是两个不同函数，未误伤） |

> ⚠️ **过程教训（已记入 memory）**：死符号删除**必须按内容锚点定位**。
> 首版按 tsc 报告的行号删除，但 **import 修剪已经改变了行号** ⇒ `ArtifactPanel` 误删
> ⇒ 编译失败（`Cannot find name 'record'`）。回滚后改为「**锚点正则 + 唯一性命中校验**」，
> 并把顺序改为「**先删符号 → 再修剪 import**」，两者都不再依赖行号。
> 另修掉两处脚本缺陷：多行 import 的成员未剥离尾逗号（删不掉）、命名空间导入按
> `'* as x'` 而非本地名判定（永远不匹配）、41 行超长 import 块被 40 行上限截断。

### 第 2 批 ✅ 已完成（commit `ab709db`，2026-09-17，已推送）

| 项 | 结果 |
|---|---|
| 范围 | **重构残留 8 处**（`wasBusy`×2 / `portPromise` / `compacting` + 3 行过期注释 / `newDelProvider` / `newDelModel` / `zoomedName` / `deriveTerminalTheme` 的 `isDark` 参数）+ 2 处级联（`useSessionStatus` import、`useTerminal` 的 `isDark` 解构） |
| 效果 | tsc 未使用告警 **115 → 107**（消除 8，**新增 0**） |
| 验证 | `tsc -b` 0 error · `vitest` 26 files/354 tests · `npm run build` 11.31s · 行尾 LF 复核 |
| 手法 | 本批改用 **Edit 工具逐处精确替换**——8 处小规模下，带上下文的 `old_string` 天然具备唯一性校验（不匹配即失败），比脚本更透明，无需 dry-run |
| 判据 | ① **注释自证**：`wasBusy`/`portPromise`/`compacting` 三处的原注释都写明「已移除 X 条件」「已下沉后端」⇒ 声明属遗漏；② **setter 在用但值不读** = 状态残留；③ 删参数类改动必须**同步三处**：定义 / 调用 / 解构+依赖数组（`useTerminal` 即为此） |

### 第 3 批 ✅ 已完成（commit `93c2e07`，2026-09-17，已推送）

| 项 | 结果 |
|---|---|
| 范围 | **乙类接口冗余 23 处**（A：props 8 组；B：解构/计算 4；C：未使用参数 6）+ 3 处级联（`clearFileError` 解构、`isParent`、`SkillsPanel.doInstall` 2 处调用实参） |
| 效果 | tsc 未使用告警 **106 → 84**（消除 23，**新增 0**） |
| 验证 | `tsc -b` 0 error · `vitest` 26 files/354 tests · `npm run build` 11.24s · 行尾 LF 复核 |
| 手法 | 32 处编辑用「**子串匹配 + 强制唯一性命中校验**」脚本：每处 `old` 在目标文件内必须 `count == 1`，否则中止。dry-run 拦下 2 处（8 空格锚点是 10 空格版本的子串 ⇒ 歧义；一处缩进写错 ⇒ 命中 0） |
| 未触碰 | 丙类 6 条 + 同性质 4 项（`config`/`hovered`/`settingsLoaded`/`providerId`）+ `SessionsPanel.isStreaming`（丁-2）+ `PaneShell.onToggle`（原有 eslint-disable 刻意保留）= **剩余 11 条**，全部留待决策 |
| ⚠️ 踩坑 | **Edit 工具的 `replace_all` 在 Windows 会把整个文件重写为 CRLF**（`SkillsPanel` 384 行全变 CRLF，而 HEAD 是纯 LF）⇒ 已转回 LF，diff 收敛为 +3/−3。**今后用 `replace_all` 后必须复核行尾** |

**两个高风险项的处理**（都取保守路线）：
- `ImageEditorModal` 的 `btn(t, label, …)`：4 个调用点首实参是工具名（`'brush'` 等），**删参数会导致实参错位** ⇒ 改 `_t` 保留位，零风险
- `SkillsPanel.doInstall(id, name)`：2 个调用点都在传 `r.name || ''` ⇒ 删参数并**同步删两处实参**（比改名更彻底，且只有 2 处）

| 批次 | 范围 | 风险 | 验证 |
|---|---|---|---|
| **第 1 批** | 甲类中**非 KanbanPanel** 的 import 冗余（≈57 条）+ 明确死函数/常量（`ArtifactListItem`/`KIND_LABEL`/`exited`/`handleSaveAssignee`/`ICON_SIZE_XL`/`isDarkColor`/两个类型） | 极低 | `tsc -b` + `vitest` + `npm run build` |
| **第 2 批** | 甲类「重构残留」：`wasBusy`×2 / `portPromise` / `compacting`（含注释修正）/ `newDelProvider`×2 / `zoomedName` / `isDark` 参数 | 低 | 同上 + 手测终端主题 |
| **第 3 批** | 乙类接口冗余（成对改调用方） | 低-中 | 同上 + 手测对应面板 |
| **第 4 批** | 丙类：**先由你确认设计意图**，再决定「删除 or 接线」 | — | 逐项手测 |
| **第 5 批** | 丁类：KanbanPanel / SessionsPanel / ui\* | 需功能决策 | 需能力对比 |

**每批铁律**：只 `git add` 本批文件 · 逐个文件核对 diff · `tsc -b` + `vitest`（当前 26 files / 354 tests）+ `npm run build` 全绿再提交 · 行尾用 Python 字节统计核对（本仓 LF）。

---

## 7. 待你拍板

1. **KanbanPanel.tsx（1190 行）**：删除 / 加 `@deprecated 未挂载` 标记并从门禁排除 / 接线为独立主看板？（**建议：先加标记 + 单独一轮评估，不再误打补丁**）
2. **SessionsPanel.tsx（763 行）**：同上。
3. **ui/\* 13 个组件（1959 行）**：保留（建议）还是清除？
4. **丙-1 会话独立窗口**：接线入口 还是 三处同批下线？
5. **丙-2 Model Picker overlay**：废弃删除 还是 接线回某个入口？
6. **丙-4/5/6 三个「状态无消费者」**：是否有 UI 意图需要补上？
7. **是否启动第 1 批清理**（≈57 条零争议 import + 8 处明确死函数）。

---

## 附录：完整告警清单（180 条）

见随附 `deadcode-list-20260917.tsv`（分类 / 文件 / 行号 / 符号 / 源码片段）。
