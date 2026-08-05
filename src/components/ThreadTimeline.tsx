import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  deriveTimelineEntries,
  sameTimelineEntries,
  activeTimelineIndex,
  type TimelineEntry,
} from '@/lib/timeline-data';
import { getMessages, useMessageSignature } from '@/store/messages';
import { useScrolledUp } from '@/store/scroll';

const MIN_ENTRIES = 4
const HOVER_CLOSE_MS = 140
const VIEWPORT = '[data-slot="aui_thread-viewport"]'

const ROW_CLASS =
  'row-hover relative flex w-full min-w-0 max-w-full select-none overflow-hidden rounded-md px-2 py-1 text-left outline-hidden'

const POPOVER_SHELL =
  'absolute right-full top-1/2 z-50 max-h-[min(22rem,calc(100vh-8rem))] w-80 max-w-[min(20rem,calc(100vw-2rem))] -translate-y-1/2 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border p-1 text-popover-foreground transition-[opacity,transform] duration-100 ease-out'

const listRef =
  <T,>(refs: React.RefObject<(T | null)[]>, index: number) =>
  (node: T | null) => {
    refs.current[index] = node
  }

const hoverProps = (index: number, paint: (index: number, on: boolean) => void) => ({
  onMouseEnter: () => paint(index, true),
  onMouseLeave: () => paint(index, false),
})

// Constant-duration jump (eased), NOT native `behavior:'smooth'` — Chromium's
// smooth scroll animates proportional to distance, so jumping across a long
// thread crawls for seconds. A fixed ~170ms feels instant near or far.
let jumpRaf = 0

function jumpScroll(viewport: HTMLElement, top: number, duration = 170): void {
  cancelAnimationFrame(jumpRaf)
  const start = viewport.scrollTop
  const delta = top - start

  if (Math.abs(delta) < 2) {
    viewport.scrollTop = top
    return
  }

  const t0 = performance.now()
  const ease = (t: number) => 1 - (1 - t) ** 3 // easeOutCubic

  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / duration)
    viewport.scrollTop = start + delta * ease(p)

    if (p < 1) {
      jumpRaf = requestAnimationFrame(step)
    }
  }

  jumpRaf = requestAnimationFrame(step)
}

function scrollToPrompt(scroller: HTMLElement | null, id: string) {
  if (!scroller) return
  const node = scroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
  if (!node) return

  const top = scroller.scrollTop + (node.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - 8
  jumpScroll(scroller, Math.max(0, top))
}

/**
 * 右侧消息时间线（对齐 Hermes ThreadTimeline）：
 * - ≥4 条用户提示才显示（MIN_ENTRIES）
 * - 右侧垂直刻度轨：当前视口位置的提示高亮（主题色），其余弱化
 * - 悬停刻度 → 弹出预览列表（含完整提示文本），点击平滑跳转到该消息
 * - 虚拟化适配：active 计算只量已挂载节点（未挂载 offset=null，
 *   activeTimelineIndex 有 firstRendered 兜底，与 Hermes 同语义）
 */
export default function ThreadTimeline() {
  // 🔴 信号 = 消息签名（只有结构变化才变；流式 token 不触发重渲染）
  const signature = useMessageSignature()
  const scrolledUp = useScrolledUp()
  const [activeIndex, setActiveIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<number | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const previousRef = useRef<TimelineEntry[]>([])
  // 🔴 refs 必须在条件 return 前声明（Rules of Hooks）
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([])
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  const entries = useMemo(() => {
    const messages = getMessages()
    const next = deriveTimelineEntries(
      messages.map((m) => ({ id: m.id, role: m.role, text: (m.parts?.find((p) => p.type === 'text') as { text?: string } | undefined)?.text ?? m.content ?? '' })),
    )

    if (sameTimelineEntries(previousRef.current, next)) {
      return previousRef.current
    }

    previousRef.current = next
    return next
    // signature 是重算触发器（文本从 ref 读，签名只反映结构变化）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const jump = useCallback((id: string) => {
    const root = rootRef.current
    const viewport = root?.closest('[data-session-anchor]')?.querySelector<HTMLElement>(VIEWPORT) ?? null
    scrollToPrompt(viewport, id)
  }, [])

  const paint = useCallback((index: number, on: boolean) => {
    const tick = tickRefs.current[index]
    if (tick) {
      tick.style.opacity = on ? '1' : ''
    }
    const row = rowRefs.current[index]
    row?.classList.toggle('bg-accent', on)
    if (on) {
      row?.scrollIntoView({ block: 'nearest' })
    }
  }, [])

  const keepOpen = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    setOpen(true)
  }, [])

  const closeSoon = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  // active 同步：跟随底部 = 最后一条；否则 scroll rAF 量已挂载节点 offset
  useEffect(() => {
    if (entries.length < MIN_ENTRIES) return

    const root = rootRef.current
    const viewport = root?.closest('[data-session-anchor]')?.querySelector<HTMLElement>(VIEWPORT)
    if (!viewport) return

    let raf = 0

    const compute = () => {
      raf = 0

      // 跟随底部（流式稳态）：当前提示就是最后一条，跳过 rect walk
      if (!scrolledUp) {
        setActiveIndex((prev) => (prev === entries.length - 1 ? prev : entries.length - 1))
        return
      }

      const top = viewport.getBoundingClientRect().top
      const offsets = entries.map((entry) => {
        const node = viewport.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(entry.id)}"]`)
        return node ? node.getBoundingClientRect().top - top : null
      })

      const next = activeTimelineIndex(offsets)
      setActiveIndex((prev) => (prev === next ? prev : next))
    }

    const onScroll = () => {
      if (!raf) {
        raf = requestAnimationFrame(compute)
      }
    }

    onScroll()
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [entries, scrolledUp])

  if (entries.length < MIN_ENTRIES) {
    return null
  }

  return (
    <div
      aria-label="对话时间线"
      className="group/timeline pointer-events-auto absolute right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-end"
      data-slot="thread-timeline"
      onMouseEnter={keepOpen}
      onMouseLeave={closeSoon}
      ref={rootRef}
      role="navigation"
    >
      <div className="flex flex-col items-end py-1" data-slot="thread-timeline-ticks">
        {entries.map((entry, index) => (
          <button
            aria-label={entry.preview}
            className="flex h-2 w-7 cursor-pointer items-center justify-end pr-1"
            key={entry.id}
            onClick={() => jump(entry.id)}
            type="button"
            {...hoverProps(index, paint)}
          >
            <span
              className={cn(
                'block h-px w-3 transition-opacity duration-100 ease-out',
                index === activeIndex ? 'bg-accent-cyan' : 'text-muted-foreground/40 opacity-70',
              )}
              ref={listRef(tickRefs, index)}
            />
          </button>
        ))}
      </div>
      <TimelinePopover
        activeIndex={activeIndex}
        entries={entries}
        onHover={paint}
        onJump={jump}
        open={open}
        rowRefs={rowRefs}
      />
    </div>
  )
}

function TimelinePopover({
  activeIndex,
  entries,
  onHover,
  onJump,
  open,
  rowRefs,
}: {
  activeIndex: number
  entries: TimelineEntry[]
  onHover: (index: number, on: boolean) => void
  onJump: (id: string) => void
  open: boolean
  rowRefs: React.RefObject<(HTMLButtonElement | null)[]>
}) {
  // 列表首次打开后才构建（悬停预览懒加载）；之后保持挂载供关闭渐隐
  const [everOpened, setEverOpened] = useState(open)

  if (open && !everOpened) {
    setEverOpened(true)
  }

  return (
    <div
      className={cn(
        POPOVER_SHELL,
        open ? 'pointer-events-auto opacity-100 translate-x-0' : 'pointer-events-none translate-x-1 opacity-0',
      )}
      data-slot="thread-timeline-popover"
    >
      {everOpened &&
        entries.map((entry, index) => (
          <button
            aria-label={entry.preview}
            className={cn(ROW_CLASS, index === activeIndex && 'bg-accent text-foreground')}
            key={entry.id}
            onClick={() => onJump(entry.id)}
            ref={listRef(rowRefs, index)}
            type="button"
            {...hoverProps(index, onHover)}
          >
            <span className="block w-full min-w-0 truncate font-medium leading-snug text-foreground">
              {entry.preview}
            </span>
          </button>
        ))}
    </div>
  )
}
