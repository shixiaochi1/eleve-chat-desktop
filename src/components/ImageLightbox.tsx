/**
 * ImageLightbox — 图片点击放大预览（对齐 Hermes AttachmentPill → ImageLightbox）
 *
 * 行为语义（Hermes 基线）：
 * - 点击附件缩略图 → 全屏遮罩 + 原图居中
 * - Esc / 点击遮罩 → 关闭
 * - 提供下载按钮（Hermes useImageDownload 语义：data URL 直接下载原图）
 */
import { useCallback, useEffect } from 'react'

interface ImageLightboxProps {
  /** 图片源（data URL / http URL） */
  src: string
  /** 图片名（下载文件名 + 无障碍标签） */
  alt?: string
  onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  // Esc 关闭（对齐 Hermes lightbox：键盘可关闭）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? '图片预览'}
    >
      <img
        src={src}
        alt={alt ?? ''}
        className="max-h-[85vh] max-w-[85vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
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
