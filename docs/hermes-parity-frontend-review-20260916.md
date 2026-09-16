# Hermes 前端对齐审查（r116 · 2026-09-16）

范围：ELEVE 前端 `eleve-chat-desktop`（branch main，HEAD `c3baabb`） vs Hermes `apps/desktop`（`/home/shixiaochi/hermes-agent`）。
方法：**读两侧实现体取证，标注 `文件:行号`**。本轮**只检查、未改码、未启动前端**（启动/打包需老大单独授权）。

---

## 结论速览

| # | 问题 | 判定 | 证据类型 |
|---|---|---|---|
| A | 左栏「Agent 卡片面板」与「群聊面板里的 Agent 行」 | **是重复**（同批实体、两个左栏入口、两份 RPC 视图、两套排序） | ①实现体 |
| B | 群聊消息区 | **形态偏离 Hermes 明显**（气泡化 vs 单列房间日志），另有 6 项能力缺失/降级 | ①实现体 |
| C | 左栏 roster 行（"agent 行"） | 与 Hermes `bot-row` 有 4 项差异（头像/预览/时间/pin 图标） | ①实现体 |

---

## A. Agent 卡片 vs 群聊 Agent 行 —— 重复确证

### A1. 两侧同批实体、两个入口

| 面 | ELEVE | Hermes 对应物 |
|---|---|---|
| 左栏视图① | IconBar `Agent`（`components/IconBar.tsx:52`）→ `activePanel='agents'` → `AgentsPanel` → `ProfilePanel` **卡片**（`components/ProfilePanel.tsx:107-205`），区块头写死 `Agents`（`:386`）；数据源 `profiles.list`（`utils/api.ts:389`，含 model/provider/skill_count） | 侧栏**底部常驻** `ProfileRail`（`app/chat/sidebar/index.tsx:1934` → `profile-switcher.tsx:148`）——**横向紧凑方块条**（dnd-kit `horizontalListSortingStrategy`），只切身份 + 新建/重命名/删除/soul |
| 左栏视图② | IconBar `群聊`（插件贡献 `plugins/bots/plugin.tsx:67-83`）→ `BotsPane` → **"Agent" section 行**（`components/BotsPane.tsx:891`，`BotRosterRow` @ `components/BotsView.tsx:191-317`）；数据源 union roster `bots.roster`（`services/bot-relay.ts:753-785`，本机 + 全部远端连接） | Bots roster 行（`plugins/hermes-bots/bot-row.tsx:222-300`） |

**关键结构差异**：ELEVE 两个视图是**互斥 tab**（`SidePanel.tsx:92-110`：`activePanel` 命中静态表，未命中才回退插件 pane）⇒ 切 Agent 看不到群聊/会话，切群聊看不到 Agent 卡片。
Hermes 是 **rail 常驻 + roster tab 并存**，两者不互斥、形态差异极大（方块条 vs 行），不产生"重复"观感。

### A2. 重复的三个具体点

- **R1 入口/标题撞车**：两个面板都列**全部 agent**，标题一个叫 `Agents`（`ProfilePanel.tsx:386`）、一个叫 `Agent`（`BotsPane.tsx:891`）。用户无法从命名判断"该去哪个面板找这个 agent"。
- **R2 写操作两处**：新建 Agent 在 `ProfilePanel.tsx:394-402`（顶部按钮 + `CreateAgentDialog`）；编辑/复制 Agent 在 BotsPane 行右键菜单（round-112 起远端行也可编辑，`BotsPane.tsx` `onEditAgent`）。同一实体两条维护路径。
- **R3 排序两套真值**：卡片顺序 = localStorage `AGENT_ORDER_KEY`（`ProfilePanel.tsx:210`）；花名册行顺序 = pin + 活动度（`lib/roster-filter.ts` `sortByPinThenActivity`）。**同一批 agent 在两处顺序不同**，用户在 A 面板排好的顺序在 B 面板不生效。

### A3. 不算重复的部分（避免误伤）

- BotsPane 的 "Agent" section **不能删**：它是 Hermes roster 的对应物（`bot-row.tsx`），承担"运行视图"（活跃点/未读/attention/开 canonical chat），与卡片的"配置视图"（model/provider/技能数）职责不同 —— **Hermes 也同时有 rail + roster 两个面**。
- 真正的错位在于：ELEVE 把 Hermes 的 **紧凑 rail** 做成了**互斥的全屏卡片面板**，且把 Hermes 放在 **Profiles 管理 overlay**（`app/profiles/index.tsx`，左列表+右 soul 编辑）里的 model/provider 元信息搬进了侧栏卡片 ⇒ 于是和 roster 撞车。

---

## B. 群聊消息区（重点）— ELEVE vs Hermes

Hermes 群聊 = **单列房间日志**（`group-chat-view.tsx:1045` 到达顺序；`renderEntry` @ `:917`）。
ELEVE 群聊 = 事件流 + **复用主聊天区的 `MessageRow` 气泡**（`components/BotsView.tsx:1183-1258`）。

| # | 项 | Hermes | ELEVE | 判定 |
|---|---|---|---|---|
| B1 | 你的消息形态 | 单列、**整行淡底** `rounded-md bg-(--chrome-action-hover) px-2 py-1.5`（`:966`） | **右对齐气泡** `bg-user-bubble rounded-2xl rounded-br-sm`（BotsView `:1197` → `MessageRow.tsx:44-92` → `MessageBubble.tsx:257-266`） | ❌ 形态偏离：群聊被做成 IM 气泡，与"房间日志"语义不符 |
| B2 | 成员消息容器 | **无气泡**，纯文本 `text-xs text-(--ui-text-secondary)`（`:1004-1008`） | **套气泡** `bg-card + border + shadow-sm + rounded-2xl`（`MessageBubble.tsx:289-291`，经 `BotsView.tsx:1251`） | ❌ 每条成员发言都是一张白卡片 → 视觉噪音 + 双层缩进（`MessageRow` 自带 `px-4` 叠加外层 `px-3`） |
| B3 | 发言者头像 | `BotFace` 24px（形状/颜色/眼睛/图片/pet）+ mood（`:972`） | **16px 首字母色块**（`BotsView.tsx:1226-1240`） | ❌ 成员辨识度低；无 mood（忙/闲不可见） |
| B4 | 你的行身份标签 | 显式 `You`（`:975-982`） | **无标签**（靠右对齐暗示） | ❌ 多人房间里"这条是我说的"缺失（成员行有 `@handle`，你的行没有） |
| B5 | 名字/消歧 | 默认 `display`，**点击展开** `display-source (@handle)`（`:967-973`） | **常驻** `@handle · display · time`（`:1237-1240`） | ⚠️ 形态差异（信息更全但更噪），非缺陷 |
| B6 | 空态文案 | 仅 `room.log` 为空时显示（`:1142-1148`） | **恒显示**"群聊已创建 · @提及成员…"首行（`BotsView.tsx:1151`），有历史也占一行 | ⚠️ 轻微噪音 |
| B7 | 拖文件入房 | 整房 dropzone **视觉反馈**（`:1106-1129`） | 只有根容器 `onDragOver/onDrop`，**无视觉提示**（`:1539` 起） | ❌ 功能缺失（拖入无反馈，用户不知可拖） |
| B8 | 滚动容器 | `grid gap-1.5 px-2.5 pb-2`（`:1139-1140`） | `space-y-2 px-3 py-3`（`:1133`） | ⚠️ 间距/内边距略宽 |
| — | 已在位项 | — | 附件预览（`attachmentRefs` ✓）、hover 复制（`MessageBubble.tsx:313-330` ✓）、Markdown（`StreamBlocks` ✓）、running 态（`:1510-1530` ✓）、澄清/审批卡（`:1420-1500` ✓）、粘底 + 向上分页（`:1133-1150` ✓）、线程尾"回复"入口（`:1355-1390` ✓，单值 `activeReplyThread` 对齐 Hermes） | ✅ 已对齐 |

**B 的组合后果**：群聊里"你的气泡在右、成员白卡片在左、每条都带边框阴影" ⇒ 长讨论时消息区被切成一堆独立卡片，与 Hermes"一条条日志流"的可读性差一个量级；且成员靠 16px 首字母色块区分，@handle 又常驻在正文上方一行，前两行几乎都是元信息。

---

## C. 左栏 roster 行（"agent 行"）vs Hermes `bot-row`

| # | 项 | Hermes | ELEVE | 判定 |
|---|---|---|---|---|
| C1 | 头像 | `BotFace` 34px（含 mood，`bot-row.tsx:245-256`） | 28px 首字母圆 + 活跃脉冲点（`BotsView.tsx:236-273`） | ⚠️ 降级（无 BotFace 形态/表情；活跃已补 round-105/106） |
| C2 | 副行内容 | `@handle · ` **最后一条消息预览**（`bot-row.tsx:291-299`） | `@handle · 连接 · description`（`BotsView.tsx:286-295`） | ❌ **缺"最近一条"预览** |
| C3 | 相对时间 | `rowAgeTs`（`bot-row.tsx:285-290`） | **无** | ❌ 缺失 |
| C4 | 置顶/已隐藏标识 | 行内 `pinned` / `eye-closed` 图标（`:264` / `:269`） | 行内无（只在右键菜单） | ❌ 已置顶/已隐藏在行上看不出来 |
| — | 已在位 | 未读点（`SidebarRowLead`+`SessionStatusDot`） | `bg-success` 点 ✓ | ✅ |
| — | 已在位 | attention 角标 | `!` 琥珀标 ✓（round-104） | ✅ |

---

## D. 建议方案（**待老大拍板，本轮未动码**）

- **方案 1（彻底对齐 Hermes，推荐）**：把"Agent 卡片面板"从互斥 tab 降级为**侧栏底部常驻 rail**（Hermes `ProfileRail` 形态：横向方块、切身份、新建/右键管理）；model/provider/技能数元信息挪进编辑面板/独立 Profiles 管理面。左栏 agent 列表只留 roster（群聊面板内的 Agent section = 运行视图）。→ 消 R1/R2/R3，同时对齐 Hermes 结构。
- **方案 2（折中，改动小）**：保留两个入口，但 ① BotsPane section 改名"花名册"，Agent 面板改名"Agent 配置"；② 新建/编辑只留一处；③ 排序源合并为一份（卡片顺序改读 roster 的 pin/活动序，或反之）。
- **B 群聊消息区**：建议按 Hermes `renderEntry` 重写群聊条目渲染（单列 + 你的行整行淡底 + 成员 BotFace 24 + 名字可展开 + 补 dropzone），**不再复用 `MessageRow` 气泡**（复用带来 B1/B2/B3/B4 四项偏离）。
- **C roster 行**：补最后消息预览 + 相对时间 + 行内 pin/隐藏图标；头像是否上 BotFace 形态待定（需后端/资产侧支持）。

---

## 附：本轮取证文件清单

**ELEVE**（`eleve-chat-desktop/src`）
- `components/IconBar.tsx:52`（Agent 入口）、`plugins/bots/plugin.tsx:46-83`（群聊入口/pane 贡献）
- `components/SidePanel.tsx:92-110`（互斥面板表 + 插件回退）
- `components/AgentsPanel.tsx`、`components/ProfilePanel.tsx:91-205`（卡片）、`:386`（区块头）、`:210`（排序键）
- `components/BotsPane.tsx:851`（群聊 section）、`:891`（Agent section）
- `components/BotsView.tsx:191-317`（BotRosterRow）、`:317-1660`（BotsRoomView：头/活动条/事件流/输入区）
- `components/MessageRow.tsx:39-93`（user 气泡）、`:95-182`（assistant）、`components/MessageBubble.tsx:253-291`（user/agent 气泡样式）
- `services/bot-relay.ts:753-785`（union roster 唯一拉取口）

**Hermes**（`apps/desktop/src`）
- `app/chat/sidebar/index.tsx:1934` + `profile-switcher.tsx:148`（ProfileRail，底部常驻）
- `app/profiles/index.tsx`（Profiles 管理 overlay：左列表 + 右 soul）
- `plugins/hermes-bots/bot-row.tsx:222-300`（roster 行）
- `plugins/hermes-bots/group-chat-view.tsx:917-1040`（条目渲染）、`:1045`（到达序）、`:1106-1163`（容器/空态/running/底部）、`:648-692`（房头）
- `app/chat/sidebar/profile-switcher.tsx:800-826`（rail 的 fleet 远端分组）、`:846`（方块 = `ProfileGlyph`，无 model/provider）
- `plugins/hermes-bots/data.ts:646-651`（roster 数据源 = `profiles.list`）

---

# 追加：Agent 卡片 vs 群聊 Agent 行 —— 实体层深挖（2026-09-16 二轮）

> 🔴 **修正一轮结论**：一轮判定"是重复"下得太粗。下钻到实体/字段/行为三层后，
> **严格结论 = 三层都不重复，重复只发生在"入口与观感"层**，且根因不是"画了两遍"，
> 而是 **Hermes 的 `ProfileRail` 被放大成了互斥卡片面板**。

## 1. 三层判定

| 层 | 卡片面板（Agent tab） | 群聊面板 Agent 行（群聊 tab） | 判定 |
|---|---|---|---|
| **实体集合** | `profiles.list` = 本机配置目录全集（`utils/api.ts:389`），**不含远端** | `bots.roster`（`bot_chat.rs:118` `list_registered_profiles`）+ 全部远端连接（`bot-relay.ts:763-783`） | **交叉不等**：行多远端；卡片多"加载失败项" |
| **字段** | name / display_name / color / avatar / `model` / `provider` / `skill_count` / is_default / has_env（`ProfilePanel.tsx:29-41`） | profile / display_name / color / handle / `description` / `last_active` / `busy` / `stalled_secs` / `canonical_session_id` / pinned / hidden（`utils/api.ts:783-820`） | **交集仅 3 项**：标识、display_name、color（+avatar_key） |
| **点击行为** | `handleSelect` → `onProfileChange` 切 active profile，**纯前端、不写后端**（`ProfilePanel.tsx:350-363`） | `openBotChat` → `ensureBotChat` 打开该 bot 的 canonical 私聊（`BotsPane.tsx:887`） | **完全不同**：切身份 vs 开会话 |

**结论**：不是"同一份东西画两遍"。两面的职责与 Hermes 一一对应：
- 卡片面板 ↔ Hermes `ProfileRail`（切身份）
- 群聊面板 Agent 行 ↔ Hermes roster（联络册/开会话）

## 2. 集合边界的精确取证（后端）

- 启动时**全量注册**：`eleve-bin/src/main.rs:758-762` 遍历 `list_profiles()` 逐个 `hub.register` ⇒ 常态下 roster 的本机集合 == 卡片集合。
- 创建时**热注册**：`profiles.create` → bootstrapper → `ProfileHub::register`（`main.rs:153-211`）→ `registry.register_entry`（`:210`）写进 `managers` ⇒ 新建/复制的 Agent **立即进花名册**（`BotsPane.tsx:609` 的 `refreshUnionRoster()` 假设成立，**不是 bug**）。
- roster 权威源 = `list_registered_profiles()`（`profile_registry.rs:305`），注释 `bot_chat.rs:155-157` 明确"配置目录里有但未注册的不进名册"。
- 因此**实际会只在一边出现的只有两类**：
  1. **远端 Agent** → 只在群聊面板（卡片面板无）
  2. **配置加载失败的 profile**（`main.rs:775` `skip profile: load failed`）→ 只在卡片面板（合理：它确实不可用）

## 3. Hermes 侧的对照（差异真正在这里）

| | Hermes | ELEVE |
|---|---|---|
| roster 数据源 | **`profiles.list`**（`data.ts:646-651` 注释：*"Rich rows … come from the ACTIVE gateway's profiles.list"*） | `bots.roster`（运行时已注册）+ 远端 |
| 两个面是否同源 | ✅ **同源同集合**（rail 与 roster 都基于 profiles.list） | ❌ 两个 RPC、两套集合 |
| 远端覆盖 | rail **含 fleet 分组**（`profile-switcher.tsx:800-826`），roster 含多源 ⇒ **两面都能看到远端** | 只有 roster 能看到远端 |
| rail 形态 | `ProfileGlyph` 方块（`:846`），**无 model/provider/skill**，常驻侧栏底部 | 卡片：头像+名字+model+provider+技能数+默认徽章+删除，占整个左栏、互斥 tab |
| model/provider 在哪 | **Profiles 管理 overlay**（`app/profiles/index.tsx`）+ 编辑面板 | 直接在侧栏卡片上 |

## 4. 那"重复感"从哪来（4 个放大器，都可修）

1. **命名撞车**：区块头一个 `Agents`（`ProfilePanel.tsx:386`）、一个 `Agent`（`BotsPane.tsx:891`）。
2. **入口并排且互斥**：两个图标都在 IconBar，切一个就看不到另一个（`SidePanel.tsx:92-110`）——反而强化"为什么有两个"。
3. **交集部分长得一样**：同一批已注册的本机 agent，两边都是"同色头像 + 同一个 display_name" ⇒ 视觉上就是"这个 agent 出现了两次"。
4. **卡片承载了不属于身份切换器的信息**（model/provider/技能数）⇒ 卡片面板看起来像"agent 主列表"，与花名册撞车。**这在 Hermes 里属于 Profiles 管理面/编辑面板**。

## 5. 建议（按性价比排序，仍未动码）

- **P0 改名 + 单一写操作入口**：卡片面板 → "Agent 配置/身份"，花名册 section → "花名册"；新建/编辑/删除只留一处（Hermes 两处都能改名/删除，但 rail 是紧凑的，不构成困惑）。
- **P1 卡片面板"rail 化"**：常驻侧栏底部（对齐 `ProfileRail`），仅保留头像+名字；model/provider/技能数移入编辑面板。左栏 agent 列表只留花名册 ⇒ 重复感消失且结构对齐 Hermes。
- **P2 集合对齐**：卡片面板补远端/fleet 分组（对齐 rail），或至少在卡片上标出"该 Agent 未注册/加载失败"（现在静默）。
- **不推荐**：删掉群聊面板的 Agent section（那是 Hermes roster 的对应物，删了就丢了"开 bot 私聊 + 活跃/未读/attention"的运行视图）。

---

# 追加 2：能不能合并？—— 可行性判断（2026-09-16 三轮）

## 1. 硬约束：两个语义共用一个手势

| 面 | 单击含义 | 代码 |
|---|---|---|
| 卡片面板 | **切当前身份**（active profile） | `ProfilePanel.tsx:350-363` → `App.tsx:807` `handleProfileChange` |
| 花名册行 | **打开它的私聊**（canonical Bot Chat） | `BotsPane.tsx:887` `openBotChat` |

`handleProfileChange` 全仓只有**两个消费点**（`App.tsx:1663` 卡片、`App.tsx:1714` 宫格），
`openBotChat` 只有花名册行。⇒ **要点一下就能完成的两种动作，语义互斥**；
Hermes 的解法正是 rail（身份）+ roster（私聊）两个面各担一个。

**所以"把两个列表并成一个列表"必然要牺牲其中一方的手势**（改成双击/菜单项），
这不是 ELEVE 的设计缺陷，而是交互上的客观冲突。

## 2. 三个可选形态

### 方案 A：单列表，行承担两个语义（真合并，入口 2 → 1）
- 花名册行：单击 = 开私聊（**不变**）；双击 / 行菜单首项 = 「设为当前身份」
- 卡片面板退役（`ProfilePanel` + `AgentsPanel` 改造）；model/provider/技能数 → 行 tooltip + 编辑面板
- 项目区要有新家：agents 面板改为「项目」面板（只放 `ProjectTreePanel`），或并入文件抽屉
- 代价：**切身份从"一眼可见"降级为"菜单动作"**；`handleProfileChange` 需从卡片侧改接到花名册侧（新增 host 门，`contrib/host.ts`）
- 与 Hermes：**不齐**（Hermes 的 rail 是可见常驻的）
- 风险：中高（动 App 回调链 + 项目区）

### 方案 B：rail + 单列表（对齐 Hermes，**推荐**）
- 新增 `ProfileRail`（复用 `lib/agent-avatars.tsx` 的 `AgentAvatarSvg`）：常驻左栏底部，方块只显示头像 + 名字，单击 = 切身份
- 卡片面板退役 → agents 面板只留项目区（改名「项目」/「工作区」）
- model/provider/技能数 移入编辑面板（`EditAgentDialog`）
- 花名册行**原样保留**（开私聊 + 活跃/未读/attention + 完整行菜单）
- 收益：重复感消失 + 结构与 Hermes 1:1 + 切身份仍是可见常驻
- 改动面：新组件 + `SidePanel`/`IconBar`/`App` 三处接线 + `BotsPane` 底部插槽
- 风险：中

### 方案 C：全并进卡片（花名册退役）—— ❌ 不推荐
- 卡片要补：活跃/未读/attention/远端 + 完整菜单（置顶/隐藏/复制/移出分区）
- 卡片单击 = 切身份，开私聊还得再加按钮 ⇒ 卡片变成"什么都装"的重卡片（现状已过载）
- 风险：高，且丢掉运行视图

## 3. 若只想最小代价降重（不动结构）
1. 改名：`ProfilePanel.tsx:386` 的 `Agents` → 「Agent 配置」，`BotsPane.tsx:891` 的 `Agent` → 「花名册」
2. 把 model/provider/技能数从卡片移入编辑面板（卡片变薄，不再像"主列表"）
3. 两处写操作收一处（新建只在卡片；行菜单去掉"编辑 Agent"或反之）

→ 这三步能把"看着重复"消掉大半，且不碰 App 回调链与项目区。

---

# 追加 3：rail 是什么 + 落点选择（2026-09-16 四轮）

## 1. 名词
**rail = 贴边的一条窄轨**（UI 行话，类同 macOS Dock、VS Code 活动栏）。
**"常驻" = 它不随面板/会话切换而消失**，永远占侧栏那一条边，高度固定、不参与滚动。

## 2. Hermes 的实现坐标（供 1:1 对照）
- 挂载：`app/chat/sidebar/index.tsx:1934`
  `<div className="shrink-0 px-0.5 pb-1 pt-0.5"><ProfileRail /></div>`
  位置在 `SidebarContent` **最末、滚动区之外**，`shrink-0` = 固定高度不被压缩 ⇒ 任何 section 下都可见。
- 定义：`profile-switcher.tsx:148 export function ProfileRail()`
- 方块：`:846` `ProfileGlyph`（只有头像/首字母，**无 model/provider**）
- 含远端：`:800-826` `restGroups.map(...)` —— 其它网关的 agent 按分组进 rail（fleet）
- 交互：方块单击 = 切 profile；右键 = 重命名/删除/soul；末尾 `+` 新建（`:704-731`）

## 3. ELEVE 落点：放**面板容器外层**，不要放 BotsPane 内部
- 建议位置：`components/SidePanel.tsx` 的两个 return 分支（静态 `panels` 表分支 + 插件 `PluginPaneSlot` 分支）
  各自在 `flex-1` 内容区之后追加一个 `shrink-0` 的 rail。
  ⚠️ 两个分支都要插（`SidePanel.tsx:89-140` 与 `:146-160`），否则 bots 面板下 rail 会消失。
- 这样任何面板（Agent / 群聊 / 看板 / 定时任务 …）下都能切身份，最贴近 Hermes 的"常驻"语义。
- 若放 `BotsPane` 内部，则切到别的面板就看不到 ⇒ 退化成"另一个 tab 内容"，白做。
- 配套：Agent 面板腾空后只留项目区（可改名「项目」），`agentCount` 高度对齐逻辑（`SidePanel.tsx:44-46`）随之退役。

---

# 追加 4：群聊并入 Agent 面板 + 花名册语义（2026-09-16 五轮）

## 1. 花名册是不是和 Agent 卡片一个意思？

**不是同一个意思，但确实指同一批对象**（老大的直觉没错，差在"职责"）。

| | Agent 卡片 | 花名册行 |
|---|---|---|
| 回答的问题 | **我是谁**（身份档案） | **我要找谁聊**（联络入口） |
| 单击 | 切 active profile | 打开它的 canonical 私聊 |
| 数据源 | `profiles.list`（配置层） | `bots.roster`（运行时 + 远端） |
| 集合 | 本机配置全集 | 已注册本机 ∪ 全部远端 |
| 字段 | model / provider / skill_count | 活跃 / 未读 / attention / description |
| 粒度 | 一个 agent 一张卡 | 一个 agent 一行 |

⇒ 两者是**同一批实体的两个不同投影**（身份 vs 联络）。所以"合并"在思路上成立，
但要合的是**承载方式**（手势互斥，见追加 2），不是把两份数据揉成一份。

## 2. 群聊能不能并进 Agent 面板？分两种含义，结论不同

### (a) 群聊作为 Agent 面板里的一个区（同一面板既有 agent 又有群聊）
- ✅ **技术可行**：房间 store 是**全局**的（`bot_rooms_list` 只接 `include_disbanded`，`utils/api.ts:1028`，
  **不带 profile 参数**），群聊 section 与 Agent section 现在就是同级独立渲染块（`BotsPane.tsx:851` / `:891`）。
- ✅ **这正是 Hermes 的形态**：roster 一个面里就是"群聊行 + agent 行"（`bot-row.tsx` 的 `GroupRow` 与 `BotRow` 同列表）。
- ⚠️ **但直接搬会更乱**：搬过去后一个面板里会同时出现"Agents 卡片区 + 花名册 agent 行 + 群聊区 + 项目树"四个区，
  260px 栏位塞不下；而 Hermes 压得住这份混乱靠的是**分区机制**（`user-sections.ts` 247 行：创建/重命名/删除/排序/拖拽归档），
  **ELEVE 完全没有这套**（`sectionId` / `botSections` / `moveBotsToSection` 全仓零命中）。

### (b) 群聊挂在每个 agent 卡片下面（"这个 agent 的群聊"）
- ❌ **语义不成立，且会制造新重复**：
  - `BotRoom` **没有 owner / 归属 profile 字段**（结构里只有 `authority_gateway_id` 权威网关，`utils/api.ts:839-887`）
  - `bot_rooms_list` **不按 profile 过滤** ⇒ 房间是跨 agent、跨连接的共享空间
  - 一个房间的 `members` 可来自多个 agent ⇒ 挂在某个 agent 下必然"张冠李戴"
  - 若退让成"该 agent 参与的群聊"（成员里含它），则一个 3 人房会在 3 个卡片下各出现一次 = **新的重复**
- 对照：**项目**确实属于某个 agent —— `projects.tree` 是 per-profile 的
  （`ProjectTreePanel.tsx:53-60` 有"当前树数据归属的 profile"守卫 + 切 Agent 重拉）
  ⇒ **"agent 下挂项目"对，"agent 下挂群聊"不对**。老大对项目的判断准确。

## 3. 推荐形态：方案 D —— 单面板（四区）+ 底部 rail

```
左栏 Agent 面板（唯一 agent 入口）
├─ ① Agent 行列表   ← 花名册行（开私聊 · 活跃/未读/attention · 含远端）
├─ ② 群聊区         ← 房间行（进房间视图）
├─ ③ 项目树         ← 当前 agent 的项目（切身份自动换）
└─ ④ 常驻 rail      ← 切身份（卡片压成的方块轨）
```
- 群聊图标退役；如需保留"直接进群聊视图"的快捷方式，可让它只切主区视图 + 把左栏切到本面板。
- **前置条件（硬）**：卡片必须**先压成 rail**（腾出约 40% 高度），否则四区塞不进 260px 栏。
- **建议顺带做可折叠 section**（对齐 Hermes 思路），否则固定堆叠在 900px 高屏以下会很挤。
- 与方案 B 的区别：B 是"rail + 单列表，群聊留在自己面板"（改动小、不挤，但没做到"一个面板看全"）；
  D 是老大要的"一个面板看全"，代价是多一个分区/折叠机制的工作量。

## 4. 落地清单（方案 D）
1. `ProfilePanel` → 拆出 `ProfileRail`（只留头像+名字+单击切身份），挂 `SidePanel` 两个 return 分支底部（见追加 3）
2. `BotsPane` 的"群聊 section"抽出为 `RoomListSection`，供 Agent 面板复用
3. `AgentsPanel` 重排为四区（行列表 / 群聊 / 项目 / rail），加折叠态
4. `IconBar`：群聊图标退役或改为"主区快捷"
5. `App.tsx:1663` 的 `onProfileChange` 改接到 rail；`agentCount` 高度对齐逻辑退役
6. 回归点：切 Agent 后项目树/draft/滚动位置、群聊行 badge（needs-you）、远端行可达性

---

# 追加 5：行列表与 rail 合并 + 私聊入口分析（2026-09-16 六轮）

## 1. 老大的观察正确：方案 D 里 ①行 + ④rail 确实是同一个 agent 两个控件

两者都是"点一下就切身份"，一个带名字一个只有头像 ⇒ 严格重复。
（Hermes 也是 rail + roster 行并存，但它的 rail **贴底、只头像、无名字**，视觉上是"开关"而非"又一个列表"；
ELEVE 若把行也做成切身份入口，就必须二选一。）

## 2. 私聊会话是什么？—— **必须存在，但不必有独立点击手势**

后端定义（`crates/eleve-app/src/bot_chat.rs:53-56`，`INTRO_KICK_PROMPT` 原文）：

> "（系统）这是你的**常驻私聊通道**，刚刚建立。请用简短的一段话向用户自我介绍…"

双用途：
1. **用户与这个 agent 的常驻对话界面**（forever-chat，首行是 bot 自我介绍，round-76 做的本地化 intro kick）
2. **A2A 私信的落点与门控**（`crates/eleve-core/src/bot.rs:22`）：
   > "仅 canonical Bot Chat 会话可发 DM（title == `BOT_CHAT_TITLE`）"
   `bot_chat.rs:413` 同款注释："`BOT_CHAT_TITLE`（"Bot Chat"）= profile 的 canonical 私聊（**DM 落点/门控标志**）"

⇒ **删掉私聊会话 = 私信没有落点、也没有发信门控**（其他 agent 用 `message_agent` 发给它 → 无处可落，静默丢）。
⇒ 但"私聊"作为**一个独立的点击入口**完全没有必要 —— 它是会话，不是目的地。

## 3. 合并时的两个落地坑（必须处理）

### 坑① 私聊不在会话列表里
`crates/eleve-app/src/session_service.rs:736`：
```rust
exclude_sources.push(eleve_core::bot::BOT_PLATFORM.to_string());
```
⇒ canonical Bot Chat 被**主会话列表排除**（前端 `SessionsPanel.tsx:97` 同源排除）。
若"单击行 = 切身份 + 主区落到私聊"，会出现**主区显示一个列表里不存在的会话**：
用户看不到当前选中项、返回/切换会迷路。
**对策**：会话列表顶部**固定补一行「常驻私聊」**（取 roster 的 `canonical_session_id`），
让私聊可见、可选中、带未读 —— 这一步同时让"私聊不需要独立手势"成立。

### 坑② 切身份是重操作
`App.tsx:807-830` `handleProfileChange` 做的不只是换显示：`exitBotsToSingle()` →
写回当前 profile 会话指针（`saveProfilePointer`）→ `setCurrentProfile` → 恢复目标 profile 会话
（`loadSessionIntoView`）→ 清 `projectScopeCwd` / 新建落点。
⇒ 合并后"瞥一眼别的 agent"会变成"切换整个工作上下文"（切回可恢复，靠 `profile_session_map`）。
可接受，但要知情。

## 4. 方案 E（老大的思路，推荐）—— 一个 agent 一个控件

```
左栏 Agent 面板（唯一条目面）
├─ ① Agent 行    单击 = 切身份 + 主区落到它的常驻私聊（带活跃/未读/attention · 含远端）
├─ ② 群聊区      房间行（进房间视图）
└─ ③ 项目树      当前 agent 的项目（切身份自动换）
（取消 rail；群聊图标退役）
会话列表顶部固定一行「常驻私聊」 ← 补坑①
```
- 一个 agent **只出现一次** ⇒ 零重复（高于方案 D）
- "点它 = 找它说话" 三个动作合一，符合 Bot Mode 语义
- 行右键菜单保留"打开私聊 / 新建会话"，给需要在该身份下开别的会话的场景

### 代价（需老大确认）
- **取消 rail ⇒ 切身份必须先切到 Agent 面板**（rail 的"常驻"能力没了）。
  若接受"Agent 面板就是左栏默认常驻面板"，不构成问题；否则回到 Hermes 路线（rail 切身份 + 行开会话）。
- 落点语义变更：现在是"切身份 → 恢复上次会话"（`profile_session_map`），合并后建议改为"落到常驻私聊"。

### 待拍板的一个点
**单击 agent 行的落点**：
- (a) 落到它的**常驻私聊** ← 推荐（点它 = 找它聊，语义自洽、可预期）
- (b) 落到它**上次用的会话** ← 保留工作连续性，但"点它"的结果随历史变化，不可预期
- (c) 两者轮换/记忆开关 ← 不推荐（多一个心智负担）

---

# 追加 6：私聊 / 群聊会话系统深挖（2026-09-16 七轮 · 纯分析）

> 前提更正（老大明确）：**ELEVE 的 Agent 小卡片 = Hermes 的 rail**（点卡片切身份，项目 / 工作空间 / 会话联动）。
> 因此前几轮"把卡片压成 rail"的说法不成立 —— 卡片已经是 rail，只是**形态**是卡片。

## 1. 私聊（canonical Bot Chat）会话契约

| 项 | Hermes | ELEVE |
|---|---|---|
| 身份 | 标题**精确等于** `"Bot Chat"`；靠核心 **UNIQUE(title) 索引** ⇒ `(profile, "Bot Chat")` **就是注册表**（`canonical-chat.ts:38` `CANONICAL_CHAT_TITLE`，文件头注释："one bot, one forever-chat, resolved by exact title"） | 同：`resolve_session_by_title(BOT_CHAT_TITLE)`（`bot_chat.rs:361`）；metadata 打 `bot_session_title`（`:455`） |
| id 指针 | **刻意不存**：旧 `ui_meta['hermes-bots'].chat` 指针方式**已移除**（"every lost-chat incident traced to a dangled or stolen pointer"） | 同（标题寻址；round-121 注释也强调后端对 thread 零校验、不用不稳定 id） |
| 消息持久化 | ✅ gateway per-profile DB | ✅ per-profile `state.db` |
| 从侧栏隐藏 | 创建时传 `hidden: true`（`canonical-chat.ts:395` 注释："Always born hidden from the global sidebar — Bot Mode sessions are plugin-owned"） | 靠 `platform = BOT_PLATFORM` + 会话列表 `exclude_sources` 排除（`session_service.rs:736`）→ **机制不同、效果等价** |
| 配置跟随 | `follow_profile_config: true`（`canonical-chat.ts:400-404`）：resume **不恢复**旧 model/provider pin（否则 profile 换供应商后 bot DM 卡在死 provider） | 待核（未验证是否有等价机制） |
| 失败语义 | **FAIL CLOSED**：注册表查询失败/空结果都**不许**当"没有 chat"（否则 fork forever-chat，用户看到"我的 bot 失忆了"）；title 唯一性冲突 → **采纳赢家**而非新建 | 同族：**ADOPT-BEFORE-MINT**（`bot_chat.rs:473` 注释） |
| 运行态 | `epoch` / `running` **不持久化**（group-chat.ts:31） | driver leases/tasks **落库**（`bot_room_driver_leases` / `_tasks`）⇒ ELEVE 更持久（支持跨进程接管） |

## 2. 群聊（房间）持久化契约

| 项 | Hermes | ELEVE |
|---|---|---|
| 日志 | **双持久化**：本地插件 storage（`'group-chats'`，**完整编排日志 = 权威**）+ default profile 的 `ui_meta[GROUP_CHAT_SYNC_META_KEY]`（**有界投影**，供手机/其它客户端，带 revision CAS） | **共享根 `bot_rooms.db`**：`bot_rooms` 记录 + `bot_room_events` 完整事件日志（`bot_rooms_db.rs:384-410`） |
| 跨端同步 | 网关 `ui_meta` + `ui_meta_expected_revisions` CAS（`group-chat.ts:997-1030`） | **replica 机制**：`bot_room_replica_meta/_log` + `authority_gateway_id`/`epoch`/`last_ingested_seq` + 副本晋升（`BotsPane` 的接管） |
| 成员会话映射 | `room.sessions[memberKey] = storedSid`（随房间记录持久化） | 后端按 title 解析（见下 §4 的差异） |
| 成员会话 | 每个成员在自己 profile 下建 `Group: <roomId>`，`hidden: true` + **`room_plumbing: true`** + `follow_profile_config: true`（`group-turns.ts:212-223` 注释："Room member sessions are **plumbing** — always hidden from the sidebar"） | 每个成员 × 每个房间一个会话（`hosted_room/service.rs:17`），title = `Group: <房间名>` |

## 3. 私聊的会话有没有落项目 / 工作空间？—— **会话层没有，UI 层 Hermes 有、ELEVE 没有**

**会话层：两侧都不落项目**
- Hermes `session.create` payload = `{profile, title, hidden, follow_profile_config}` —— **无 cwd**（`canonical-chat.ts:391-405`）
- Hermes bot 主动发信用 `hermes -p <bot> chat --in ~ -c "Bot Chat"`（`plugin.tsx:15`）⇒ 工作目录 **`~`（profile home）**
- ELEVE `get_or_create(session_id, platform, user_id, chat_id, profile, metadata)`（`eleve-core/src/session/manager.rs:33-41`）—— **无 cwd 参数**；bot 会话 metadata 只有 `platform` + `bot_session_title`
- 群聊房间同理：`bot_rooms` 表字段 = room_id/name/members_json/image/next_seq/event_bytes/created_at/disbanded_at/pinned/hidden/roster_order —— **无 cwd / workspace / project 字段**

**UI 层：🔴 更正（八轮复核）—— 两侧都有，只是命名与形态不同，此处一轮曾误判为"缺口"**

- Hermes：每次 openSession 都骑 **`workspaceMode: 'bots'` + `workspaceOwnerKey = bot:<name|route>`**（`canonical-chat.ts:130-140` / `:330-345`），主区被标记为某个 bot 的上下文；composer 读这个 scope 决定分支 rail 是否收起
- ELEVE：**有等价机制** `store/workspace.ts`（文件头原文："对齐 Hermes **workspace-scope.ts** 的纪律：域状态一等建模 + 单写点"）：
  - `workspaceOwner: { kind: 'none' | 'bot-chat', key: sid }` = Bot 域焦点实体，**单写点** `App.tsx:840` 等
  - `botChatSessions`（判定 `isBotChatSession`，哪些会话是 canonical Bot Chat）**持久化 localStorage**（`eleve.bot_chat_sessions`，round-79c）
  - round-79e 终审裁定 **不设 `'room'` kind**：群聊焦点由插件域 `selectedRoomId` 承载（localStorage `eleve.bots.selectedRoomId`），理由是"避免同一事实第二写点"+"ELEVE 的 files 面板是**项目映射视图、不跟随会话**"，与 Hermes 的"workspace scope 是右栏 cwd 权威源"是**有理由的偏离**
- ⇒ 差别只在：Hermes 的 scope 是**每次 open 传参**（含 route/远端）；ELEVE 的 owner 是**长效 store + 判定持久化**。
  **不存在"缺 bot 上下文标记"的地基缺口**（一轮结论作废）。
- 附带情报（对合并计划有用）：ELEVE 已能判定"某会话是不是 bot 私聊"（`isBotChatSession`），
  且高频刷新点（`restoreProfileSession` / `loadSessionIntoView` @ `App.tsx:645`、`App.tsx:840`）都显式维护 owner，
  **但注释自陈"全仓 owner 值零读取（判定走 botChatSessions/viewMode）"** ⇒ owner 目前只作不变量账本，
  若新面板要"高亮当前私聊属于哪个 agent"，直接消费 `botChatSessions` 即可（不必新开写点）。

## 4. 为什么没有"新建会话"功能？—— 四个层次的原因

**(1) 私聊结构上不允许第二个**
canonical 是 **UNIQUE(title)** 的 forever-chat：一个 bot 一个 chat。创建第二个会被 title 唯一性拒绝
（Hermes → `already in use` 分支采纳赢家；ELEVE → ADOPT-BEFORE-MINT）。

**(2) Hermes 的"New chat with this bot"其实只对远端 bot 可用**
`data.ts:1078-1104` `newBotChat(bot)`：`if (!route) { notify('Update Hermes Desktop to open another Bot chat') ; return }`
`botConnectionRoute` 对本地 bot 返回 `null`（`routing.ts:81-89`）⇒ **本地 bot 点了会弹错误提示**。
所以 Hermes 对本地 bot **也没有**新建私聊 —— 更接近"有意留白/半成品"。

**(3) ELEVE 行菜单确实没有这一项**
`BotsPane.tsx:1023+` 行菜单 = 编辑 Agent / 复制 Agent / 置顶 / 隐藏（+ 移出分区不适用，ELEVE 无分区机制）。

**(4) 产品语义上也不该有** —— 若允许同一 bot 开第二个私聊：
- **A2A 私信落点唯一性被破坏**（DM 落到哪一个？ELEVE 的门控是 `eleve-core/src/bot.rs:22` "**仅 canonical Bot Chat 会话可发 DM**"）
- **人格连续性被切断**（forever-chat 的意义就是"一条不断的关系线"，首行是 bot 自我介绍）

**(5) 群聊不需要"新建会话"**：房间不是会话容器 ——
"新话题"的机制是**线程（thread）**（`group-chat-view.tsx:1044-1046`："thread ids scope replies and prompts, **not visibility**"），
成员会话是 plumbing（`room_plumbing: true`，隐藏、不可见）。**群聊 = 一条到达序日志 + 每成员一个管道会话**。

**(6) 如果确实想"另开一个会话与某 bot 干活"**：
正确形态是在 bots 工作区下开**普通会话**（Hermes `host.newChat(route, {workspaceMode:'bots', workspaceOwnerKey})`），
而不是给 canonical chat 开分支 —— 该能力 Hermes 只对远端开了，**ELEVE 完全没有**（可作为一个待补能力登记）。

## 5. 附带发现（潜在缺陷，建议单独评估）

**成员会话寻址键：Hermes 用不可变 roomId，ELEVE 用房间名**
- Hermes（`group-turns.ts:133-137` 注释）：
  > "New rooms title member sessions by their **immutable roomId** so a **same-name recreate never resumes the old room's sessions by title**; legacy rooms without a roomId fall back to the display name."
- ELEVE（`hosted_room/service.rs:17`）：`title = "Group: <房间名>"`；且 `service.rs:1566` 存在"成员会话 title 迁移"逻辑（改名时必须迁移，因为 title 就是寻址键）
- **后果**：房间改名要迁移 title（有窗口）；**同名房间重建时按 title 解析可能恢复旧房间的成员会话**（Hermes 专门用 roomId 规避）。建议评估改用 `room_id` 做寻址键。

## 6. 给"合并讨论"的结论性输入
- 私聊/群聊**都不落项目**，所以"agent 下挂项目"与"agent 下挂群聊/私聊"在**数据层同样不成立**（此前只判了群聊）
- 但私聊与 agent 的绑定是**一对一且结构唯一**（UNIQUE title），这与群聊"多对多共享"完全不同 ⇒
  **私聊天然属于某个 agent**（它是那个 agent 的常驻通道），**群聊不属于任何单个 agent**
- 因此信息架构上合理的只有两种：
  1. 私聊 ~ 与 agent 一对一（可以做成"点 agent = 进它的常驻通道"）
  2. 群聊 = 独立区（跨 agent 共享），不能变成 agent 的子项

---

# 追加 7：私聊上下文 / CWD / 上下文满了怎么办（2026-09-16 九轮）

> 触发：老大质疑"私聊上下文不持久化和私聊没有 CWD 吗？如果上下文满了怎么办"。
> 🔴 **两处表述需澄清/更正**（我此前的说法不准确）。

## 1. 更正 A：私聊上下文**是持久化的**（我此前只说了"运行态不持久化"，易被误读）

| 对象 | 是否持久化 | 证据 |
|---|---|---|
| 会话本体 + 消息 | ✅ per-profile DB | Hermes gateway SessionDB；ELEVE `eleve-store`（sessions 表） |
| 私聊身份 | ✅ 标题唯一索引（`(profile,"Bot Chat")`） | `canonical-chat.ts` / `bot_chat.rs:445-455` |
| **压缩血缘链** | ✅ `parent_session_id` + `end_reason='compression'` 落库 | Hermes `hermes_state_compression.py`（711 行，`_CHAIN_STEP_SQL`） |
| 压缩失败冷却/连败计数 | ✅ `compression_failure_cooldown_until` / `compression_failure_error` | 同上 |
| 群聊房间日志 | ✅ 双持久化（本地权威 + 网关投影） / ELEVE 共享根 `bot_rooms.db` | 追加 6 |
| **仅运行态**（`running` / `epoch` / 进行中的轮） | ❌ 不持久化（Hermes）／ELEVE driver leases **落库** | `group-chat.ts:31` |

⇒ 准确表述：**消息、身份、血缘、冷却全部持久化；只有"正在跑"的瞬时状态不持久化**。

## 2. 更正 B：私聊**有 cwd 概念**，只是**不绑定项目**

- 会话 cwd **是持久化字段**：Hermes `sessions.cwd`；ELEVE `eleve-store/src/session_db/mod.rs:461`（`cwd TEXT`）+ `workspace_id`（归属项目）
- **普通会话**创建时绑定落点：ELEVE `session.create` 带 cwd；`workspace_id` 由"落点 cwd 前缀匹配显式项目"推导（`mod.rs:2905-2910`）；前端 `resolveNewSessionCwd()` 决定（项目 scope → 项目根；无 scope → DETACHED/默认项目目录）
- **私聊（bot chat）不传 cwd**（Hermes `session.create` payload 无 cwd；ELEVE `get_or_create` 无 cwd 参数）
  ⇒ **workspace_id 为空 = 不属于任何项目**，运行目录回落到 **profile home（`~`）**
  ⇒ 铁证在 Hermes 侧：bot 主动发信 = `hermes -p <bot> chat --in ~ -c "Bot Chat"`（`plugin.tsx:15`）
  ⇒ ELEVE 侧同语义：`actor_types.rs:281`"cwd 由调用方（gateway 层，**Hermes `_session_cwd` 语义**）派生后传入"，私聊无显式 cwd → 走 fallback 链
- **结论**：准确说法是"**私聊不落项目（workspace_id 空），工作目录回落 home**"，
  而不是"没有 cwd"。这也解释了为什么从私聊里看不到项目上下文。

## 3. 核心问题：上下文满了怎么办 —— Hermes 有四层机制

### 第 1 层：自动压缩（阈值触发）
- `agent/context_compressor.py`（`threshold_tokens`）+ `agent/conversation_compression.py`（3784 行）
- 阈值按模型解析且**可自动抬高**（`agent_init.py:185 _resolve_compression_threshold` / `:1368 _compression_threshold`，`_compression_threshold_autoraised`）
- 另有 **micro compact**（细粒度，`MICRO_COMPACT_MARKER_KEY`）
- 每轮把阈值带进用量报告（`agent/turn_usage.py:131-140`）⇒ UI 能显示"距压缩还有多少"
- `codex_app_server_auto_compaction` 模式开关（`conversation_compression.py:3784`）

### 第 2 层：压缩 = 血缘链前进（身份不变）
- 压缩**不覆盖**会话，而是**派生 child session**：`parent_session_id` + `parent.end_reason='compression'`
- `get_compression_chain` / `_CHAIN_STEP_SQL`（`hermes_state_compression.py:26-47`）：向前走到**首选延续子会话**
  - 排除 branch（`_branched_from`）/ delegate（`_delegate_from`）/ `source='tool'`
  - 排序优先级：自身也是 compression → 未结束 → 已结束，再按 last_active/started_at/id
- ⇒ 注册表行（title）**永远是身份**，`resolved_id` = **活着的 tip**
  （`canonical-chat.ts:60-63` 原文："a compacted Bot Chat is on screen under its tip id while the registry still names it by the root"）
- **DM 落点因此不丢**：按 title 解析 → 走到活 tip（ELEVE 同款：`resolve_session_by_title` 支持"延续变体" + `resolve_session_key` 轮转别名，`manager.rs:46-51`）

### 第 3 层：并发与防抖
- **压缩锁 + 轮租约**：`_claim_lease_row`（单事务 claim，stale holder 可回收）⇒ 压缩与轮次互斥
- **失败冷却 + 连败计数**：`compression_failure_cooldown_until` / `compression_failure_error` ⇒ 不会被高频重试打爆

### 第 4 层：UI 层禁止 `/new`（关键产品决策）
`plugin.tsx:653-694` composer middleware：
```ts
const slashNew = /^\/(new|reset)\s*$/.exec(text.trim())
if (slashNew && isCanonicalChatOnScreen(row, focusedStoredSessionId)) {
  notify({ title: 'This chat never resets',
           message: 'Bot chats are one continuous conversation — compacting instead. ' +
                    'For a throwaway session with this bot, use Sessions mode.' })
  return { ...draft, text: '/compact' }   // ← 重写成压缩
}
```
- 注释原文："`/new` inside a bot's canonical forever-chat would **fork the relationship into a scratch session** — the one thing Bots mode promises never happens. Reroute to `/compact` (**same felt effect: fresh working context, SAME conversation**) … **Only guards the canonical chat**: Sessions-mode scratchpads on the same profile keep full `/new` freedom."
- 判定用 **STORE id**（用 runtime id 会恒 null → guard 静默失效，注释里记录了这个真实 bug）
- 权威文档 `apps/desktop/src/AGENTS.md:49-83` 三条红线：
  1. 一个 bot = 一个 forever-chat，身份 = (profile, 标题精确 `"Bot Chat"`)，**禁止任何 session-id 指针**（含"作为 fallback 层"）
  2. **Recency must never win**：私聊无条件隐藏于 Sessions 侧栏，bot 行是唯一入口
  3. **"Side-chats（New chat with this agent）不用 plumbing 标题、留在侧栏可见、永远不是 bot 行的目标"**；**禁止做 per-bot session browser**（#90732 已移除，"don't add it back"）

## 4. ELEVE 对照：机制齐备，缺"引导"一环

| 机制 | Hermes | ELEVE | 判定 |
|---|---|---|---|
| 自动压缩 | ✅ 阈值 + autoraise + micro compact | ✅ 有 `/compact`（`rpc_complete.rs:174` / `eleve-acp/src/server.rs:24`）+ 压缩态事件（`session-status.ts:37` compacting/compacted） | ✅ 基本齐备（ELEVE 未查到 autoraise/阈值命名，待核） |
| 血缘链 | ✅ parent_session_id + end_reason='compression' + chain 解析 | ✅ 标题"延续变体"解析（`bot_chat.rs:445`）+ **轮转别名** `resolve_session_key`（"压缩轮转/用户重命名后旧键继续可用"） | ✅ 等价 |
| 私聊内禁止新建 | ⚠️ **重定向到 `/compact`** + 提示替代路径（Sessions 模式） | ✅ 拦截 + 提示（`App.tsx:1004-1011` `isBorrowedBotChat` → notify"Bot Chat 是与该 Agent 的常驻会话，不支持新建会话"；`ContextBar` 新建按钮禁用；`/new` 命令走同一入口 `usePromptActions.handleNewSession` 被拦）+ **后端 `reset_session` fail-closed** | ⚠️ **差异**：ELEVE 只"拒绝+提示"，**没有重定向到 `/compact`**，也没给替代路径 |
| 僵尸会话防护 | ✅ 文档红线 + guard | ✅ 注释已记录风险："reset 会换 id 且 platform 变 ws，title 仍挂旧 sid → **DM 落进僵尸会话 = 消息黑洞**"（`App.tsx:1002-1003`） | ✅ 已识别 |
| 压缩并发/防抖 | ✅ 锁 + 租约 + 失败冷却 | 待核（未在 ELEVE 查到等价冷却字段） | ⚠️ 待核 |

### 结论（可落地的三条）
1. **ELEVE 不存在"上下文满了会失忆"的结构性风险** —— 血缘链 + 别名 + 标题解析三件套已具备，DM 落点不丢。
2. **唯一的实质差异**：私聊里用户输入 `/new`，Hermes **改成 `/compact` 并说明"会话不会重置，只压缩上下文"**；ELEVE 只弹"不支持新建会话"。
   ⇒ 建议对齐：**把拒绝改成重定向 + 提示替代路径**（"想要一次性会话，请到会话列表新建"）。改动很小（`App.tsx:1004-1011` 一处，加一条 `/compact` 注入路径）。
3. **cwd 语义建议在 UI 上说明**：私聊不绑项目（回落 home），若将来要在私聊里用项目文件，需要显式注入 cwd —— 这是"私聊与项目"关系的设计口子，目前两侧都没有。
