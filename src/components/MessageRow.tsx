/**
 * MessageRow — 纯渲染单条消息（store 解耦）
 *
 * 从 MessageContainer 的 SingleMessageItem 提取而来：parts 分组渲染（reasoning /
 * text / tool-group / special-tool）+ legacy 扁平字段兜底。
 *
 * 设计目的：单视图（VirtualizedThread）与宫格（AgentChatCard）共用同一套消息渲染，
 * 零重复。store 耦合（useMessage 读取 / setMessages 删除）留在各自 wrapper，本组件
 * 只接收 `message` 数据 + 可选 `onDelete`，是纯函数式渲染组件（无 hook、无 store 引用）。
 *
 * onDelete 为 undefined 时（宫格场景）MessageBubble 自动隐藏删除按钮。
 */
import { memo } from 'react'
import MessageBubble from './MessageBubble'
import SystemMessage from './SystemMessage'
import ReasoningBlock from './ReasoningBlock'
import ToolEntry, { type ToolCallItem } from './ToolEntry'
import HoistedTodoPanel, { todosFromMessageParts } from './HoistedTodoPanel'
import StreamStallIndicator from './StreamStallIndicator'
import type { ChatMessage, ChatMessagePart } from '@/types'

interface MessageRowProps {
  message: ChatMessage
  /** 删除回调；undefined 时不显示删除按钮（宫格只读场景） */
  onDelete?: (messageId: string) => void
  /** 会话 ID（artifact 版本注册按会话隔离，对齐 Hermes） */
  sessionId?: string | null
}

export const MessageRow = memo(function MessageRow({ message: m, onDelete, sessionId }: MessageRowProps) {
  if (!m || m.hidden) return null

  // ── Parts-based rendering ──
  if (m.parts && m.parts.length > 0) {
    if (m.role === 'user') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('')
      return <div data-message-id={m.id} className="flex justify-end px-4 mb-1.5"><MessageBubble type="user" content={text} timestamp={m.timestamp} messageId={m.id} onDelete={onDelete} /></div>
    }

    if (m.role === 'assistant') {
      // ── 🔴 Phase 3: 到达序渲染 + 工具永不分组（对齐 Hermes ToolGroupSlot）──
      // 每个 tool-call 独立成行（稳定 callId key）：流式碎片 vs 落定整段像素级一致，无落定重排。
      // 稳定 key（审查 #4）：text/reasoning 用同类型序号（parts 只追加不重排，序号稳定），
      // tool 用 toolCallId — 消灭 index key 导致的 finalize 重建/折叠态丢失。
      type RenderItem =
        | { kind: 'reasoning'; key: string; text: string; done?: boolean; idx: number }
        | { kind: 'text'; key: string; text: string; isLast: boolean }
        | { kind: 'tool'; key: string; tool: ToolCallItem }

      const renderItems: RenderItem[] = []
      let textOrdinal = 0
      let reasoningOrdinal = 0
      // 流式文本（最后一个 text part）— 供 StreamStallIndicator 做进展检测
      let streamText = ''

      for (let pi = 0; pi < m.parts.length; pi++) {
        const part = m.parts[pi]

        if (part.type === 'tool-call') {
          renderItems.push({
            kind: 'tool',
            key: `tc-${part.toolCallId || `${m.id}-${pi}`}`,
            tool: {
              name: part.toolName,
              callId: part.toolCallId,
              argsStr: part.argsText,
              resultStr: part.result != null ? (typeof part.result === 'string' ? part.result : JSON.stringify(part.result)) : undefined,
              // 🔴 Phase 3: 消费 isError（审查 #6：失败工具不再显示绿勾）
              status: part.isError ? 'error' : part.result != null ? 'done' : 'pending',
            },
          })
        } else if (part.type === 'reasoning') {
          renderItems.push({ kind: 'reasoning', key: `r-${m.id}-${reasoningOrdinal}`, text: part.text, done: part.done, idx: reasoningOrdinal })
          reasoningOrdinal++
        } else if (part.type === 'text') {
          streamText = part.text
          renderItems.push({ kind: 'text', key: `t-${m.id}-${textOrdinal}`, text: part.text, isLast: pi === m.parts.length - 1 })
          textOrdinal++
        }
      }

      // 从 parts 中提取 todo 列表（对齐 Eleve HoistedTodoPanel）
      const hoistedTodos = todosFromMessageParts(m.parts)

      return (
        <div data-message-id={m.id} className="flex flex-col gap-2.5 px-4 mb-1.5">
          {hoistedTodos.length > 0 && <HoistedTodoPanel todos={hoistedTodos} />}
          {renderItems.map(item => {
            switch (item.kind) {
              case 'reasoning':
                // 🔴 Phase 3: pending 自门控（审查 #7）— 仅未冻结（!done）块随消息 pending，
                // 已 reasoning.end 的块不再显示“思考中”计时器；块级 timerKey 消灭多块同读数。
                return <ReasoningBlock key={item.key} text={item.text} visible={!!item.text} messageId={m.id} blockIndex={item.idx} pending={!!m.pending && !item.done} />
              case 'text':
                return (
                  <MessageBubble
                    key={item.key}
                    type="agent"
                    content={item.text}
                    streaming={!!m.pending && item.isLast}
                    timestamp={m.timestamp}
                    messageId={m.id}
                    onDelete={onDelete}
                    sessionId={sessionId}
                  />
                )
              case 'tool':
                return <ToolEntry key={item.key} tool={item.tool} />
            }
          })}
          {m.error && <MessageBubble type="error" content={m.error} />}
          {/* 流式停滞提示（对齐 Hermes StreamStallIndicator）：12s 无进展显示“正在思考” */}
          {m.pending && <StreamStallIndicator text={streamText} />}
        </div>
      )
    }

    if (m.role === 'system') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('')
      // 对齐 Hermes SystemMessage 三形态（steer: / slash: / 普通居中）—
      // 斜杠命令状态回显用 mono 命令 + 输出布局，不再走 MessageBubble 纯文本居中
      return <div data-message-id={m.id} className="px-4 py-0.5"><SystemMessage text={text} /></div>
    }
  }

  // ── P2-4: Legacy fallback（防御性兜底） ──
  // toChatMessages 和流式累加器总是产 parts，此路径在当前代码中不可达。
  // 保留为防御：旧缓存/异常数据混入时不至于白屏。
  if (import.meta.env.DEV) {
    console.warn('[MessageRow] Legacy fallback hit — message missing parts:', m.id, m);
  }
  const fallbackText = m.content || m.error || m.reasoning_content || m.tool_output || '';
  const fallbackRole = m.role === 'user' ? 'user' : m.type === 'error' ? 'error' : 'agent';
  return (
    <div className={m.role === 'user' ? 'flex justify-end px-4 mb-1.5' : 'flex justify-start px-4 mb-1.5'}>
      <MessageBubble type={fallbackRole as 'user' | 'agent' | 'error'} content={fallbackText} timestamp={m.timestamp} messageId={m.id} onDelete={onDelete} />
    </div>
  )
})

export default MessageRow
