/**
 * TipBubble — `show_tip` 的小气泡（对齐 Hermes tip 的"单个指向性气泡，无遮罩"）
 *
 * 锚点用**面板**（`data-desktop-target`）而不是任意 CSS selector：ELEVE 没有
 * `data-tour` 锚点体系，让模型猜 selector 只会指向随机节点。目标词表与
 * `focus_pane` 一致：composer / sessions / files / terminal / preview /
 * artifacts / agent-panel。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface TipState {
  target: string
  text: string
  title?: string
  side?: string
}

export type TipSide = 'top' | 'right' | 'bottom' | 'left'

/** 目标 → 候选锚点（顺序回退；右栏各 tab 都指向右栏容器） */
const TARGET_FALLBACKS: Record<string, string[]> = {
  composer: ['composer'],
  sessions: ['sessions'],
  'agent-panel': ['agent-panel', 'sessions'],
  files: ['right-rail'],
  terminal: ['right-rail'],
  preview: ['right-rail'],
  artifacts: ['right-rail'],
}

/** 气泡与锚点/视口边缘的间距 */
const GAP = 12
const EDGE = 8

export function resolveTipAnchor(target: string, doc: Document = document): HTMLElement | null {
  const chain = TARGET_FALLBACKS[target] ?? [target]
  for (const key of chain) {
    if (key === 'composer') {
      const byId = doc.getElementById('input')
      if (byId) return byId
    }
    const el = doc.querySelector(`[data-desktop-target="${key}"]`)
    if (el instanceof HTMLElement) return el
  }
  return null
}

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 锚点元素缺失时的区域回退（面板没打开也仍指向正确方向）：
 * 左侧面板类目标 → 左缘；右栏类目标 → 右缘。
 */
export function fallbackAnchorRect(
  target: string,
  viewport: { width: number; height: number },
): RectLike {
  if (target === 'sessions' || target === 'agent-panel') {
    return { left: 8, top: 72, right: Math.min(300, Math.round(viewport.width * 0.3)), bottom: 480 }
  }
  return {
    left: Math.max(8, viewport.width - 380),
    top: 72,
    right: viewport.width - 8,
    bottom: 480,
  }
}

export interface TipPosition {
  left: number
  top: number
  placement: TipSide
}

/**
 * 计算气泡位置（纯函数，单测覆盖）：优先 `side`，放不下就翻到对面；
 * 最终把 left/top 夹进视口，避免气泡跑到屏幕外。
 */
export function computeTipPosition(
  anchor: RectLike,
  bubble: { width: number; height: number },
  side: string | undefined,
  viewport: { width: number; height: number },
): TipPosition {
  const preferred: TipSide = side === 'top' || side === 'right' || side === 'bottom' || side === 'left'
    ? side
    : 'top'

  const fits = (s: TipSide): boolean => {
    if (s === 'top') return anchor.top - GAP - bubble.height >= EDGE
    if (s === 'bottom') return anchor.bottom + GAP + bubble.height <= viewport.height - EDGE
    if (s === 'left') return anchor.left - GAP - bubble.width >= EDGE
    return anchor.right + GAP + bubble.width <= viewport.width - EDGE
  }

  const opposite: Record<TipSide, TipSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  }
  const placement = fits(preferred) ? preferred : fits(opposite[preferred]) ? opposite[preferred] : preferred

  let left: number
  let top: number
  if (placement === 'top' || placement === 'bottom') {
    left = anchor.left + (anchor.right - anchor.left) / 2 - bubble.width / 2
    top = placement === 'top' ? anchor.top - GAP - bubble.height : anchor.bottom + GAP
  } else {
    left = placement === 'left' ? anchor.left - GAP - bubble.width : anchor.right + GAP
    top = anchor.top + (anchor.bottom - anchor.top) / 2 - bubble.height / 2
  }

  const clamp = (v: number, max: number): number => Math.max(EDGE, Math.min(v, Math.max(EDGE, max - bubble.width)))
  return {
    left: Math.round(clamp(left, viewport.width)),
    top: Math.round(Math.max(EDGE, Math.min(top, Math.max(EDGE, viewport.height - bubble.height - EDGE)))),
    placement,
  }
}

const AUTO_DISMISS_MS = 12_000

export default function TipBubble({ tip, onDismiss }: { tip: TipState | null; onDismiss: () => void }) {
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<TipPosition | null>(null)

  useLayoutEffect(() => {
    if (!tip) {
      setPos(null)
      return
    }
    const place = (): void => {
      const bubble = bubbleRef.current
      if (!bubble) {
        setPos(null)
        return
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const anchor = resolveTipAnchor(tip.target)
      const rect = anchor ? anchor.getBoundingClientRect() : fallbackAnchorRect(tip.target, viewport)
      setPos(
        computeTipPosition(
          rect,
          { width: bubble.offsetWidth, height: bubble.offsetHeight },
          tip.side,
          viewport,
        ),
      )
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [tip])

  useEffect(() => {
    if (!tip) return
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [tip, onDismiss])

  if (!tip) return null

  return (
    <div
      ref={bubbleRef}
      role="status"
      data-placement={pos?.placement ?? 'top'}
      className="tip-bubble"
      onClick={onDismiss}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        zIndex: 70,
        maxWidth: 320,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--ui-bg-elevated, #1f2430)',
        color: 'var(--ui-text-primary, #e6e6e6)',
        border: '1px solid var(--ui-border, rgba(255,255,255,0.12))',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
        fontSize: 13,
        lineHeight: 1.45,
        cursor: 'pointer',
        opacity: pos ? 1 : 0,
        transition: 'opacity 120ms ease-out',
      }}
    >
      {tip.title ? <div style={{ fontWeight: 600, marginBottom: 2 }}>{tip.title}</div> : null}
      <div>{tip.text}</div>
    </div>
  )
}
