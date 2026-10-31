/**
 * TourOverlay — `gui_tour` 的多步引导（对齐 Hermes tour：遮罩 + 高亮 + 逐页气泡）
 *
 * 锚点与 `show_tip` 同一套（面板名 → 区域矩形），因为 ELEVE 没有 `data-tour`
 * 逐元素锚点。翻页由渲染进程负责（Hermes 由 agent 驱动 show/next/prev 并等回执；
 * ELEVE 没有 UI→工具的回执通道，让模型逐步驱动只会得到"以为没显示"的错觉）。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { computeTipPosition, fallbackAnchorRect, resolveTipAnchor } from './TipBubble'

export interface TourStep {
  target: string
  text: string
  title?: string
  side?: string
}

export interface TourState {
  steps: TourStep[]
}

/** 高亮框相对目标区域的外扩像素（避免贴着边） */
const SPOTLIGHT_PAD = 6

export function clampStepIndex(index: number, len: number): number {
  if (len <= 0) return 0
  return Math.max(0, Math.min(index, len - 1))
}

/** 页码文案（1-based）。 */
export function stepCounter(index: number, len: number): string {
  return `${clampStepIndex(index, len) + 1} / ${Math.max(len, 1)}`
}

interface Highlight {
  left: number
  top: number
  width: number
  height: number
}

function anchorRect(step: TourStep | undefined): Highlight {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const target = step?.target ?? ''
  const el = resolveTipAnchor(target)
  const rect = el ? el.getBoundingClientRect() : fallbackAnchorRect(target, viewport)
  return {
    left: Math.max(0, rect.left - SPOTLIGHT_PAD),
    top: Math.max(0, rect.top - SPOTLIGHT_PAD),
    width: Math.max(8, rect.right - rect.left + SPOTLIGHT_PAD * 2),
    height: Math.max(8, rect.bottom - rect.top + SPOTLIGHT_PAD * 2),
  }
}

export default function TourOverlay({
  tour,
  onClose,
}: {
  tour: TourState | null
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [bubble, setBubble] = useState<{ left: number; top: number } | null>(null)
  const steps = tour?.steps ?? []
  const len = steps.length
  const current = steps[clampStepIndex(index, len)]

  // 新 tour 从第一页开始
  useEffect(() => {
    setIndex(0)
  }, [tour])

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= len) {
        onClose()
        return i
      }
      return i + 1
    })
  }, [len, onClose])

  const prev = useCallback(() => setIndex((i) => clampStepIndex(i - 1, len)), [len])

  useEffect(() => {
    if (!tour) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, next, prev, onClose])

  const highlight = useMemo(() => (tour ? anchorRect(current) : null), [tour, current])

  useLayoutEffect(() => {
    if (!tour || !highlight || !current) {
      setBubble(null)
      return
    }
    const place = (): void => {
      const width = 300
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      // 复用 show_tip 的定位算法：把高亮框当成锚点，气泡落在它外面
      const pos = computeTipPosition(
        {
          left: highlight.left,
          top: highlight.top,
          right: highlight.left + highlight.width,
          bottom: highlight.top + highlight.height,
        },
        { width, height: 120 },
        current.side,
        viewport,
      )
      setBubble({ left: pos.left, top: pos.top })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [tour, highlight, current])

  if (!tour || !current || !highlight) return null

  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={current.title ?? '引导'}
      style={{ position: 'fixed', inset: 0, zIndex: 60 }}
      // 点遮罩空白处 = 结束（与 Esc 同义）
      onClick={onClose}
    >
      {/* 高亮框：靠超大 box-shadow 形成遮罩，无需第二个全屏层 */}
      <div
        style={{
          position: 'fixed',
          left: highlight.left,
          top: highlight.top,
          width: highlight.width,
          height: highlight.height,
          borderRadius: 10,
          boxShadow: '0 0 0 1px rgba(120,170,255,0.9), 0 0 0 9999px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
          transition: 'all 160ms ease-out',
        }}
      />

      {/* 气泡 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: bubble?.left ?? -9999,
          top: bubble?.top ?? -9999,
          width: 300,
          zIndex: 61,
          padding: '12px 14px',
          borderRadius: 12,
          background: 'var(--ui-bg-elevated, #1f2430)',
          color: 'var(--ui-text-primary, #e6e6e6)',
          border: '1px solid var(--ui-border, rgba(255,255,255,0.12))',
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>{current.title ?? '引导'}</div>
          <div style={{ fontSize: 11, opacity: 0.65 }}>{stepCounter(index, len)}</div>
        </div>
        <div style={{ marginTop: 6 }}>{current.text}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={prev}
            disabled={index === 0}
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--ui-border, rgba(255,255,255,0.14))',
              background: 'transparent',
              color: 'inherit',
              opacity: index === 0 ? 0.4 : 1,
              cursor: index === 0 ? 'default' : 'pointer',
            }}
          >
            上一步
          </button>
          <button
            type="button"
            onClick={next}
            style={{
              padding: '4px 12px',
              borderRadius: 8,
              border: '1px solid transparent',
              background: 'var(--ui-accent, #3b82f6)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {index + 1 >= len ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
