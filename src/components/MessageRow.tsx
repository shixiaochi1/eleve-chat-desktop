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
import ReasoningBlock from './ReasoningBlock'
import ToolCallGroup, { isSpecialTool, type ToolCallItem } from './ToolCallGroup'
import HoistedTodoPanel, { todosFromMessageParts } from './HoistedTodoPanel'
import type { ChatMessage, ChatMessagePart } from '@/types'

interface MessageRowProps {
  message: ChatMessage
  /** 删除回调；undefined 时不显示删除按钮（宫格只读场景） */
  onDelete?: (messageId: string) => void
}

export const MessageRow = memo(function MessageRow({ message: m, onDelete }: MessageRowProps) {
  if (!m || m.hidden) return null

  // ── Parts-based rendering ──
  if (m.parts && m.parts.length > 0) {
    if (m.role === 'user') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('')
      return <div className="flex justify-end px-4 mb-1.5"><MessageBubble type="user" content={text} timestamp={m.timestamp} messageId={m.id} onDelete={onDelete} /></div>
    }

    if (m.role === 'assistant') {
      // ── 分组渲染：连续 tool-call 合并为一组（对齐 Eleve groupToolParts）──
      type RenderItem =
        | { kind: 'reasoning'; key: string; text: string }
        | { kind: 'text'; key: string; text: string; isLast: boolean }
        | { kind: 'tool-group'; key: string; tools: ToolCallItem[] }
        | { kind: 'special-tool'; key: string; tool: ToolCallItem }

      const renderItems: RenderItem[] = []
      let toolBuffer: ToolCallItem[] = []
      let bufferKey = ''

      const flushToolBuffer = () => {
        if (toolBuffer.length === 0) return
        renderItems.push({ kind: 'tool-group', key: bufferKey, tools: [...toolBuffer] })
        toolBuffer = []
        bufferKey = ''
      }

      for (let pi = 0; pi < m.parts.length; pi++) {
        const part = m.parts[pi]

        if (part.type === 'tool-call') {
          // 特殊工具（todo/image_generate/clarify）不参与分组
          if (isSpecialTool(part.toolName)) {
            flushToolBuffer()
            renderItems.push({
              kind: 'special-tool',
              key: `st-${part.toolCallId || pi}`,
              tool: {
                name: part.toolName,
                callId: part.toolCallId,
                argsStr: part.argsText,
                resultStr: part.result != null ? (typeof part.result === 'string' ? part.result : JSON.stringify(part.result)) : undefined,
                status: part.result != null ? 'done' : 'pending',
              },
            })
            continue
          }

          // 加入工具缓冲区
          if (toolBuffer.length === 0) bufferKey = `tg-${pi}`
          toolBuffer.push({
            name: part.toolName,
            callId: part.toolCallId,
            argsStr: part.argsText,
            resultStr: part.result != null ? (typeof part.result === 'string' ? part.result : JSON.stringify(part.result)) : undefined,
            status: part.result != null ? 'done' : 'pending',
          })
          continue
        }

        // 非 tool-call → 先刷出缓冲区
        flushToolBuffer()

        if (part.type === 'reasoning') {
          renderItems.push({ kind: 'reasoning', key: `r-${pi}`, text: part.text })
        } else if (part.type === 'text') {
          renderItems.push({ kind: 'text', key: `t-${pi}`, text: part.text, isLast: pi === m.parts.length - 1 })
        }
      }
      flushToolBuffer()

      // 从 parts 中提取 todo 列表（对齐 Eleve HoistedTodoPanel）
      const hoistedTodos = todosFromMessageParts(m.parts)

      return (
        <div className="flex flex-col gap-2.5 px-4 mb-1.5">
          {hoistedTodos.length > 0 && <HoistedTodoPanel todos={hoistedTodos} />}
          {renderItems.map(item => {
            switch (item.kind) {
              case 'reasoning':
                return <ReasoningBlock key={item.key} text={item.text} visible={!!item.text} messageId={m.id} pending={!!m.pending} />
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
                  />
                )
              case 'tool-group':
                return <ToolCallGroup key={item.key} tools={item.tools} />
              case 'special-tool':
                // 特殊工具暂用 ToolCallGroup 单工具渲染
                return <ToolCallGroup key={item.key} tools={[item.tool]} />
            }
          })}
          {m.error && <MessageBubble type="error" content={m.error} />}
        </div>
      )
    }

    if (m.role === 'system') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('')
      return <div className="px-4 py-0.5"><MessageBubble type="system" content={text} /></div>
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
