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

  return { kind: 'file', url: path, name: basename(path), label: basename(path) }
}

export function normalizeOrLocalPreviewTarget(
  rawTarget: string,
  cwd?: string | null,
): PreviewTarget | null {
  return localPreviewTarget(rawTarget, cwd)
}
