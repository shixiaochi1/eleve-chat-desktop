# Eleve 桌面前端 — 多 Agent UI 架构方案

> 版本: v1.0 | 日期: 2026-07-28 | 状态: 基础方案（讨论中）

## 一、现状诊断

当前前端是**单 Profile 单会话架构**，五个全局单例：

| 单例 | 位置 | 问题 |
|------|------|------|
| `messages: ChatMessage[]` | store/messages.ts 模块级变量 | 全 app 只有一个消息数组 |
| `activeProfile` | ws-client.ts 模块级变量 | sendRpc 盖章只认一个 profile |
| `sess` (useSessions) | App.tsx 单实例 | 一个 sessionId、一份 msgCache |
| `activeClarify/activeApproval` | App.tsx 单实例 | 同时只能有一个审批/澄清卡片 |
| `isStreaming` | store/messages.ts 单原子 | 全局只有一个"正在输出"状态 |

Profile 切换是**破坏性切换**——handleProfileChange 8 项清单本质是"炸掉当前聊天上下文再重建"。
切一次 Agent，之前的对话现场就没了。不是真正的多 Agent UI，只是"换人设"。

## 二、两种模式定义

### 模式 A：卡片点选（Tab 模型）
- 同一时刻渲染一个 Agent 的状态，但所有 Agent 的状态**活着**
- 切换 = 换视图，不是炸状态
- 对齐 Hermes 行为语义：profile 切换 = scope 切换，不是销毁重建

### 模式 B：多宫格（分屏模型）
- 同时渲染多个 Agent 的状态，每个宫格是一个完整的迷你聊天窗口
- 定位：**并行监督**——3-4 个 Agent 同时跑任务，一眼看到谁在输出、谁卡住、谁等审批
- 不是深度对话模式——格子太小，长对话不舒服

### 核心结论
两种模式不是二选一，是互补的，共享同一个架构前提——**per-profile 状态隔离**。
状态隔离做对了，两种模式只是"渲染 1 个 store"和"渲染 N 个 store"的区别。

## 三、共同前提：Per-Profile 状态隔离

| 改造项 | 现状 | 目标 |
|--------|------|------|
| 消息 store | 全局单例数组 | `Map<profile, MessageStore>` 注册表，每个 store 独立 subscribe/snapshot/isStreaming |
| 会话状态 | App 级单实例 useSessions | 每个 profile 独立 sessionId + msgCache + 会话列表 |
| WS 事件路由 | useMessageStream 全量消费 | 路由器解析 session_id 前缀 `agent:<profile>:ws:xxx` → 分发到对应 profile 的 store |
| RPC 盖章 | 模块级 activeProfile | sendRpc 显式传 profile 参数（宫格模式下多 profile 并发发 RPC） |
| 审批/澄清 | App 级单实例 | per-profile 独立——宫格模式下 A 等审批、B 在输出，互不阻塞 |

### 后端已具备的条件
- session_id 前缀路由（resolve_by_session_id() 解析 `agent:<profile>:...`）是 per-session 的
- 不依赖 WS 连接身份，一条 WS 连接可同时承载多个 profile 的会话
- 事件按 session_id 分发即可——宫格模式可行的后端基础

## 四、模式 A 设计要点

### 非破坏性切换
- 点卡片 → 聊天区瞬间切换（零加载、零清空），状态一直在内存里
- 切走时 Agent 还在干活，切回来能看到现场

### 活动指示（卡片上）
- 正在输出（streaming 动画）
- 有未读回复（badge 计数）
- 等审批（警告色标记）
- 这是多 Agent 的核心价值

## 五、模式 B 设计要点

### 硬约束（物理限制）
- 1080p 屏幕：标题栏+状态栏吃掉 ~50px，每个宫格最低 ~350px（聊天区+输入框），最多 2 行
- 宽度：去掉图标栏 52px + 侧面板 260px，1920 屏剩 ~1600px，最多 2-3 列
- 宫格上限 = 2×2 = 4 个 Agent。超过 4 个自动降级回模式 A

### 关键设计决策
1. **每个宫格自带输入框**（tmux 模式）——不搞共享输入框，避免"我在跟谁说话"的歧义
2. **点击宫格 = 聚焦**，聚焦态有明确视觉边界（边框高亮），键盘快捷键循环切换焦点
3. **非聚焦宫格降级渲染**——正在输出的非聚焦宫格只显示纯文本/最后一条预览，不做完整 Markdown 渲染（N 个宫格同时流式渲染 Markdown 是性能炸弹）
4. **审批卡片跟着宫格走**——哪个 Agent 等审批，审批卡片出现在那个宫格里。A 等审批点 A 的批准，B 的输出完全不受影响

## 六、实施路径

```
Phase 1: Per-Profile 状态隔离（地基）
  - store 注册表 + 事件路由器 + RPC 显式 profile
  - 验收：切换 Agent 零清空，切回来现场还在

Phase 2: 模式 A 完善（Tab 模型）
  - 卡片活动指示（streaming/未读/等审批）
  - 验收：A 在输出时切到 B，A 的流不中断，切回 A 看到完整输出

Phase 3: 模式 B（宫格）
  - 布局引擎（1×2 / 2×1 / 2×2）+ 聚焦管理 + 降级渲染
  - 验收：4 Agent 并发流式输出不卡顿
```

## 七、风险项

1. **Hermes Desktop 无宫格模式**——模式 B 是 Eleve 原创功能，无参考实现对齐
2. **并发多 profile 流式事件分发**——需在 Phase 1 端到端验证：事件 payload 里的 session_id 是否在所有事件类型（delta/tool_call/clarify/approval）上都携带，需逐个事件类型确认
3. **性能**——N 个 profile 同时 streaming 时，RAF batch flush 需要 per-store 独立调度，不能共享一个全局 RAF

## 八、待讨论

- [ ] 模式切换入口（工具栏按钮？快捷键？）
- [ ] 宫格模式下侧面板行为（隐藏？缩窄？跟随聚焦宫格？）
- [ ] 宫格模式下右侧文件面板行为
- [ ] 未读计数的持久化（刷新页面后是否保留）
- [ ] 模式 B 的布局选择器（用户手动选 2×2 还是自动根据 Agent 数量）
