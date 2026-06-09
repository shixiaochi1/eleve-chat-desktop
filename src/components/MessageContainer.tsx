/**
 * 1:1 copy from Hermes thread-virtualizer.tsx
 * Source: hermes-agent/apps/desktop/src/components/assistant-ui/thread-virtualizer.tsx
 *
 * ONLY change: ThreadPrimitive.MessageByIndex → Eleve's own MessageGroupItem
 * Everything else is verbatim Hermes code.
 */

import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, memo } from 'react'

import { cn } from '@/lib/utils'
import { setScrolledUp } from '@/store/scroll'
import { useIsStreaming } from '@/store/messages'
import { useMessage, useMessageSignature, getMessages } from '@/store/messages'
import MessageBubble from './MessageBubble'
import ReasoningBlock from './ReasoningBlock'
import ToolCallGroup, { isSpecialTool, type ToolCallItem } from './ToolCallGroup'
import HoistedTodoPanel, { todosFromMessageParts } from './HoistedTodoPanel'
import type { ChatMessage, ChatMessagePart } from '@/types'

const ESTIMATED_ITEM_HEIGHT = 220
const OVERSCAN = 4
const AT_BOTTOM_THRESHOLD = 4

type MessageGroup = { id: string; index: number; kind: 'standalone' } | { id: string; indices: number[]; kind: 'turn' }

function buildGroups(signature: string): MessageGroup[] {
  if (!signature) {
    return []
  }

  const messages = signature.split('\n').map(row => {
    const [index, id, role] = row.split(':')

    return { id, index: Number(index), role }
  })

  const groups: MessageGroup[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]

    if (message.role !== 'user') {
      groups.push({ id: message.id, index: message.index, kind: 'standalone' })

      continue
    }

    const indices = [message.index]

    while (i + 1 < messages.length && messages[i + 1].role !== 'user') {
      indices.push(messages[++i].index)
    }

    groups.push({ id: message.id, indices, kind: 'turn' })
  }

  return groups
}

// ── Hermes VirtualizedThread, verbatim ──

interface VirtualizedThreadProps {
  sessionKey?: string | null
  onRegenerate?: (msg?: ChatMessage) => void
  gatewayOnline?: boolean
  onGatewayRetry?: () => void
}

export function VirtualizedThread({
  sessionKey,
  onRegenerate,
  gatewayOnline,
  onGatewayRetry
}: VirtualizedThreadProps) {
  const messageSignature = useMessageSignature()
  const groups = useMemo(() => buildGroups(messageSignature ?? ''), [messageSignature])
  const renderEmpty = groups.length === 0
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const virtualizer = useVirtualizer({
    count: groups.length,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    getItemKey: index => groups[index]?.id ?? index,
    getScrollElement: () => scrollerRef.current,
    initialRect: { height: 600, width: 800 },
    overscan: OVERSCAN
  })

  useThreadScrollAnchor({
    enabled: !renderEmpty,
    groupCount: groups.length,
    scrollerRef,
    sessionKey: sessionKey ?? null,
    virtualizer
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const paddingTop = virtualItems[0]?.start ?? 0
  const paddingBottom = Math.max(0, totalSize - (virtualItems.at(-1)?.end ?? 0))

  return (
    <div
      className="relative min-h-0 flex-1 max-w-full overflow-hidden contain-[layout_paint]"
    >
      <div
        className="size-full overflow-x-hidden overflow-y-auto overscroll-contain"
        data-slot="aui_thread-viewport"
        ref={scrollerRef}
      >
        {renderEmpty ? (
          <div
            className="mx-auto grid h-full w-full min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-4 px-6 py-8"
            data-slot="aui_thread-content"
          >
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16">
                <img src="/eleve_logo.png" alt="Eleve" className="w-full h-full object-contain" />
              </div>
              <h2 className="text-lg font-semibold">Eleve Agent</h2>
              <p className="text-sm text-muted-foreground">你的 AI 智能助手 · 开始对话吧</p>
              {!gatewayOnline && (
                <div className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-card text-center">
                  <span className="text-sm font-medium">网关未连接</span>
                  <p className="text-xs text-muted-foreground">请先启动 Eleve Gateway：<code className="bg-muted/50 px-1 rounded">eleved</code></p>
                  <button
                    className={cn(
                      'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-medium',
                      'transition-all outline-none h-8 px-3',
                      'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground'
                    )}
                    onClick={onGatewayRetry}
                  >
                    ↻ 重新检测
                  </button>
                </div>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Ctrl+N 新建会话</span>
                <span>Enter 发送</span>
                <span>Shift+Enter 换行</span>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'mx-auto flex w-full min-w-0 flex-col px-6 pt-[1.5rem]'
            )}
            data-slot="aui_thread-content"
          >
            {/* Natural-flow virtualization: mounted items render as normal
                flex siblings so `position: sticky` on the human bubble
                resolves against the scroller without transform interference.
                Padding spacers reserve scroll space for unmounted items. */}
            <div style={{ paddingBottom: `${paddingBottom}px`, paddingTop: `${paddingTop}px` }}>
              {virtualItems.map(virtualItem => {
                const group = groups[virtualItem.index]

                if (!group) {
                  return null
                }

                return (
                  <div
                    className="flex min-w-0 flex-col gap-3 pb-3"
                    data-index={virtualItem.index}
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                  >
                    {group.kind === 'turn' ? (
                      <div
                        className="relative flex min-w-0 flex-col gap-3"
                        data-slot="aui_turn-pair"
                      >
                        {group.indices.map(index => (
                          <SingleMessageItem key={index} index={index} onRegenerate={onRegenerate} />
                        ))}
                      </div>
                    ) : (
                      <SingleMessageItem index={group.index} onRegenerate={onRegenerate} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Hermes useThreadScrollAnchor, VERBATIM ──

interface ScrollAnchorOptions {
  enabled: boolean
  groupCount: number
  scrollerRef: React.RefObject<HTMLDivElement | null>
  sessionKey: string | null
  virtualizer: { scrollToIndex(index: number, options?: { align?: string; behavior?: string }): void }
}

function useThreadScrollAnchor({ enabled, groupCount, scrollerRef, sessionKey, virtualizer }: ScrollAnchorOptions) {
  // `armed` = parked at bottom, content growth should follow. Cleared on
  // user-driven upward scroll; re-armed when they reach bottom again.
  const armedRef = useRef(true)
  const lastTopRef = useRef(0)
  const lastHeightRef = useRef(0)
  // Counter that tracks how many scroll events we expect to be ours rather
  // than the user's. `pinToBottom` writes `el.scrollTop`, which fires an
  // async `scroll` event; without this guard the on-scroll handler can race
  // with the programmatic write (because content also grew, the *resulting*
  // scrollTop can be lower than `lastTopRef` from the previous frame) and
  // misread the programmatic pin as the user scrolling up — which disarms
  // sticky-bottom and the user's just-submitted message slides above the
  // fold. See `apps/desktop/scripts/measure-jump.mjs` for the repro
  // (distFromBottom 0 → 49 within one frame, sticking forever).
  const programmaticScrollPendingRef = useRef(0)
  const prevSessionKeyRef = useRef(sessionKey)
  const prevGroupCountRef = useRef(0)

  const pinToBottom = useCallback(() => {
    const el = scrollerRef.current

    if (!el) {
      return
    }

    // Hold the disarm gate across the scroll event the next line will fire.
    programmaticScrollPendingRef.current += 1
    el.scrollTop = el.scrollHeight
    lastTopRef.current = el.scrollTop
    lastHeightRef.current = el.scrollHeight
  }, [scrollerRef])

  const jumpToBottom = useCallback(() => {
    armedRef.current = true

    if (groupCount > 0) {
      virtualizer.scrollToIndex(groupCount - 1, { align: 'end', behavior: 'auto' })
    }

    requestAnimationFrame(() => {
      if (armedRef.current) {
        pinToBottom()
      }
    })
  }, [groupCount, pinToBottom, virtualizer])

  useEffect(() => () => setScrolledUp(false), [])

  // Track at-bottom state, dim composer when scrolled up, disarm on user
  // scroll/wheel/touch.
  useEffect(() => {
    const el = scrollerRef.current

    if (!el) {
      return undefined
    }

    const disarm = () => {
      armedRef.current = false
      programmaticScrollPendingRef.current = 0
    }

    const onScroll = () => {
      const top = el.scrollTop

      // If this scroll event is the consequence of `pinToBottom` writing
      // `el.scrollTop`, treat it as ours: don't disarm. The RO + rAF pin
      // loop will re-pin on the next frame if the browser clamped us
      // short of bottom (because content grew in the same frame).
      // Without this guard the post-pin scrollTop gets misread as the
      // user scrolling up, disarming sticky-bottom permanently and
      // leaving the just-submitted message below the fold.
      if (programmaticScrollPendingRef.current > 0) {
        programmaticScrollPendingRef.current -= 1
        lastTopRef.current = top
        lastHeightRef.current = el.scrollHeight
        // Always re-arm — sticky-bottom should hold through clamp races.
        armedRef.current = true
        const atBottom = el.scrollHeight - (top + el.clientHeight) <= AT_BOTTOM_THRESHOLD
        setScrolledUp(!atBottom)

        return
      }

      // Disarm only when `scrollTop` decreases AND `scrollHeight` did NOT
      // grow this frame. A bare `top < lastTopRef.current` check is unsafe:
      // when content grows (virtualizer item measurement, streaming token,
      // code highlight re-tokenization, composer chip), the browser emits
      // an interim `scroll` event whose `scrollTop` is smaller than the
      // previous frame's because `scrollHeight` jumped — this fires before
      // the rAF-scheduled `pinToBottom` runs, so `programmaticScrollPendingRef`
      // is 0. Treating that as a user scroll permanently disarmed sticky-bottom
      // and produced the visible at-rest backward jump (#37997). Gating on a
      // stable `scrollHeight` keeps real user-driven upward intent — scrollbar
      // drag, keyboard PgUp, programmatic scrollIntoView — covered without
      // the false positive. Wheel-up and touchmove still disarm via their
      // own listeners below.
      const heightGrew = el.scrollHeight > lastHeightRef.current
      if (!heightGrew && top + 1 < lastTopRef.current) {
        armedRef.current = false
      }

      lastTopRef.current = top
      lastHeightRef.current = el.scrollHeight

      const atBottom = el.scrollHeight - (top + el.clientHeight) <= AT_BOTTOM_THRESHOLD

      if (atBottom) {
        armedRef.current = true
      }

      setScrolledUp(!atBottom)
    }

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        disarm()
      }
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchmove', disarm, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', disarm)
    }
  }, [scrollerRef])

  // Follow content growth (streaming, item measurements, loading indicator)
  // while armed. During fast streaming the ResizeObserver can fire many
  // times per frame as Streamdown re-tokenizes; coalesce to one pin per
  // animation frame so we don't run the scroll-event/re-pin chain
  // (~20+ ms self in `Virtualizer.getMaxScrollOffset`) several times per
  // token.
  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    const el = scrollerRef.current

    if (!el) {
      return undefined
    }

    let pinRafScheduled = false
    const schedulePin = () => {
      if (pinRafScheduled || !armedRef.current) {
        return
      }
      pinRafScheduled = true
      requestAnimationFrame(() => {
        pinRafScheduled = false
        if (armedRef.current) {
          pinToBottom()
        }
      })
    }

    const observer = new ResizeObserver(schedulePin)
    // Observe ONLY the content (firstElementChild), not the scroller `el`
    // itself. Resizes of the viewport/scroller (window resize, devtools
    // panel toggle) shouldn't trigger a pin — only content growth should.
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild)
    }

    return () => observer.disconnect()
  }, [enabled, pinToBottom, scrollerRef])

  // Jump to bottom on session change OR when an empty thread first gets
  // content. Both share the same intent and the same effect.
  useEffect(() => {
    const sessionChanged = prevSessionKeyRef.current !== sessionKey
    const becameNonEmpty = prevGroupCountRef.current === 0 && groupCount > 0

    prevSessionKeyRef.current = sessionKey
    prevGroupCountRef.current = groupCount

    if (enabled && (sessionChanged || becameNonEmpty)) {
      jumpToBottom()
    }
  }, [enabled, groupCount, jumpToBottom, sessionKey])

  // Pre-paint pin: when groupCount increases while armed (optimistic user
  // message insert, streaming assistant turn arriving, etc.), pin BEFORE
  // the browser commits the layout to screen. Using useLayoutEffect rather
  // than useEffect so this runs synchronously after React commits the DOM
  // mutation but before the browser paints. Without this, there's a ~50ms
  // visual window where the new message sits below the fold while we wait
  // for the ResizeObserver / scroll event chain to fire and re-pin.
  //
  // We pin TWICE in this critical path — once synchronously, then once on
  // the next rAF. The second pin catches the case where React mounts the
  // new message in the second commit (after our layout effect ran), which
  // grows scrollHeight again; without the rAF pin the user briefly sees a
  // ~15 px gap below the new message until the RO catches up. Streaming
  // tokens use the rate-limited RO path only; only the group-count change
  // (which fires once per user submit / new turn arrival) pays for the
  // extra pin.
  const prevGroupCountForLayoutRef = useRef(groupCount)
  useLayoutEffect(() => {
    if (!enabled) {
      return
    }
    if (groupCount > prevGroupCountForLayoutRef.current && armedRef.current) {
      pinToBottom()
      requestAnimationFrame(() => {
        if (armedRef.current) {
          pinToBottom()
        }
      })
    }
    prevGroupCountForLayoutRef.current = groupCount
  }, [enabled, groupCount, pinToBottom])

  // Hermes: useAuiEvent('thread.runStart', jumpToBottom)
  // Eleve equivalent: listen to isStreaming store
  const isStreaming = useIsStreaming()
  const prevIsRunningRef = useRef(isStreaming)
  useEffect(() => {
    const was = prevIsRunningRef.current
    prevIsRunningRef.current = isStreaming
    if (enabled && !was && isStreaming) {
      jumpToBottom()
    }
  }, [enabled, isStreaming, jumpToBottom])
}

// ── SingleMessageItem — scoped rendering (Eleve-specific, replaces ThreadPrimitive.MessageByIndex) ──

interface SingleMessageItemProps {
  index: number
  onRegenerate?: (msg?: ChatMessage) => void
}

const SingleMessageItem = memo(function SingleMessageItem({ index, onRegenerate }: SingleMessageItemProps) {
  const m = useMessage(index)
  if (!m || m.hidden) return null

  // ── Parts-based rendering ──
  if (m.parts && m.parts.length > 0) {
    if (m.role === 'user') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('')
      return <div className="flex justify-end px-4 mb-1.5"><MessageBubble type="user" content={text} /></div>
    }

    if (m.role === 'assistant') {
      // ── 分组渲染：连续 tool-call 合并为一组（对齐 Hermes groupToolParts）──
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
        if (toolBuffer.length === 1) {
          // 单工具 — 也走 ToolCallGroup（内部会渲染为独立卡片）
          renderItems.push({ kind: 'tool-group', key: bufferKey, tools: [...toolBuffer] })
        } else {
          renderItems.push({ kind: 'tool-group', key: bufferKey, tools: [...toolBuffer] })
        }
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

      // 从 parts 中提取 todo 列表（对齐 Hermes HoistedTodoPanel）
      const hoistedTodos = todosFromMessageParts(m.parts)

      return (
        <div className="flex flex-col gap-2 px-4 mb-1.5">
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
                    onRegenerate={onRegenerate ? () => onRegenerate(m) : undefined}
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

  // ── Legacy fallback ──
  let element
  switch (m.type) {
    case 'user':
      element = <MessageBubble type="user" content={m.content} />
      break
    case 'agent':
      element = (
        <MessageBubble
          type="agent"
          content={m.content}
          streaming={!!m._streaming}
          onRegenerate={onRegenerate ? () => onRegenerate(m) : undefined}
          agentAttribution={m.agentAttribution as unknown as Parameters<typeof MessageBubble>[0]['agentAttribution']}
        />
      )
      break
    case 'system':
      element = <MessageBubble type="system" content={m.content} />
      break
    case 'error':
      element = <MessageBubble type="error" content={m.content || m.error} />
      break
    case 'reasoning':
      element = <ReasoningBlock text={m.content || m.reasoning_content} visible={!!(m.content || m.reasoning_content)} messageId={m.id} pending={!!m.pending} />
      break
    case 'tool':
      element = (
        <ToolCallGroup
          tools={[{
            name: m.toolName || m.tool_name,
            callId: m.callId || m.tool_call_id,
            argsStr: m.argsStr || m.tool_input,
            resultStr: m.resultStr || m.tool_output,
            status: m.status,
          }]}
        />
      )
      break
    case 'usage':
      element = (
        <div className="text-xs text-center text-muted-foreground py-1 px-3">
          Tokens: 输入 {m.inputTokens} | 输出 {m.outputTokens}
        </div>
      )
      break
    default:
      return null
  }

  const alignClass = m.type === 'user'
    ? 'flex justify-end px-4 mb-1.5'
    : m.type === 'agent'
      ? 'flex justify-start px-4 mb-1.5'
      : 'px-4 py-0.5'

  return <div className={alignClass}>{element}</div>
})

export default memo(VirtualizedThread)
