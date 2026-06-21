/**
 * 1:1 port of Eleve useThreadScrollAnchor
 * Source: eleve-agent/apps/desktop/src/components/assistant-ui/thread-virtualizer.tsx
 *
 * Key architecture (matching Eleve):
 * 1. ResizeObserver is ALWAYS active — same as Eleve.
 * 2. `armedRef` is INTERNAL (not passed from outside) — same as Eleve.
 *    External code cannot accidentally re-arm sticky-bottom.
 * 3. No custom scrollToFn — same as Eleve.
 * 4. No POST_RUN_BOTTOM_LOCK — the always-on RO replaces this.
 * 5. `isRunning` only used for runStart detection (false→true jump),
 *    NOT for gating the RO — same as Eleve.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { setScrolledUp } from '@/store/scroll'

const AT_BOTTOM_THRESHOLD = 4

interface VirtualizerHandle {
  scrollToIndex(index: number, options?: { align?: 'start' | 'end' | 'center' | 'auto'; behavior?: 'auto' | 'smooth' }): void
}

export default function useThreadScrollAnchor({
  enabled,
  groupCount,
  isRunning,
  scrollerRef,
  sessionKey,
  virtualizer,
}: {
  enabled: boolean
  groupCount: number
  isRunning: boolean
  scrollerRef: RefObject<HTMLElement | null>
  sessionKey: string | undefined
  virtualizer: VirtualizerHandle
}): { armedRef: React.RefObject<boolean> } {
  // ── armedRef: INTERNAL (1:1 from Eleve) ──
  // Only scroll/wheel/touch handlers can disarm; reaching bottom re-arms.
  // NOT passed from outside — prevents accidental re-arming.
  const armedRef = useRef(true)
  const lastTopRef = useRef(0)
  const lastHeightRef = useRef(0)
  const programmaticScrollPendingRef = useRef(0)
  const prevSessionKeyRef = useRef(sessionKey)
  const prevGroupCountRef = useRef(0)

  const pinToBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return

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

  // ── Track at-bottom state, disarm on user scroll/wheel/touch ──
  // 1:1 from Eleve — same logic, same guards.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return undefined

    const disarm = () => {
      armedRef.current = false
      programmaticScrollPendingRef.current = 0
    }

    const onScroll = () => {
      const top = el.scrollTop

      // If this scroll event is the consequence of `pinToBottom` writing
      // `el.scrollTop`, treat it as ours: don't disarm.
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
      // when content grows, the browser emits an interim `scroll` event
      // whose `scrollTop` is smaller because `scrollHeight` jumped.
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

  // ── Follow content growth (1:1 from Eleve) ──
  // RO is ALWAYS active (not gated by isRunning).
  // Coalesces to one pin per animation frame.
  useEffect(() => {
    if (!enabled) return undefined

    const el = scrollerRef.current
    if (!el) return undefined

    let pinRafScheduled = false
    const schedulePin = () => {
      if (pinRafScheduled || !armedRef.current) return
      pinRafScheduled = true
      requestAnimationFrame(() => {
        pinRafScheduled = false
        if (armedRef.current) pinToBottom()
      })
    }

    const observer = new ResizeObserver(schedulePin)
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild)
    }

    return () => observer.disconnect()
  }, [enabled, pinToBottom, scrollerRef])

  // ── Jump to bottom on session change OR empty → non-empty ──
  useEffect(() => {
    const sessionChanged = prevSessionKeyRef.current !== sessionKey
    const becameNonEmpty = prevGroupCountRef.current === 0 && groupCount > 0
    prevSessionKeyRef.current = sessionKey
    prevGroupCountRef.current = groupCount

    if (enabled && (sessionChanged || becameNonEmpty)) {
      jumpToBottom()
    }
  }, [enabled, groupCount, jumpToBottom, sessionKey])

  // ── Pre-paint pin (1:1 from Eleve) ──
  // Pin TWICE: synchronously in layout effect, then once more on rAF.
  const prevGroupCountForLayoutRef = useRef(groupCount)
  useLayoutEffect(() => {
    if (!enabled) return

    if (groupCount > prevGroupCountForLayoutRef.current && armedRef.current) {
      pinToBottom()
      requestAnimationFrame(() => {
        if (armedRef.current) pinToBottom()
      })
    }

    prevGroupCountForLayoutRef.current = groupCount
  }, [enabled, groupCount, pinToBottom])

  // ── Eleve: useAuiEvent('thread.runStart', jumpToBottom) ──
  // When isRunning flips false→true, jump to bottom.
  const prevIsRunningForStartRef = useRef(isRunning)
  useEffect(() => {
    const wasRunning = prevIsRunningForStartRef.current
    prevIsRunningForStartRef.current = isRunning
    if (enabled && !wasRunning && isRunning) {
      jumpToBottom()
    }
  }, [enabled, isRunning, jumpToBottom])

  // Expose armed state for ScrollToBottomButton
  return { armedRef }
}
