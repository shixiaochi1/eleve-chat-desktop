import { useEffect, useRef } from 'react'

/**
 * 刷新热键（🔴 2026-08-29 对齐 Hermes use-refresh-hotkey.ts）：
 * 调用视图挂载期间绑定裸 `r` 键刷新。忽略带修饰键的按下、按键重复、
 * 以及焦点在可编辑字段内的情况（搜索框里打字 "r" 不会触发刷新）。
 */
export function useRefreshHotkey(onRefresh: () => void, enabled = true) {
  const ref = useRef(onRefresh)
  ref.current = onRefresh

  useEffect(() => {
    if (!enabled) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'r' && event.key !== 'R') {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) {
        return
      }

      const target = event.target as HTMLElement | null

      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }

      event.preventDefault()
      ref.current()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
