/**
 * Timeline 纯函数（对齐 Hermes timeline-data.ts，零 React/DOM 依赖）
 *
 * ELEVE 版本适配：
 * - 数据源为 store/messages 的 ChatMessage（含 id/role/parts），非 assistant-ui
 * - 背景进程通知过滤：Hermes PROCESS_NOTIFICATION_RE 同款（/[IMPORTANT: Background process/）
 */

export interface TimelineSourceMessage {
  id: string
  role: string
  text: string
}

export interface TimelineEntry {
  id: string
  preview: string
}

const PROCESS_NOTIFICATION_RE = /^\[IMPORTANT: Background process [\s\S]*\]$/

const PREVIEW_MAX = 120

export function timelinePreview(text: string, max: number = PREVIEW_MAX): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  if (collapsed.length <= max) {
    return collapsed
  }

  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

/** 从消息列表派生时间线条目（仅用户提示；空文本与后台通知跳过） */
export function deriveTimelineEntries(messages: readonly TimelineSourceMessage[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }

    const text = message.text.trim()

    if (!text || PROCESS_NOTIFICATION_RE.test(text)) {
      continue
    }

    entries.push({ id: message.id, preview: timelinePreview(text) })
  }

  return entries
}

/** 两次派生是否等价（转录未变时复用旧数组，零重渲染） */
export function sameTimelineEntries(a: readonly TimelineEntry[], b: readonly TimelineEntry[]): boolean {
  if (a === b) {
    return true
  }

  if (a.length !== b.length) {
    return false
  }

  return a.every((entry, index) => entry.id === b[index].id && entry.preview === b[index].preview)
}

/** 视口顶部之上（含容差）最后一条用户提示；无渲染项时回退首个渲染项 */
export function activeTimelineIndex(offsets: readonly (number | null)[], slack: number = 8): number {
  let active = -1
  let firstRendered = -1

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i]

    if (offset == null) {
      continue
    }

    if (firstRendered === -1) {
      firstRendered = i
    }

    if (offset <= slack) {
      active = i
    }
  }

  if (active !== -1) {
    return active
  }

  return firstRendered === -1 ? 0 : firstRendered
}
