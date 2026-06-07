/**
 * Scroll state store — 1:1 alignment with Hermes $threadScrolledUp nanostore
 *
 * Key design: scrolledUp changes only re-render the scroll-to-bottom button,
 * NOT the virtualizer component. This prevents scrollToFn feedback loops
 * caused by virtualizer re-render → re-measure → el.scrollTo → override user scroll.
 */

import { useSyncExternalStore } from 'react'
import type { ListenerCallback, Unsubscribe } from '@/types'

let scrolledUp = false
let listeners = new Set<ListenerCallback>()

function notify(): void {
  listeners.forEach(cb => cb())
}

export function subscribeScrolledUp(cb: ListenerCallback): Unsubscribe {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function getScrolledUp(): boolean {
  return scrolledUp
}

export function setScrolledUp(value: boolean): void {
  if (scrolledUp !== value) {
    scrolledUp = value
    notify()
  }
}

export function useScrolledUp(): boolean {
  return useSyncExternalStore(subscribeScrolledUp, getScrolledUp, getScrolledUp)
}
