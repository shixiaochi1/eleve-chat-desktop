# ELEVE 输入框对齐 Hermes 设计方案

> 制定时间：2026-07-20
> 制定人：小虾米
> 目标：将 ELEVE 桌面前端的消息输入框对齐 Hermes 桌面前端的设计语言与交互结构
> 参考源码：`/home/shixiaochi/hermes-agent/apps/desktop/src/app/chat/composer/`

## ✅ 阶段一完成记录（2026-07-20 08:20）

**状态：已完成，待老大 Windows 端重新构建后验收。**

改动文件（4 个，纯前端，未动 Rust 后端）：
1. `src/components/InputArea.tsx` — 容器化重构：图片预览/输入区/控制行共处 `.composer-surface` 玻璃容器；发送键改为 `bg-foreground` 高对比圆形（arrow-up / 停止方块），空内容置灰，按压缩放；📎 改 Paperclip 细线图标；`/` 补全弹窗锚定到容器上方；新增 `hasText` 状态（仅布尔翻转才渲染）
2. `src/style.css` — 新增 `.composer-surface`（hover 边框增亮 → focus-within 填充不透明 + 焦点光环 + backdrop-blur 玻璃），沿用 desktop-input-chrome 同一套 ring/fill 梯度机制
3. `src/components/CommandMenu.tsx` — [≡] 触发按钮统一为 `size-(--composer-control-size)` ghost 图标按钮
4. `src/components/Icons.tsx` — 新增 `AttachIcon`（lucide Paperclip，细线条风格）

**保留功能**：[≡] 命令菜单、📎 图片附件全链路、`/` 补全、Enter 发送/Shift+Enter 换行、排队提示、ContextBar 全部不动。

**尺寸说明**：复用 ELEVE 已有 `--composer-*` 变量（control 28px / primary 30px，比 Hermes 24/26px 略大，为 ELEVE 既定规格，未覆盖）。

**验证**：tsc --noEmit 0 错误；vite build 成功；产物 CSS 确认 `.composer-surface` + `size-(--var)` + backdrop-filter 均已编译。

**验收方式**：Windows 端 PowerShell/CMD 重新构建 Tauri 应用后目视检查（WSL 严禁编译 Rust）。

## ✅ 阶段二完成记录（2026-07-20 08:30）

**状态：已完成，随阶段一一起在 Windows 端重新构建后验收。**

改动文件（5 个，纯前端，未动 Rust 后端）：
1. `src/components/ModelPill.tsx`（新增）— Hermes 式模型胶囊：显示当前模型名，点击展开按 provider 分组的下拉列表切换；展开时箭头旋转、选中项打勾高亮、加载中转圈，与 [≡]/[📎] 共用 28px ghost 控件语言
2. `src/hooks/useModels.ts` — 导出 ModelItem/ModelGroup/GroupedModels 类型（仅加 export，逻辑零改动）
3. `src/components/InputArea.tsx` — 控制行右侧、发送键左边接入模型胶囊（新增 5 个 props 透传）
4. `src/App.tsx` — 接线：useModels 单例数据 + monitorState.modelName 兜底传入 InputArea（复用 218 行既有 currentModel 取值模式，单一数据源不重复请求）
5. `src/components/ContextBar.tsx` — 移除重复的模型名显示（D1 决策落地：模型显示/切换全部归胶囊，ContextBar 专注上下文压力：token/百分比/进度条/耗时；+新建会话、临时提问按钮不动）

**D1 决策**：选 B（去重）。原因：模型名两处显示不干净；原 ContextBar 模型点击切换本就是死代码（handleOpenModelPicker 无人调用），胶囊成为唯一正式切换入口。

**验证**：tsc --noEmit 0 错误；vite build 成功；产物确认胶囊相关文案已编译。

**阶段三待定**：3a 附件菜单（纯前端，可做）、3b 麦克风（需后端 voice.*，老大确认后才能动）、3c profile（待评估）。

## ✅ 阶段三（3a）完成记录（2026-07-20 08:35）

**状态：3a 已完成；3b/3c 被后端阻塞，如实上报。**

### 后端能力调查结论（决定做法的依据）
- 语音方法是占位：`voice.record` 里写着 TODO 启动 VAD 录音 / TODO 停止并转录；`voice.tts` 写着 TODO 接入 TTS 引擎。前端做麦克风 = 假按钮，不做。
- 文件附件是占位：`file.attach` 只原样回显 path，不落盘。仅 `image.attach_bytes` 真实可用（写盘 + 进 session）。

### 3a 改动文件（3 个，纯前端）
1. `src/components/AttachMenu.tsx`（新增）— Hermes 式 "+" 附件菜单：展开时 + 旋转 45° 呈关闭态；"选择图片"真实接通（复用原有选图逻辑），文件/文件夹/链接置灰 + 标注"待开发"（不做假交互，后端就绪解开 disabled 即可）
2. `src/components/Icons.tsx` — Paperclip/AttachIcon 换成 Image/ImageIcon（📎 按钮已被 + 菜单取代，旧图标无引用，一并清理）
3. `src/components/InputArea.tsx` — 📎 按钮替换为 AttachMenu

### 3b/3c 结论
- 3b 麦克风：**不做**。后端 voice.* 是 TODO 占位，做了是欺骗用户的假交互。等后端实现 VAD/STT/TTS 后再对接（纯前端 ~3h）。
- 3c profile 选择器：**待评估**。ELEVE 无 profile 概念，需后端先引入，建议后排。

**验证**：tsc --noEmit 0 错误；vite build 成功；产物确认"选择图片/待开发/添加附件"已编译。

## ✅ 阶段三（语音 UI + 链接）完成记录（2026-07-20 08:45）

**老大指示（08:35）**："你先把桌面前端 UI 实现，后端等我做完再连线。"——前端先行、按契约接线。

### 改动文件（6 个，纯前端，未动 Rust/原生层）
1. `src/services/ws-client.ts` — 新增语音 RPC：voiceRecord(start/stop/status)、voiceToggle(on/off/status)、voiceTts(text) + 响应类型
2. `src/hooks/useVoice.ts`（新增）— 语音状态机：idle→recording→transcribing→idle；录音计时；订阅 voice.transcript 事件插入转录文本
3. `src/components/VoiceActivityBar.tsx`（新增）— 录音/转录状态条：麦克风/转圈图标 + 计时 + 五条错相位舞动电平条 + 取消按钮
4. `src/components/Icons.tsx` — 新增 MicIcon（lucide Mic）
5. `src/components/AttachMenu.tsx` — 「添加链接」接通（URL 对话框，插入输入框，立即可用）；文件/文件夹改标「待原生支持」
6. `src/components/InputArea.tsx` — 控制行加麦克风按钮（ModelPill 与发送键之间）；输入区上方挂状态条；光标处插文本（语音/链接共用）
7. `src/style.css` — 录音脉冲光环 + 电平条舞动关键帧

### 🔴 后端契约（需后端实现方遵守）
- 转录结果通过 WS 事件 **`voice.transcript`** 推送，载荷 `{ text: "..." }`（兼容 `voice.transcription` / `{ transcript }`）。前端已按此监听，后端实现 VAD/STT 后无需改前端。
- voice.record(start/stop) 现有占位实现返回假状态，前端状态机已按真实流程搭好。

### 遗留
- 选择文件/文件夹需 Tauri dialog 插件（@tauri-apps/plugin-dialog，未装）——属原生层改动，等老大做后端时一并加，或确认后我来加。

**验证**：tsc --noEmit 0 错误；vite build 成功；产物确认"正在录音/语音输入/添加链接/voice.record"已编译。

## ✅ 控制行重排 + 思考深度/快速模式 完成记录（2026-07-20 09:25）

**老大要求**：控制行从左到右依次为：命令菜单、添加附件、语音输入、模型选择、思考深度、快速模式、上下文文件、网页窗口；发送键留最右。对齐 Hermes，ELEVE 只多一个命令菜单。

### 改动文件（6 个，纯前端）
1. `src/components/InputArea.tsx` — 控制行重排：语音+模型胶囊从右侧移到左侧指定位置；思考深度/快速模式/上下文文件/网页窗口 依次排在模型后；发送键独占右侧
2. `src/components/ThinkingButton.tsx`（新增）— 思考深度：对齐 Hermes REASONING LEVEL 六档设计（自动/极速/低/标准/高/极致，每档带说明、选中打勾、宽菜单）；映射后端值 ""(自动)/minimal(透传)/low/medium(标准)/high/xhigh(极致)；config.set(agent.reasoning_effort) 持久化，挂载时读回
3. `src/components/FastModeButton.tsx`（新增）— 快速模式：闪电开关，开启点亮+脉冲
4. `src/components/ComingSoonButton.tsx`（新增）— 占位控件（上下文文件），置灰+悬停提示"待后端支持"
5. `src/components/WebWindowButton.tsx`（新增）— 网页窗口：已接通后端 browser.manage（status/connect/disconnect，CDP 真实实现），一键连接/断开浏览器 + 状态指示灯脉冲
6. `src/components/Icons.tsx` — 新增 FastIcon(闪电)/ContextFileIcon(文档)/WebWindowIcon(窗口)
7. `src/services/ws-client.ts` — 新增 configGet/configSet + browserManage（对齐后端 config.*/browser.manage）

### 🔴 如实记录（后端成熟度）
- 思考深度：后端有真实配置键 agent.reasoning_effort（low/medium/high），已接通。
- 快速模式：后端未找到 fast 配置键（之前评估"能接通"有误，已纠正）。现按 frontend-first 乐观实现，接到 agent.fast_mode，后端确认正式键后改一行 CONFIG_KEY 即可。
- 上下文文件：后端未就绪（file.attach 是占位），做占位按钮，待后端。
- 网页窗口：browser.manage 已验证为真实实现（status/connect/disconnect，CDP），已接通。

**验证**：tsc --noEmit 0 错误（修复了 imageUploading 可选类型比较问题）。开发模式热更新已生效。

---

## 一、背景与目标

老大要求：对齐 Hermes 桌面前端，修复完善 ELEVE 的输入框。

**核心约束（老大明确指示，最高优先级）**：
- ✅ **"+ 新建会话" 按钮必须保留**（位于 ContextBar，使用 `Plus` 图标，功能为 `handleNewSession`）
- ✅ **[≡] 命令按钮必须保留**（`CommandMenu` 组件，lucide `Menu` 图标，功能为 `/` 命令菜单）
- ❌ 不存在"+ 命令菜单"这个东西（此前为误判，已澄清）

**目标**：在保留 ELEVE 全部现有功能的前提下，将输入框的**视觉结构与交互质感**对齐 Hermes。

---

## 二、现状分析（ELEVE）

### 2.1 完整布局（源码确认）

```
┌──────────────────────────────────────────────────────────────────┐
│ [+ 新建会话] [💬 临时提问]        qwen3.5-plus · 0/1.0M · 0.0% · 1h17m │  ← ContextBar
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░  (进度条, 80%刻度)                    │
├──────────────────────────────────────────────────────────────────┤
│ [≡]  [向 Eleve 发送消息… (Enter 发送, / 命令)      ]  [📎]  [↑蓝方块] │  ← InputArea (平铺一行)
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 组件与文件清单

| 组件 | 文件 | 功能 | 数据来源 |
|------|------|------|----------|
| ContextBar | `src/components/ContextBar.tsx` | +新建会话 / 临时提问 / 模型·token·%·耗时 / 进度条 | `fetchSessionContext` 每3s轮询 |
| InputArea | `src/components/InputArea.tsx` | 输入框主体 | props |
| CommandMenu | `src/components/CommandMenu.tsx` | [≡] `/`命令菜单 | `fetchCommands` → WS `commands.catalog` |
| 图片附件 | InputArea 内 | 📎 选择/粘贴/拖拽图片 | `useImageAttachments` → WS `image.attach_bytes` |
| 发送/停止 | InputArea 内 | 蓝色方块按钮 | `onSend` / `onAbort` |
| `/` 补全弹窗 | InputArea 内 | 输入 `/` 唤起命令补全 | `commands` state |

### 2.3 现有能力盘点（可复用）

- ✅ 模型数据：`useModels` 返回 `{ models, grouped, loading, error, refresh, selectedModel, selectModel }`
- ✅ 上下文数据：`fetchSessionContext` 返回 `{ model, total_tokens, context_limit, percentage }`
- ✅ shadcn UI 原语：`button` / `dropdown-menu` / `tooltip` / `codicon` 均已存在
- ✅ 图片附件全链路（选择/粘贴/拖拽/预览/删除）
- ✅ `/` 命令补全弹窗

---

## 三、目标标杆（Hermes）

### 3.1 布局结构（堆叠式容器）

```
┌──────────────────────────────────────────────────────────────────┐
│ ╭──────────────────────────────────────────────────────────────╮ │
│ │  [Message Hermes… (Enter to send)                          ] │ │  ← 输入区(上)
│ │  [+ 附件] [🎤 麦克风] [default]          [GLM-5.2 ⌄] [↑]    │ │  ← 控制行(下)
│ ╰──────────────────────────────────────────────────────────────╯ │
│    Auto-compact 100% · Context 14k/189k (7%)                       │  ← 状态行
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Hermes 设计语言要点

| 要素 | Hermes 实现 | 设计意图 |
|------|-------------|----------|
| **容器** | `rounded-2xl` + 边框（`color-mix` 半透明）+ 玻璃质感填充 | 输入区作为独立"面板"，与聊天流分离，有归属感 |
| **输入区** | 透明背景、无边框、`min-height 1.625rem`，位于容器内上部 | 输入是主角，无视觉干扰 |
| **控制行** | 位于容器内下部，`grid: menu / input / controls` | 工具触手可及，不占输入空间 |
| **发送键** | **实心圆形** `bg-foreground text-background`（黑底白字/白底黑字），`arrow-up` | 高对比 CTA，视觉焦点，一眼可辨 |
| **模型 Pill** | `h-1.5rem max-w-40 rounded-md px-2 text-xs` + 模型名 + `ChevronDown` | 模型状态常驻可见，点击即换 |
| **图标按钮** | 统一 `1.5rem×1.5rem`（24px），ghost 样式，hover 有背景 | 节奏统一，克制不抢戏 |
| **状态行** | 容器下方，`Context 14k/189k (7%)` 小字 | 上下文压力可视化 |

### 3.3 Hermes 尺寸规范（CSS 变量，可直接移植）

```css
--composer-width: 48.75rem;            /* 780px 容器最大宽度 */
--composer-control-size: 1.5rem;       /* 24px 控制按钮尺寸 */
--composer-control-primary-size: var(--composer-control-size);  /* 主按钮(发送)尺寸 */
--composer-control-gap: 0.25rem;       /* 4px 控件间距 */
--composer-row-gap: 0.25rem;           /* 4px 行间距 */
--composer-surface-pad-x: 0.5rem;      /* 8px 容器水平内边距 */
--composer-surface-pad-y: 0.3125rem;   /* 5px 容器垂直内边距 */
--composer-input-min-height: 1.625rem; /* 26px 输入区最小高度 */
--composer-input-max-height: ...;      /* 输入区最大高度(滚动) */
```

---

## 四、差距分析

| 维度 | ELEVE 现状 | Hermes 目标 | 差距 |
|------|-----------|-------------|------|
| 结构 | 平铺一行，textarea 自带边框 | 容器式：输入区+控制行分层 | 🔴 需重构 |
| 发送键 | 蓝色方块 `bg-primary` | 高对比圆形 `bg-foreground` | 🔴 需改 |
| 模型选择 | 仅在 ContextBar 显示，独立弹层切换 | 控制行内 Model Pill 下拉 | 🟡 需新增 |
| 上下文状态 | ContextBar 顶部（token+%+进度条） | 容器下方状态行 | 🟡 可选对齐 |
| 附件 | 📎 单按钮（仅图片） | `+` 菜单（文件/文件夹/图片/URL） | 🟡 可升级 |
| 麦克风 | ❌ 无 | ✅ 语音输入 | 🟠 需后端 `voice.*` |
| 命令按钮 | ✅ [≡]（保留） | `+` 是附件非命令 | ⚪ 概念不同，保留 ELEVE 的 |
| 新建会话 | ✅ ContextBar（保留） | 无此概念 | ⚪ ELEVE 特有，保留 |

---

## 五、设计原则

1. **保留优先**：ELEVE 特有功能（+新建会话、临时提问、[≡]命令、📎附件、`/`补全）一个不丢。
2. **结构对齐**：容器式布局 + 控制行分层，这是 Hermes 输入框的"骨架"。
3. **质感对齐**：高对比圆形发送键、统一 24px 控件节奏、玻璃容器表面、hover/focus 微交互。
4. **不照搬**：Hermes 的 contentEditable 富文本、队列引擎、弹出窗口、语音对话等重基础设施**不移植**（ELEVE 无对应后端，成本过高）。用 ELEVE 现有 textarea 方案实现同等视觉效果。
5. **分阶段**：先骨架（纯前端），再数据（模型/上下文），后能力（语音/附件菜单）。

---

## 六、分阶段实施方案

### 阶段一：容器化重构（纯前端，无数据改动）⭐ 建议先做

**目标**：输入框从"平铺一行"变为 Hermes 式"容器+控制行"，视觉骨架对齐。

**改动点**：

1. **新增 CSS 变量**（`src/index.css` 或 `src/style.css`）
   - 移植 Hermes 的 `--composer-*` 尺寸规范（见 3.3 节）

2. **重构 `InputArea.tsx` 结构**
   ```
   <div 容器 rounded-2xl border + 玻璃表面>
     <图片预览区 />        ← 移入容器内顶部
     <上传中/错误提示 />    ← 移入容器内顶部
     <textarea 输入区 />   ← 去掉自身边框，透明背景，min-height 26px
     <控制行>
       [≡ CommandMenu]  [📎 附件]  ...spacer...  [↑ 圆形发送键]
     </控制行>
   </div>
   <`/` 补全弹窗 />        ← 保留，定位调整
   ```

3. **发送键改造**
   - 从 `bg-primary` 方块 → `bg-foreground text-background` 圆形（`rounded-full`）
   - 图标：`arrow-up`（发送）/ 方块（停止）
   - `disabled:bg-foreground/30`（无内容时置灰）

4. **控制行控件统一**
   - [≡] 和 [📎] 统一为 `1.5rem×1.5rem` ghost 图标按钮，hover 有背景反馈

**保留不动**：
- ContextBar 整体（+新建会话、临时提问、模型/token/进度条）
- `/` 命令补全弹窗逻辑
- 图片附件全链路
- Enter 发送 / Shift+Enter 换行 / 排队逻辑

**改动文件**：`src/components/InputArea.tsx`、`src/index.css`（或 `style.css`）
**工时**：~2h
**风险**：低（纯样式/结构，不动数据流）

---

### 阶段二：Model Pill + 上下文状态行（复用现有数据）

**目标**：模型选择移入控制行（Hermes 式 Pill），上下文统计对齐 Hermes 状态行。

**改动点**：

1. **新增 `ModelPill` 组件**（`src/components/composer/ModelPill.tsx`）
   - 显示当前模型名 + `ChevronDown`
   - 点击展开下拉（复用 `useModels` 的 `grouped` 数据，按 provider 分组）
   - 选中调用 `selectModel`
   - 样式：`h-1.5rem max-w-40 rounded-md px-2 text-xs` + 截断

2. **数据接线**：`App.tsx` 已有 `modelDiscovery`（`useModels`），传入 `InputArea` → `ModelPill`

3. **上下文状态行**（容器下方）
   - 复用 `fetchSessionContext` 数据（ContextBar 已在轮询，可共享或独立轮询）
   - 显示 `Context {total_tokens}/{context_limit} ({percentage}%)`
   - **决策点**：ContextBar 右侧的 token 显示是否保留？建议二选一避免重复（见第八节决策点 D1）

**改动文件**：新增 `ModelPill.tsx`、改 `InputArea.tsx`、`App.tsx`（传参）、可能改 `ContextBar.tsx`
**工时**：~2h
**风险**：中（涉及数据接线，需验证模型切换生效）

---

### 阶段三：能力升级（需后端支持，可选）

| 子项 | 内容 | 依赖 | 工时 |
|------|------|------|------|
| 3a | 📎 升级为 `+` 附件菜单（文件/文件夹/图片/URL） | 纯前端（复用 onAddImage，新增文件选择） | ~1.5h |
| 3b | 🎤 麦克风语音输入 | 后端 `voice.*` WS 方法对接（前端未映射） | ~3h |
| 3c | default profile 选择器 | ELEVE 需引入 profile 概念（较大） | 待评估 |

**说明**：阶段三为增强项，非对齐必需。3a 可独立做；3b/3c 依赖后端，建议后排。

---

## 七、验收标准

### 阶段一验收
- [ ] 输入框为圆角容器，输入区在上、控制行在下
- [ ] 发送键为高对比圆形（黑底白箭头/白底黑箭头），无内容时置灰
- [ ] [≡] 命令按钮、📎 附件按钮保留且功能正常
- [ ] ContextBar 的 +新建会话、临时提问完全不受影响
- [ ] `/` 补全、图片附件、Enter 发送、排队全部正常
- [ ] hover/focus 有视觉反馈，无样式错乱

### 阶段二验收
- [ ] 控制行显示 Model Pill，当前模型可见
- [ ] 点击 Pill 弹出分组模型列表，可切换且生效
- [ ] 状态行显示 Context token 统计

---

## 八、待决策点（需老大拍板）

| # | 决策点 | 选项 | 建议 |
|---|--------|------|------|
| D1 | ContextBar 右侧的模型/token 显示与阶段二状态行重复 | A. 保留ContextBar，状态行不做 / B. token移到状态行，ContextBar只留按钮 | 先做阶段一，D1 在阶段二前定 |
| D2 | 模型 Pill 点击行为 | A. 内联下拉菜单 / B. 打开现有 ModelPickerPanel 弹层 | A（更贴近Hermes） |
| D3 | 阶段三是否做、做哪些 | 3a/3b/3c 可选 | 3a 可做，3b/3c 后排 |

---

## 九、重要提醒

1. **构建差异**：当前运行的桌面应用可能与源码不同步。本方案所有改动基于**源码**，改完需在 PowerShell/CMD 重新构建（`npm run build` + Tauri 打包）才能看到效果。**严禁在 WSL 中编译 Rust**（铁律）。
2. **不碰 ContextBar**：+新建会话是老大明确要保的，全程不动 ContextBar。
3. **此前误操作已恢复**：曾误删 [≡] CommandMenu（误以为是加号），已恢复，源码完好无损。
4. **Hermes 源码参考**：`/home/shixiaochi/hermes-agent/apps/desktop/src/app/chat/composer/`（index.tsx / controls.tsx / model-pill.tsx / context-menu.tsx）。

---

## 十、工时汇总

| 阶段 | 内容 | 工时 | 依赖 |
|------|------|------|------|
| 一 | 容器化重构 + 圆形发送键 | ~2h | 无（纯前端） |
| 二 | Model Pill + 状态行 | ~2h | 无（复用现有数据） |
| 三 | 附件菜单/语音/profile | ~1.5h~6h | 3b/3c 需后端 |

**建议**：先做阶段一（立竿见影、零风险），验收后再推进阶段二。
