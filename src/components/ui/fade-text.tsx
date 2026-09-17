/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * FadeText — 渐隐文本（依赖 use-resize-observer）。
 *
 * 保留理由：作为设计系统基础保留（shadcn/radix 风格，无副作用）。
 * 确认不再需要时可连同其依赖一起删。
 *
 * 最后核实：2026-09-17（从 src/main.tsx 出发的 BFS 可达性分析；
 *          复核方式：node scripts/deadcode-check.mjs）
 * 性质：设计系统预留组件（从未被接入，非「曾用后废」）
 * 消费者：无（全仓零 import）
 * 继承者：无
 *
 * ⚠️ 请勿在此处修补 bug 或新增功能 —— 本文件无消费者，改动对运行时零影响
 *    （历史上已多次出现「给孤儿打补丁」）。要复活请先接回入口；确认废弃则
 *    连同其下游一起删，勿只删链头。
 */
import { memo, useCallback, useRef, useState } from 'react'

import { useResizeObserver } from '../../hooks/use-resize-observer'
import { cn } from '../../lib/utils'

interface FadeTextProps {
  children?: React.ReactNode
  className?: string
  fadeWidth?: string
  style?: React.CSSProperties
}

/**
 * Single-line text that fades out instead of truncating with an ellipsis.
 *
 * Uses an inline mask-image so the fade resolves against whatever the parent
 * background is — no need to know the surface color, no after-pseudo overlap.
 * The mask is only applied when the text is actually overflowing, so short
 * strings render as plain text without an unnecessary gradient on their tail.
 *
 * Layout reads (`el.scrollWidth`) are forced reflows. To avoid measuring
 * once per parent re-render — which during streaming happens on every token —
 * we only re-measure when the ResizeObserver fires (real size changes), not
 * on every `children` reference change. Wrapped in `memo` with a custom
 * comparator so scalar-string children skip re-render entirely when the text
 * is unchanged but the parent re-rendered.
 */
function FadeTextImpl({ children, className, fadeWidth = '3rem', style, ...rest }: FadeTextProps & Record<string, unknown>) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  const measureOverflow = useCallback(() => {
    const el = ref.current

    if (!el) {
      return
    }

    setOverflowing(el.scrollWidth - el.clientWidth > 1)
  }, [])

  useResizeObserver(measureOverflow, ref)

  const maskStyle = overflowing
    ? {
        maskImage: `linear-gradient(to right, black calc(100% - ${fadeWidth}), transparent)`,
        WebkitMaskImage: `linear-gradient(to right, black calc(100% - ${fadeWidth}), transparent)`,
        ...style
      }
    : (style ?? {})

  return (
    <span
      {...rest}
      className={cn('block min-w-0 max-w-full overflow-hidden whitespace-nowrap', className)}
      ref={ref}
      style={maskStyle}
    >
      {children}
    </span>
  )
}

function styleEqual(a: React.CSSProperties | undefined, b: React.CSSProperties | undefined) {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  const aKeys = Object.keys(a)

  if (aKeys.length !== Object.keys(b).length) {
    return false
  }

  for (const k of aKeys) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) {
      return false
    }
  }

  return true
}

export const FadeText = memo(FadeTextImpl, (prev: FadeTextProps & Record<string, unknown>, next: FadeTextProps & Record<string, unknown>) => {
  if (prev.className !== next.className) {
    return false
  }

  if (prev.fadeWidth !== next.fadeWidth) {
    return false
  }

  if (!styleEqual(prev.style, next.style)) {
    return false
  }

  // Cheap path: the common case is a scalar string/number child. Identity
  // comparison is correct for any other element type (a new JSX node should
  // force a re-render).
  return prev.children === next.children
})
