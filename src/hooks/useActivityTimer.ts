/**
 * ActivityTimer — 对齐 Eleve activity-timer.ts
 *
 * 提供计时器 hook，记录从首次激活到当前的经过秒数。
 * Module-level 注册表保证组件卸载再挂载计时连续。
 */

/** module-level 起始时间注册表 (key → startedAt ms) */
const startedAtByKey = new Map<string, number>()

/** 格式化经过时间（对齐 Eleve formatElapsed） */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * useElapsedSeconds — 返回从首次激活起经过的秒数
 *
 * @param active 是否正在计时
 * @param timerKey 唯一键（如 "reasoning:msg-123"），保证跨重渲染连续
 * @returns 经过的整数秒
 *
 * 对齐 Eleve useElapsedSeconds：
 *   - 首次 active=true 时记录 startTime
 *   - setInterval(1000) 递增
 *   - active=false 时清理 interval 但保留 startTime（下次激活延续）
 */
export function useElapsedSeconds(active: boolean, timerKey: string): number {
  const [seconds, setSeconds] = React.useState(() => {
    if (!active) return 0
    const existing = startedAtByKey.get(timerKey)
    if (existing) {
      return Math.floor((Date.now() - existing) / 1000)
    }
    startedAtByKey.set(timerKey, Date.now())
    return 0
  })

  React.useEffect(() => {
    if (!active) {
      // 非活跃：不清理 startTime（保持连续性），只停 interval
      return
    }

    // 首次激活或恢复：确保有 startTime
    if (!startedAtByKey.has(timerKey)) {
      startedAtByKey.set(timerKey, Date.now())
      setSeconds(0)
    }

    const id = setInterval(() => {
      const startedAt = startedAtByKey.get(timerKey)
      if (startedAt) {
        setSeconds(Math.floor((Date.now() - startedAt) / 1000))
      }
    }, 1000)

    return () => clearInterval(id)
  }, [active, timerKey])

  // 清理：当 key 不再需要时（可选，组件卸载后保留不影响）
  React.useEffect(() => {
    return () => {
      // 保留 startedAtByKey，因为 React strict mode 会触发二次挂载
    }
  }, [])

  return seconds
}

// 需要导入 React
import React from 'react'
