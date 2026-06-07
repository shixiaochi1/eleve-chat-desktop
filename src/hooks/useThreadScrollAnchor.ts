/**
 * 1:1 port of Hermes useThreadScrollAnchor
 * Source: hermes-agent/apps/desktop/src/components/assistant-ui/thread-virtualizer.tsx
 *
 * Eleve adaptations (minimal):
 * - scrolledUp stored in external store (1:1 with Hermes $threadScrolledUp nanostore)
 *   so scrolledUp changes only re-render the scroll-to-bottom button, not the virtualizer.
 * - useAuiEvent('thread.runStart', jumpToBottom) → replaced by isRunning false→true useEffect
 *
 * ResizeObserver lifecycle is 1:1 with Hermes: only active during isRunning.
 * P1+P2 store migration eliminates the measurement storm that previously
 * required an Eleve-specific RO compensation for history batch loads.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { setMutableRef } from '@/lib/mutable-ref'
import { setScrolledUp } from '@/store/scroll'

const AT_BOTTOM_THRESHOLD = 4
const POST_RUN_BOTTOM_LOCK_MS = 1200

interface VirtualizerHandle {
  scrollToIndex(index: number, options?: { align?: 'start' | 'end' | 'center' | 'auto'; behavior?: 'auto' | 'smooth' }): void
}

function scrollElementToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight
}

export default function useThreadScrollAnchor({
  enabled,
  groupCount,
  isRunning,
  scrollerRef,
  sessionKey,
  stickyBottomRef,
  virtualizer,
  programmaticScrollPendingRef,
}: {
  enabled: boolean
  groupCount: number
  isRunning: boolean
  scrollerRef: RefObject<HTMLElement | null>
  sessionKey: string | undefined
  stickyBottomRef: RefObject<boolean>
  virtualizer: VirtualizerHandle
  programmaticScrollPendingRef: RefObject<number>
}): void {
  const lastTopRef = useRef(0)
  const lastHeightRef = useRef(0)
  const lastClientHeightRef = useRef(0)
  const prevSessionKeyRef = useRef(sessionKey)
  const prevGroupCountRef = useRef(0)


  const pinToBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    programmaticScrollPendingRef.current += 1
    scrollElementToBottom(el)
    lastTopRef.current = el.scrollTop
    lastHeightRef.current = el.scrollHeight
    lastClientHeightRef.current = el.clientHeight
  }, [scrollerRef])

  const jumpToBottom = useCallback(() => {
    setMutableRef(stickyBottomRef, true)
    if (groupCount > 0) {
      virtualizer.scrollToIndex(groupCount - 1, { align: 'end', behavior: 'auto' })
    }
    requestAnimationFrame(() => {
      if (stickyBottomRef.current) {
        pinToBottom()
      }
    })
  }, [groupCount, pinToBottom, stickyBottomRef, virtualizer])

  useEffect(() => () => setScrolledUp(false), [])

  // ── Track at-bottom state, disarm on user scroll/wheel/touch ──
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return undefined

    const disarm = () => {
      setMutableRef(stickyBottomRef, false)
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
        lastClientHeightRef.current = el.clientHeight
        // Always re-arm — sticky-bottom should hold through clamp races.
        setMutableRef(stickyBottomRef, true)
        const atBottom = el.scrollHeight - (top + el.clientHeight) <= AT_BOTTOM_THRESHOLD
        setScrolledUp(!atBottom)
        return
      }

      // Disarm only when `scrollTop` decreases while both content height and
      // viewport height are stable.
      const heightGrew = el.scrollHeight > lastHeightRef.current
      const clientHeightChanged = Math.abs(el.clientHeight - lastClientHeightRef.current) > 1

      if (!heightGrew && !clientHeightChanged && top + 1 < lastTopRef.current) {
        setMutableRef(stickyBottomRef, false)
      }

      lastTopRef.current = top
      lastHeightRef.current = el.scrollHeight
      lastClientHeightRef.current = el.clientHeight

      const atBottom = el.scrollHeight - (top + el.clientHeight) <= AT_BOTTOM_THRESHOLD
      if (atBottom) {
        setMutableRef(stickyBottomRef, true)
      }

      setScrolledUp(!atBottom)
    }

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) disarm()
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchmove', disarm, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchmove', disarm)
    }
  }, [scrollerRef, stickyBottomRef])

  // ── Follow content growth (1:1 from Hermes) ──
  useEffect(() => {
    if (!enabled) return undefined;

    const el = scrollerRef.current;
    if (!el) return undefined;

    // Hermes: RO only during isRunning
    if (!isRunning) return undefined;

    let pinRafScheduled = false;

    const schedulePin = () => {
      if (pinRafScheduled || !stickyBottomRef.current) return;
      pinRafScheduled = true;
      requestAnimationFrame(() => {
        pinRafScheduled = false;
        if (stickyBottomRef.current) pinToBottom();
      });
    };

    const observer = new ResizeObserver(schedulePin);
    if (el.firstElementChild) {
      observer.observe(el.firstElementChild);
    }

    return () => observer.disconnect();
  }, [enabled, isRunning, pinToBottom, scrollerRef, stickyBottomRef]);

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

  // ── Pre-paint pin ──
  const prevGroupCountForLayoutRef = useRef(groupCount)
  useLayoutEffect(() => {
    if (!enabled) return

    if (groupCount > prevGroupCountForLayoutRef.current && stickyBottomRef.current) {
      requestAnimationFrame(() => {
        if (stickyBottomRef.current) pinToBottom()
      })
    }

    prevGroupCountForLayoutRef.current = groupCount
  }, [enabled, groupCount, pinToBottom, stickyBottomRef])

  // ── Post-run bottom lock ──
  const prevIsRunningForLayoutRef = useRef(isRunning)
  useLayoutEffect(() => {
    const finishedRun = prevIsRunningForLayoutRef.current && !isRunning
    prevIsRunningForLayoutRef.current = isRunning

    if (!enabled || !finishedRun || !stickyBottomRef.current) return undefined

    const lockUntil = performance.now() + POST_RUN_BOTTOM_LOCK_MS
    let lockRaf: number | null = null

    const lockFrame = () => {
      lockRaf = null
      if (!stickyBottomRef.current) return
      pinToBottom()
      if (performance.now() < lockUntil) {
        lockRaf = requestAnimationFrame(lockFrame)
      }
    }

    pinToBottom()
    lockRaf = requestAnimationFrame(lockFrame)

    return () => {
      if (lockRaf !== null) cancelAnimationFrame(lockRaf)
    }
  }, [enabled, isRunning, pinToBottom, stickyBottomRef])

  // ── Hermes: useAuiEvent('thread.runStart', jumpToBottom) ──
  // When isRunning flips false→true, jump to bottom.
  // Catches run restarts that don't change groupCount.
  const prevIsRunningForStartRef = useRef(isRunning)
  useEffect(() => {
    const wasRunning = prevIsRunningForStartRef.current
    prevIsRunningForStartRef.current = isRunning
    if (enabled && !wasRunning && isRunning) {
      jumpToBottom()
    }
  }, [enabled, isRunning, jumpToBottom])
}
