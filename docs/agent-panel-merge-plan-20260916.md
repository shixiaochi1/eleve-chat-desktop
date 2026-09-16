# Agent 面板整合计划（群聊 + 私聊并入 Agent 侧边页）

> 决策来源：老大 2026-09-16（十轮）
> - ① Agent 小卡片与私聊**不合并**（单击卡片仍 = 切身份）
> - ② **私聊入口 = 独立私聊区**（不是卡片内嵌按钮）
> - ③ **左侧工具栏取消「群聊」按钮**，全部并入 Agent 侧边页
> - ④ 版式（自上而下）：**Agent 卡片区 → 项目区 → 群聊 + 私聊区**
>
> 前提：ELEVE 的 Agent 小卡片 = Hermes 的 rail（点卡片切身份，项目 / 工作空间 / 会话联动）。
>
> ## 实施进度（2026-09-17）
>
> | 阶段 | 状态 | commit |
> |---|---|---|
> | P1 数据聚合（`hooks/useAgentPanelData.ts`） | ✅ | `f000a12` |
> | P2a 私聊区组件 | ✅ | `637cd2b` |
> | P2b 私聊行动作 + 菜单 | ✅ | `513751a` |
> | P3a 群聊分组编排 | ✅ | `0297ca4` |
> | P3b 群聊分组组件 | ✅ | `cf3511a` |
> | P4 三段版式挂载 | ✅ | `7f49952` |
> | **P4.5 架构收敛**（依赖方向 / 判据一致 / 单一职责，含 2 个真缺陷修复） | ✅ | `0be2bbc` |
> | P5 退役旧面板 + 群聊 IconBar 入口 | ✅ | `c1bd275` |
> | P6 回归 | 🔶 自动验证已过，**手测待老大**（下方清单） | — |
>
> 每阶段验证：`npx tsc -b` 干净 · `npx vitest run` 26 files / 354 tests · `npm run build` 成功。

---

## 一、目标版式（定案）

```
左栏 · Agent 面板（IconBar 仅保留这一个 agent 入口；「群聊」按钮取消）
├─ ① Agent 卡片区   点卡片 = 切身份（现状不变）；新建 Agent / 拖拽排序 / 双击编辑 / hover 删除
├─ ② 项目区         当前 agent 的项目树（现状语义不变，切身份自动换）
└─ ③ 群聊 + 私聊区   一个区、两个分组：
                    ├─ 群聊分组：房间行 → 单击进房间视图（新建 / 改名 / 解散 / 房间图 / 副本接管）
                    └─ 私聊分组：每 agent 一行 → 单击打开它的常驻私聊
                    头部：搜索 / 类型 / 活跃度 / 连接 过滤（承接原 BotsPane 工具栏）
```

主区三视图（单视图 / 宫格 / 房间视图 `viewMode='bots'`）不变；
插件 bots **保留** `mainView` 贡献 + relay 生命周期，**只退役** `sidePanel.pane` 与 `iconBar.action`。

---

## 二、关键设计决定（含理由）

### D1 私聊入口 = 独立私聊区（老大定案）
- 私聊行 = 一个 agent 一行，**单击 = 打开它的常驻私聊**（不切身份）
- 行的数据源 = **union roster**（`bots.roster` 本机 + 全部远端连接）⇒ 远端 agent 也有入口
- 行内容：头像 + `display_name` + `@handle` / 连接标 + **活跃点 + 未读点 + attention**
- 行右键菜单承接原花名册行：编辑 Agent / 复制 Agent / 置顶 / 隐藏（远端行骑 owner 连接）

### D2 远端 agent 只在私聊区出现（本轮推定，理由如下）
- **卡片区保持本机 `profiles.list`**：卡片语义是"切换当前身份"，而 ELEVE 的 active profile 是**本机概念**（`workspaceOwner` / 项目区 / 会话列表都按本机 profile 路由）；把远端 agent 做成卡片会给出一个点了不能切的假入口
- 远端 agent 的**全部真实能力**（开私聊 / 编辑 / 复制 / 置顶隐藏）都在私聊行上，无能力损失
- 对照：Hermes 的 rail 有 fleet 分组，但其 fleet 选择是"切换 active connection + profile"——ELEVE 没有这套连接级身份切换，故不照搬

### D3 「群聊」IconBar 按钮取消（老大定案）
- 进房间视图的入口 = 群聊分组的房间行（`selectRoom` + `openView('bots')`）
- `plugins/bots/plugin.tsx` 删除 `iconBar.action` 贡献（连带 `activePanelId: 'bots'` 高亮逻辑一起下线）

### D4 排序真值
- 卡片：`pinned` 优先 → localStorage `AGENT_ORDER_KEY`（现状）
- 群聊分组：房间 `pinned` → `roster_order`（现状 `lib/group-order.ts`）
- 私聊分组：沿用花名册排序（`pin` → 活动度，`lib/roster-filter.ts`）

### D5 重复感抑制（卡片 vs 私聊行 都有 agent，采用如下分工）
- **卡片 = 身份档案**：头像 / 名字 / (id) / model / provider / 技能数 / 默认徽章 —— **不放运行态徽标**
- **私聊行 = 聊天入口**：头像 / 名字 / handle / 连接 / 活跃 · 未读 · attention
⇒ 两处形态与信息不重叠，用户不会觉得"同一个东西列了两遍"

---

## 三、数据层设计（先做，无 UI 变化）

```
AgentCardRow（卡片区） = profiles.list（本机配置）
PrivateChatRow（私聊区）= union roster（bots.roster 本机 + 远端）
                        + unread（useBotUnread）+ attention（useBotAttention）
                        + 活跃（lib/bot-activity.ts：last_active / worker / gateway busy / stalled）
```
- 新增 hook：`hooks/useAgentPanelData.ts`（三个区的数据各一个 selector，单一聚合点，避免各组件重复拉取）
- 边界：
  1. 本机 profile 未注册（配置有但未进 roster）→ 卡片在、私聊行缺（Hermes 同款语义：票根只在配置层）
  2. 跨连接同名 → 私聊行按 `rosterRowKey`（`connectionId::profile`）区分
  3. 陈旧度：roster 5s 轮询，徽标随之刷新（可接受，不新增写点）

---

## 四、阶段与文件清单

### P1 — 数据聚合（无 UI 变化）
- **新增** `src/hooks/useAgentPanelData.ts`
- `ProfilePanel.tsx` 改为消费新 hook（渲染不变）
- 验证：卡片数量 / 名字 / 元信息与现状一致；`tsc -b`

### P2 — 私聊区组件（新）
- **新增** `src/components/bots/PrivateChatSection.tsx`
  - 行渲染：复用 `BotsView.tsx:191-317` `BotRosterRow` 的徽标实现（活跃/未读/attention/连接标），去掉"编辑"以外的花名册语义
  - 点击：本机 → `onOpenBotChat(profile)`（`ensureBotChat`）；远端 → `openRemoteBotChat(row)` + `openView('bots')`
  - 行菜单：沿用 `BotsPane` 现有 `rowMenu`（编辑 / 复制 / 置顶 / 隐藏）
- 验证：本机与远端私聊均能打开；徽标与现状一致

### P3 — 群聊区组件（新，承接原 BotsPane 群聊段）
- **新增** `src/components/bots/RoomListSection.tsx`，自 `BotsPane.tsx` 迁入：
  - `RoomCard`（`:116-215`）、群聊 section 头与列表（`:845-877`）
  - 新建群聊弹层、房间菜单（改名/成员/房间图/解散）、副本接管区（`:790-840`）
  - 依赖直接 import `plugins/bots/state.ts`（rooms / selectedRoomId / needsYou / clarify 已是插件域单一权威）
- 验证：房间全流程（新建 / 改名 / 成员增删 / 图 / 解散 / 接管）

### P4 — 版式整合（卡片 / 项目 / 会话区）
- `AgentsPanel.tsx` 重排为三段（顺序：卡片 → 项目 → 群聊+私聊）
- 各段可折叠（折叠态 localStorage 持久化）；默认：三段全展开，空间不足时群聊分组自动折叠（阈值：房间数 > 6 或容器高 < 520）
- 高度分配：卡片区自然高度（`max-h-[40%]` 保护）→ 项目区 `flex-1` → 会话区 `flex-1`（含 min-h-0 + 内部滚动）
- **退役** `agentCount` 高度对齐链（`SidePanel.tsx:44-46` 注释 / props / `App.tsx handleProfilesChange`）——原诉求（切身份时项目区不抖动）改由"固定三段骨架 + 折叠态"保证
- 工具栏（搜索/类型/活跃度/连接过滤）挂会话区头部，作用于群聊 + 私聊两个分组
- 验证：260px 栏内无双重滚动条；切身份项目区零抖动

### P5 — 退役与瘦身
- `plugins/bots/plugin.tsx`：**删** `sidePanel.pane` + `iconBar.action`；**保留** `mainView` + `startBotRelay/stopBotRelay`
- `components/SidePanel.tsx`：bots 不再走 `PluginPaneSlot`（通用回退保留）
- `components/BotsPane.tsx`：迁空后删除；`BotsView.tsx` 移除 `BotRosterRow` 并清理反向 import
- `components/IconBar.tsx`：无改动（群聊按钮来自插件贡献，随贡献删除即消失）
- 验证：禁用 bots 插件 → 房间视图 + relay 一并停

### P6 — 回归与收尾
- `npm run build` / `tsc -b` / `vitest run`（涉及 BotsPane / roster 的测试同步更新）
- 手测清单（见下）
- 更新交付文档（`docs/` 被 gitignore，随仓分发需 `git add -f`）

---

## 五、手测清单

1. 单击卡片 → 切身份；项目树 / 会话列表 / 右栏 / 草稿联动正确
2. 双击卡片 → 编辑面板；hover 删除；拖拽排序持久化
3. 私聊行单击 → 本机打开 canonical Bot Chat；远端打开远端私聊视图
4. 私聊行徽标：活跃 / 未读 / attention / 卡死红点，与现状一致
5. 私聊行菜单：编辑（远端骑 owner 连接）/ 复制 / 置顶 / 隐藏
6. 群聊分组：新建 / 改名 / 成员增删 / 房间图 / 解散 / 副本接管
7. 群聊行 needs-you 与私聊行 attention 各自正确、不串台
8. 工具栏过滤（搜索 / 类型 / 活跃度 / 连接）同时作用于两个分组；"显示已隐藏"包含两者
9. 三段折叠：刷新后保持；容器高度不足时群聊分组自动折叠
10. IconBar 无「群聊」按钮；进房间视图只能经群聊行
11. 插件禁用：主区房间视图消失、relay 停

---

## 六、风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R1 | 260px 栏塞三段（卡片 + 项目 + 会话）过挤 | 三段可折叠 + 群聊分组按阈值自动折叠 + 项目区与会话区共享剩余高度 |
| R2 | 卡片与私聊行都是 agent，观感重复 | D5 分工：卡片只做身份（无运行态徽标），私聊行只做聊天入口 |
| R3 | 高度对齐旧机制退役后切身份抖动回归 | 固定三段骨架（高度由折叠态决定，不由内容决定） |
| R4 | 排序三套（卡片 localStorage / 房间 order / 私聊 pin+活动） | 三处各自独立，互不干扰；不强行统一 |
| R5 | `BotsView ↔ BotsPane` 反向依赖 | 先建新组件再删旧引用，分两次提交 |
| R6 | 插件退役误伤 relay / 主区视图 | P5 明确保留 `mainView` + relay；手测 11 覆盖 |
| R7 | 群聊焦点状态漂移 | 仍由 `selectedRoomId`（`eleve.bots.selectedRoomId`）单一权威承担，不新开写点（对齐 round-79e 裁定） |

---

## 七、明确不做（边界）

- **不动**卡片单击语义（老大决策①）
- **不动** `store/workspace.ts` 的 owner 模型（不新增 `'room'` kind）
- **不动**主区三视图
- **不动**后端（纯前端；`Group: <房间名>` 寻址键缺陷另行立项）
- **不改**私聊会话落点（不落项目、回落 profile home）
- 本次**不含**"`/new` → `/compact` 重定向对齐"（另行小改动，见审查报告追加 7 §4）