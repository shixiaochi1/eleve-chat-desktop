import { useLayoutEffect, useRef, type RefObject } from 'react'

export function useResizeObserver(onResize: () => void, ...refs: RefObject<HTMLElement | null>[]): void {
  const refsRef = useRef(refs)
  refsRef.current = refs

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      onResize()
      return
    }

    const observer = new ResizeObserver(() => onResize())
    let observed = false

    for (const ref of refsRef.current) {
      const element = ref.current
      if (!element) continue
      observer.observe(element)
      observed = true
    }

    if (!observed) {
      observer.disconnect()
      return
    }

    onResize()
    return () => observer.disconnect()
  }, [onResize])
}
