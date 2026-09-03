/**
 * local-preview — 预览目标归一化（对齐 Hermes lib/local-preview.ts localPreviewTarget）
 *
 * 把裸目标（web URL / localhost / 文件路径 / file: URL / 相对路径）分类为
 * PreviewTarget：
 * - http(s):// → url target
 * - 文件路径 → file target（相对路径基于 cwd join；Windows 盘符绝对路径原样）
 * ELEVE 无 Electron IPC（hermesDesktop.normalizePreviewTarget），renderer 侧分类即最终分类。
 */

import type { PreviewTarget } from '@/store/preview'

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value
}

function joinPath(base: string, rel: string): string {
  if (!base) return rel
  return `${base.replace(/[\\/]+$/, '')}/${rel.replace(/^\.?\//, '')}`
}

/** Windows 盘符绝对路径（C:\… / C:/…） */
function isWindowsAbsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value)
}

// 🔴 2026-08-29 对齐 Hermes local-preview.ts：扩展名 → previewKind（内容形态）
const HTML_EXTENSIONS = new Set(['html', 'htm', 'xhtml'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
// 🔴 2026-09-03 对齐 Hermes MEDIA_BY_EXT video 条目：视频文件走播放器预览，
// 不再落 text（isLikelyBinary → "二进制文件，无法预览"）
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi'])

/** 扩展名 → MIME（对齐 Hermes mimeType 富化；常用子集，后端嗅探可覆盖） */
const MIME_BY_EXT: Record<string, string> = {
  avi: 'video/x-msvideo',
  bmp: 'image/bmp',
  css: 'text/css',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  mjs: 'text/javascript',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  wasm: 'application/wasm',
  webm: 'video/webm',
  webp: 'image/webp',
  xml: 'application/xml',
}

function extensionOf(path: string): string {
  return /\.([a-z0-9]{1,8})$/i.exec(path)?.[1]?.toLowerCase() ?? ''
}

function filePreviewTarget(path: string): PreviewTarget {
  const ext = extensionOf(path)
  const previewKind = HTML_EXTENSIONS.has(ext)
    ? ('html' as const)
    : ext === 'pdf'
      ? ('pdf' as const)
      : VIDEO_EXTENSIONS.has(ext)
        ? ('video' as const)
        : IMAGE_EXTENSIONS.has(ext)
          ? ('image' as const)
          : ('text' as const)
  const mimeType = MIME_BY_EXT[ext]
  return {
    kind: 'file',
    url: path,
    name: basename(path),
    label: basename(path),
    previewKind,
    ...(mimeType ? { mimeType } : {}),
  }
}

export function localPreviewTarget(rawTarget: string, cwd?: string | null): PreviewTarget | null {
  const raw = rawTarget.trim().replace(/^`|`$/g, '')

  if (!raw) return null

  // Web URL → url target
  if (/^https?:\/\//i.test(raw)) {
    return { kind: 'url', url: raw, label: basename(raw) }
  }

  let path = raw

  // file: URL → 解码为本地路径
  if (/^file:\/\//i.test(raw)) {
    try {
      path = decodeURIComponent(new URL(raw).pathname)
    } catch {
      path = raw.replace(/^file:\/\//i, '')
    }
  } else if (!raw.startsWith('/') && !isWindowsAbsPath(raw) && cwd) {
    // 相对路径 → 基于 cwd join（Hermes 同款；Windows 绝对路径/根路径不 join）
    path = joinPath(cwd, raw)
  }

  return filePreviewTarget(path)
}

export function normalizeOrLocalPreviewTarget(
  rawTarget: string,
  cwd?: string | null,
): PreviewTarget | null {
  return localPreviewTarget(rawTarget, cwd)
}
