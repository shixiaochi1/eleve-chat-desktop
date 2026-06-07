# P8: 消息数据模型对齐 Hermes — parts 数组架构迁移

## 问题根因

**Eleve 每条 SSE 事件 = 一条独立 ChatMessage**：
```
[user, tool, tool, reasoning, agent, usage]  ← 6条消息
```

**Hermes 一轮对话 = user + assistant（内含 parts 数组）**：
```
[
  { role: 'user', parts: [{ type: 'text', text: '...' }] },
  { role: 'assistant', parts: [
    { type: 'reasoning', text: '...' },
    { type: 'tool-call', toolName: 'search', args: ..., result: ... },
    { type: 'tool-call', toolName: 'read_file', args: ..., result: ... },
    { type: 'text', text: '这是回复...' }
  ]}
]
```

差异导致：
1. buildGroups() 把 tool/reasoning/agent 归入同一 turn → 视觉糊成一坨
2. 无法实现工具调用折叠/展开交互
3. SSE 流式更新逻辑复杂（每个 type 单独查找/更新）

## 目标

1:1 对齐 Hermes 数据模型：`ChatMessage.parts: ChatMessagePart[]`
每条 assistant 消息包含 reasoning/text/tool-call parts。

## 影响范围

| 层 | 文件 | 改动 |
|---|---|---|
| 类型定义 | `src/types/index.ts` | ChatMessage 新增 parts 字段 + ChatMessagePart 接口 |
| SSE 流处理 | `src/hooks/useMessageStream.ts` | onToolStart/onToolArgs/onToolEnd/onReasoning/upsert 到 assistant.parts |
| 消息 store | `src/store/messages.ts` | signature 生成需基于 parts 结构 |
| 历史加载 | `src/hooks/useSessions.ts` | 后端原始消息 → toChatMessages() 合并转换 |
| 消息渲染 | `src/components/MessageContainer.tsx` | SingleMessageItem → AssistantMessageParts 渲染 |
| 消息组件 | `src/components/MessageBubble.tsx` | 无改动（仍渲染 markdown） |
| 工具组件 | `src/components/ToolCallCard.tsx` | 改为接收 ChatMessagePart 而非独立消息 |
| 推理组件 | `src/components/ReasoningBlock.tsx` | 改为接收 part 而非独立消息 |
| 消息合并 | 新建 `src/lib/chat-messages.ts` | 1:1 从 Hermes 迁移 toChatMessages + upsertToolPart |

## 分阶段任务

### Phase 1: 类型基础 + 消息合并库（无渲染改动）

**目标**：建立 parts 数据结构，实现 Hermes 的 toChatMessages()，验证数据转换正确性。

- [ ] T1.1 定义 `ChatMessagePart` 类型（1:1 对齐 Hermes）
  - `{ type: 'text', text: string }`
  - `{ type: 'reasoning', text: string }`
  - `{ type: 'tool-call', toolCallId: string, toolName: string, args: Record<string, unknown>, argsText: string, result?: unknown, isError?: boolean }`
- [ ] T1.2 更新 `ChatMessage` 接口
  - 新增 `parts?: ChatMessagePart[]`（可选，兼容旧数据）
  - 新增 `role: 'user' | 'assistant'` 字段
  - 保留 `type`/`content` 等旧字段作为兼容层
- [ ] T1.3 迁移 `src/lib/chat-messages.ts`（从 Hermes 1:1 复制核心函数）
  - `toChatMessages()` — 后端 SessionMessage[] → ChatMessage[]（含 parts）
  - `upsertToolPart()` — SSE tool 事件 → parts upsert
  - `appendTextPart()` / `appendReasoningPart()` — SSE 文本/推理追加
  - `findToolPartIndex()` — 工具匹配（ID + 名称 + 上下文）
  - 约 400 行，从 Hermes chat-messages.ts 截取核心逻辑
- [ ] T1.4 编写单元测试验证 toChatMessages 合并逻辑

**验证**：tsc 零错误 + toChatMessages 单测通过 + 现有渲染不受影响（parts 可选）

### Phase 2: SSE 流处理迁移

**目标**：useMessageStream 的 SSE 回调从"push 独立消息"改为"upsert parts 到 assistant 消息"。

- [ ] T2.1 改造 `flushThrottled` 中的 text/reasoning 更新逻辑
  - 当前：查找 `type==='agent' && _streaming` 消息 → 更新 content
  - 目标：查找 `role==='assistant'` 消息 → appendTextPart / appendReasoningPart
- [ ] T2.2 改造 `onToolStart`
  - 当前：`storeSetMessages(prev => [...prev, { type: 'tool' }])`
  - 目标：获取/创建当前 assistant 消息 → `upsertToolPart(parts, payload, 'running')`
- [ ] T2.3 改造 `onToolArgs`
  - 当前：更新独立 tool 消息的 argsStr
  - 目标：upsert tool-call part 的 args
- [ ] T2.4 改造 `onToolEnd`
  - 当前：更新独立 tool 消息的 status
  - 目标：upsert tool-call part 的 result
- [ ] T2.5 改造 `onUsage`
  - 当前：push 独立 usage 消息
  - 目标：append 到 assistant 消息的 parts（或保留为独立消息，待定）
- [ ] T2.6 改造 `onDone` 的 `_streaming` 清理
  - 当前：`updateMessagesWhere(m => m._streaming ? { _streaming: false } : null)`
  - 目标：assistant 消息标记 pending=false

**验证**：流式对话测试——发送消息，确认 assistant 消息包含完整的 parts 数组

### Phase 3: 消息渲染层适配

**目标**：SingleMessageItem 根据 parts 数组渲染，每类 part 独立显示。

- [ ] T3.1 新增 `AssistantMessageParts` 组件
  - 遍历 `message.parts`，按 type 分派渲染：
    - `reasoning` → `<ReasoningBlock />`
    - `text` → `<MessageBubble type="agent" />`
    - `tool-call` → `<ToolCallCard />`
  - 每个 part 之间有 `gap-2` 间距（对齐 Hermes 的 `--conversation-turn-gap`）
- [ ] T3.2 更新 `SingleMessageItem`
  - `type === 'agent'` 且有 `parts` → 渲染 `<AssistantMessageParts />`
  - 无 `parts`（兼容旧数据）→ 走现有 MessageBubble 逻辑
  - 删除 `type === 'tool'` / `type === 'reasoning'` / `type === 'usage'` 分支
    （这些不再作为独立消息存在）
- [ ] T3.3 TurnGroup 容器加 `gap-3`
  - 当前：`<div className="relative flex min-w-0 flex-col">`
  - 目标：`<div className="relative flex min-w-0 flex-col gap-3">`
- [ ] T3.4 更新 `buildGroups` 逻辑
  - 合并后一轮只有 user + assistant 两个条目
  - turn group 包含 2 个 index：[user, assistant]
  - standalone 保持不变

**验证**：视觉确认——每条消息独立气泡，tool/reasoning/文本各有间距

### Phase 4: 历史消息加载适配

**目标**：loadHistory 返回的消息也使用 parts 模型。

- [ ] T4.1 确认后端 `/api/parse-messages` 是否需要改造
  - 如果后端返回的已经是 Hermes SessionMessage 格式 → 前端调用 toChatMessages() 转换
  - 如果后端返回扁平格式 → 前端 toChatMessages() 负责合并
- [ ] T4.2 更新 `loadHistory` 流程
  - 当前：`api.getSessionHistory → call('parse_messages') → ChatMessage[]`
  - 目标：`api.getSessionHistory → toChatMessages(raw) → ChatMessage[]`
- [ ] T4.3 处理会话缓存兼容
  - msgCache 中的旧格式消息（无 parts）→ 兼容渲染
  - 新格式消息（有 parts）→ 走新渲染路径

**验证**：切换历史会话，确认消息显示正确

### Phase 5: 清理 + 最终验证

- [ ] T5.1 移除 ChatMessage 中不再需要的扁平字段
  - `callId` / `toolName` / `argsStr` / `resultStr` / `status` → 已迁移到 parts
  - 保留为可选字段做兼容，标注 `@deprecated`
- [ ] T5.2 移除 `SingleMessageItem` 中 `type === 'tool'` / `'reasoning'` / `'usage'` 分支
- [ ] T5.3 全量 `tsc --noEmit` + `vite build` 验证
- [ ] T5.4 端到端测试：新会话 + 历史会话 + 流式 + 工具调用 + 推理
- [ ] T5.5 提交 P8 快照

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 历史缓存不兼容 | parts 字段可选，渲染层双路径兼容 |
| upsertToolPart 匹配逻辑复杂 | 1:1 从 Hermes 复制，含完整 test |
| Phase 2 改动面大 | 先建新路径，后删旧路径，每步可验证 |
| 后端 /api/parse-messages 格式不确定 | Phase 4 优先探明后端实际返回格式 |

## 预估工作量

- Phase 1: 类型 + 合并库 — 2h
- Phase 2: SSE 流处理 — 2h
- Phase 3: 渲染层 — 1h
- Phase 4: 历史加载 — 1h
- Phase 5: 清理验证 — 0.5h
