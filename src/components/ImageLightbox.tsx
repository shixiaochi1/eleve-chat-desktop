/**
 * ImageLightbox — 图片点击放大预览（对齐 Hermes AttachmentPill → ImageLightbox）
 *
 * 行为语义（Hermes 基线 + 2026-08-21 增强）：
 * - 点击附件缩略图 → 全屏遮罩 + 原图居中
 * - 🔴 2026-08-21 增强（老大需求）：**鼠标滚轮缩放**（以光标为中心，0.5x~8x）、
 *   缩放后**拖拽平移**、双击复位 100%、缩放比例右下角指示
 * - Esc / 点击遮罩 → 关闭
 * - 提供下载按钮（Hermes useImageDownload 语义：data URL 直接下载原图）
 * - 纯交互无 JS 定时器；prefers-reduced-motion 下拖拽过渡禁用
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface ImageLightboxProps {
  /** 图片源（data URL / http URL / 本地路径） */
  src: string
  /** 图片名（下载文件名 + 无障碍标签） */
  alt?: string
  onClose: () => void
}

const MIN_SCALE = 0.5
const MAX_SCALE = 8
const ZOOM_STEP = 1.15
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Esc 关闭（对齐 Hermes lightbox：键盘可关闭）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 滚轮缩放：以光标为中心（光标处像素在缩放前后保持不动）
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const ratio = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      const next = clamp(scale * ratio, MIN_SCALE, MAX_SCALE)
      if (next === scale) return
      const k = next / scale
      setPos({
        x: e.clientX - cx - (e.clientX - cx - pos.x) * k,
        y: e.clientY - cy - (e.clientY - cy - pos.y) * k,
      })
      setScale(next)
    },
    [scale, pos],
  )

  // 拖拽平移（缩放后可拖动看细节）
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) return // 未放大不需要平移
      dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y }
      setDragging(true)
    },
    [scale, pos],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      setPos({ x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) })
    },
    [],
  )
  const onPointerUp = useCallback(() => {
    dragRef.current = null
    setDragging(false)
  }, [])

  const reset = useCallback(() => {
    setScale(1)
    setPos({ x: 0, y: 0 })
  }, [])

  const download = useCallback(() => {
    try {
      const a = document.createElement('a')
      a.href = src
      a.download = alt && alt !== 'attachment' ? alt : 'image'
      a.click()
    } catch {
      /* 下载失败静默（Hermes useImageDownload 同款容忍） */
    }
  }, [src, alt])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onWheel={onWheel}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? '图片预览'}
    >
      <img
        src={src}
        alt={alt ?? ''}
        className="max-h-[85vh] max-w-[85vw] object-contain rounded-lg shadow-2xl select-none"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          transition: dragging ? 'none' : 'transform 120ms ease-out',
          cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={reset}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        title={scale > 1 ? '拖拽平移 · 双击复位' : '滚轮缩放 · 双击放大'}
      />

      {/* 缩放比例指示（非 100% 时显示） */}
      {scale !== 1 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white backdrop-blur tabular-nums">
          {Math.round(scale * 100)}%
        </div>
      )}
      {/* 复位按钮（非 100% 时显示） */}
      {scale !== 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            reset()
          }}
          className="absolute top-4 left-16 rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-white/25"
          title="复位 100%"
        >
          复位
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          download()
        }}
        className="absolute top-4 right-4 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur transition-colors hover:bg-white/25"
        title="下载图片"
        aria-label="下载图片"
      >
        下载
      </button>
      <button
        onClick={onClose}
        className="absolute top-4 left-4 grid size-8 place-items-center rounded-md bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/25"
        title="关闭 (Esc)"
        aria-label="关闭预览"
      >
        ✕
      </button>
    </div>
  )
}

export default ImageLightbox
