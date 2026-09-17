/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * useResizeObserver — 尺寸观察 hook。
 *
 * 保留理由：作为设计系统基础保留（shadcn/radix 风格，无副作用）。
 * 确认不再需要时可连同其依赖一起删。
 *
 * 最后核实：2026-09-17（从 src/main.tsx 出发的 BFS 可达性分析；
 *          复核方式：node scripts/deadcode-check.mjs）
 * 性质：设计系统预留组件（从未被接入，非「曾用后废」）
 * 消费者：仅 ui/fade-text.tsx（自身不可达）
 * 继承者：无
 *
 * ⚠️ 请勿在此处修补 bug 或新增功能 —— 本文件无消费者，改动对运行时零影响
 *    （历史上已多次出现「给孤儿打补丁」）。要复活请先接回入口；确认废弃则
 *    连同其下游一起删，勿只删链头。
 */
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
