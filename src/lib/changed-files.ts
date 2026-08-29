/**
 * ChangedFiles 纯派生（对齐 Hermes changed-files.ts）：
 * 把一轮 assistant 消息中的文件编辑工具调用折叠为每文件一行（首次触碰序，
 * 同一文件多次编辑的 +/- 求和）。仅落定的 diff 计数：运行中无 result，失败未改任何东西。
 */

import type { ChatMessagePart } from '@/lib/chat-messages'
import { firstStringField } from '@/lib/text'

const FILE_EDIT_TOOL_NAMES = new Set(['edit_file', 'patch', 'write_file'])

export interface ChangedFile {
  added: number
  /** Basename，行标签 */
  name: string
  /** 工具报告时的原始路径（绝对或仓库相对） */
  path: string
  removed: number
}

export interface DiffLineStats {
  added: number
  removed: number
}

export function isFileEditTool(toolName: string): boolean {
  return FILE_EDIT_TOOL_NAMES.has(toolName)
}

export function countDiffLineStats(diff: string): DiffLineStats {
  let added = 0
  let removed = 0

  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed += 1
    }
  }

  return { added, removed }
}

function parseMaybeObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  return {}
}

function htmlPathFromInlineDiff(diff: string): string {
  const match = /^diff --git a\/(.+?) b\//.exec(diff.trim())
  return match ? match[1]!.trim() : ''
}

function stripInlineDiffChrome(value: string): string {
  return value
    .split('\n')
    .filter((line) => !/^[-=]{3,}\s*$/.test(line.trim()))
    .join('\n')
    .trim()
}

/** 从工具 result 提取内联 diff（对齐 Hermes inlineDiffFromResult：inline_diff 优先，diff 兜底） */
export function inlineDiffFromResult(result: unknown): string {
  const record = parseMaybeObject(result)

  for (const key of ['inline_diff', 'diff']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return stripInlineDiffChrome(value)
    }
  }

  return ''
}

export function fileEditPath(args: Record<string, unknown>, result: Record<string, unknown>): string {
  return (
    firstStringField(args, ['path', 'file', 'filepath']) ||
    firstStringField(result, ['path', 'file', 'filepath', 'resolved_path']) ||
    htmlPathFromInlineDiff(firstStringField(result, ['inline_diff', 'diff']))
  )
}

export function fileEditBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const base = normalized.split('/').pop()
  return base || path
}

/**
 * 一行一个文件（首次触碰序），同一文件多次编辑的 +/- 求和。
 * 仅落定的 diff 计数：运行中调用无 result，失败调用改了 0 行。
 */
export function deriveChangedFiles(parts: readonly ChatMessagePart[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>()

  for (const part of parts) {
    if (part.type !== 'tool-call' || !isFileEditTool(part.toolName)) {
      continue
    }

    const result = parseMaybeObject(part.result)
    const diff = inlineDiffFromResult(part.result)

    if (!diff) {
      continue
    }

    const path = fileEditPath(part.args ?? {}, result)

    if (!path) {
      continue
    }

    const stats = countDiffLineStats(diff)
    const existing = byPath.get(path)

    if (existing) {
      existing.added += stats.added
      existing.removed += stats.removed
    } else {
      byPath.set(path, { added: stats.added, name: fileEditBasename(path), path, removed: stats.removed })
    }
  }

  return [...byPath.values()]
}
