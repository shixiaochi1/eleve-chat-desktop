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
import { memo, useState } from 'react'
import MessageBubble from './MessageBubble'
import SystemMessage from './SystemMessage'
import ChangedFilesCard from './ChangedFilesCard'
import ReasoningBlock from './ReasoningBlock'
import ToolEntry, { type ToolCallItem } from './ToolEntry'
import HoistedTodoPanel, { todosFromMessageParts } from './HoistedTodoPanel'
import ImageLightbox from './ImageLightbox'
import { useImageEditor } from '@/store/image-editor'
import type { ChatMessage, ChatMessagePart } from '@/types'

interface MessageRowProps {
  message: ChatMessage
  /** 删除回调；undefined 时不显示删除按钮（宫格只读场景） */
  onDelete?: (messageId: string) => void
  /** 会话 ID（artifact 版本注册按会话隔离，对齐 Hermes） */
  sessionId?: string | null
  /** 🔴 是否最后一条消息（ChangedFilesCard 门控：仅最后一条已落定 assistant 显示） */
  isLast?: boolean
}

export const MessageRow = memo(function MessageRow({ message: m, onDelete, sessionId, isLast = false }: MessageRowProps) {
  // 图片点击放大（对齐 Hermes ImageLightbox）——UI 局部状态，不违背 store 解耦
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null)
  if (!m || m.hidden) return null

  // ── Parts-based rendering ──
  if (m.parts && m.parts.length > 0) {
    if (m.role === 'user') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('')
      return (
        <div data-message-id={m.id} className="flex justify-end px-4 mb-1">
          <div className="flex flex-col items-end gap-1.5 max-w-[80%] min-w-0">
            {/* 🔴 2026-08-20 布局修正：图片在上、文字在下（对齐主流 IM 语义）；
                纯图片消息不渲染空文字气泡（原实现 text='' 时气泡空壳 + 图片在
                气泡下方 -mt-3 负边距 hack，视觉别扭） */}
            {m.attachmentRefs && m.attachmentRefs.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1">
                {m.attachmentRefs.map((ref, i) =>
                  ref.startsWith('data:') ? (
                    <div key={`${m.id}-att-${i}`} className="relative">
                      <img
                        src={ref}
                        alt="attachment"
                        className="w-20 h-20 object-cover rounded-lg border border-border cursor-zoom-in"
                        draggable={false}
                        onClick={() => setLightbox({ src: ref, name: `image-${i + 1}` })}
                      />
                      {/* 🔴 2026-08-22：消息图片"图N"角标（与附件/LLM 编号一致） */}
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] leading-none text-white">
                        图{i + 1}
                      </span>
                    </div>
                  ) : (
                    <span key={`${m.id}-att-${i}`} className="max-w-[160px] truncate rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {ref}
                    </span>
                  ),
                )}
              </div>
            )}
            {text.trim() ? (
              <MessageBubble type="user" content={text} messageId={m.id} onDelete={onDelete} />
            ) : null}
            {/* 图片大图预览（对齐 Hermes ImageLightbox：Esc/遮罩关闭 + 下载 + 编辑） */}
            {lightbox && (
              <ImageLightbox
                src={lightbox.src}
                alt={lightbox.name}
                onClose={() => setLightbox(null)}
                // 🔴 2026-08-22：消息区图片也可局部重绘编辑（Context 入口，无 prop 透传）
                onEdit={() => {
                  setLightbox(null)
                  useImageEditor().openImageEditor(lightbox.src, lightbox.name)
                }}
              />
            )}
          </div>
        </div>
      )
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

      // 🔴 流式 streaming 门控：isLast 必须是"最后一个 text part"（而非数组末位）——
      // 到达序 [text → tool → text]（工具调用后的总结段，高频场景）中，若按数组末位
      // 判定，工具后的流式文本 isLast=false → streaming=false → 无平滑揭示 + 尾块
      // 立即高亮（每 flush 全量 hljs）+ artifact 按落定态误提升。
      let lastTextPi = -1
      for (let pi = 0; pi < m.parts.length; pi++) {
        if (m.parts[pi].type === 'text') lastTextPi = pi
      }

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
              // 工具执行耗时（tool.complete 事件 → part.duration，ToolEntry 头部行显示）
              duration: part.duration,
            },
          })
        } else if (part.type === 'reasoning') {
          renderItems.push({ kind: 'reasoning', key: `r-${m.id}-${reasoningOrdinal}`, text: part.text, done: part.done, idx: reasoningOrdinal })
          reasoningOrdinal++
        } else if (part.type === 'text') {
          renderItems.push({ kind: 'text', key: `t-${m.id}-${textOrdinal}`, text: part.text, isLast: pi === lastTextPi })
          textOrdinal++
        }
      }

      // 从 parts 中提取 todo 列表（对齐 Eleve HoistedTodoPanel）
      const hoistedTodos = todosFromMessageParts(m.parts)

      return (
        <div data-message-id={m.id} className="flex flex-col gap-2.5 px-4 mb-1">
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
                    messageId={m.id}
                    onDelete={onDelete}
                    sessionId={sessionId}
                  />
                )
              case 'tool':
                return <ToolEntry key={item.key} tool={item.tool} sessionId={sessionId} />
            }
          })}
          {m.error && <MessageBubble type="error" content={m.error} />}
          {/* 🔴 2026-08-23 老大拍板：流式停滞提示（StreamStallIndicator）整行取消——
              "Eleve 正在思考"+跳动点与思考气泡（BrailleSpinner+计时器）重复，
              思考进度由气泡单一承载，不再双动画并存 */}
          {/* 🔴 ChangedFilesCard（对齐 Hermes）：仅最后一条已落定 assistant 消息显示，
              收尾本轮“N 个文件已修改”；发送下一条消息即退休（卡片描述的工作树已成历史） */}
          {isLast && !m.pending && <ChangedFilesCard parts={m.parts} />}
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
    <div className={m.role === 'user' ? 'flex justify-end px-4 mb-1' : 'flex justify-start px-4 mb-1'}>
      <MessageBubble type={fallbackRole as 'user' | 'agent' | 'error'} content={fallbackText} messageId={m.id} onDelete={onDelete} />
    </div>
  )
})

export default MessageRow
