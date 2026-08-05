/**
 * 跨会话产物画廊数据层（对齐 Hermes app/artifacts/artifact-utils.ts）
 *
 * 从会话历史消息（assistant/tool 角色）重新提取三类产物：
 *   - image：data:image/ 或图片扩展名路径/URL
 *   - file：本地路径（/ ./ ../ ~/ file://）
 *   - link：http(s) URL
 *
 * 与 store/artifacts.ts 的区别：store 是内存态（当前会话，注册制），
 * 画廊是跨会话扫描（按需从 session.history 拉消息重建），数据源 = 会话库。
 */

export type ArtifactKind = 'image' | 'file' | 'link'
export type ArtifactFilter = 'all' | ArtifactKind
export const ARTIFACT_FILTERS: readonly ArtifactFilter[] = ['all', 'image', 'file', 'link']

export interface GalleryArtifact {
  id: string
  kind: ArtifactKind
  value: string
  href: string
  label: string
  sessionId: string
  sessionTitle: string
  timestamp: number
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g
const URL_RE = /https?:\/\/[^\s<>"')]+/g
const PATH_RE = /(^|[\s("'`])((?:\/|~\/|\.\.?\/)[^\s"'`<>]+(?:\.[a-z0-9]{1,8})?)/gi
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?.*)?$/i
const FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|pdf|txt|json|md|csv|zip|tar|gz|mp3|wav|mp4|mov)(?:\?.*)?$/i
const KEY_HINT_RE = /(path|file|url|image|artifact|output|download|result|target)/i

/** 会话标题回退（对齐 Hermes artifactSessionTitle） */
function artifactSessionTitle(session: { title?: string | null; preview?: string | null }): string {
  return session.title?.trim() || session.preview?.trim() || '未命名会话'
}

function normalizeValue(value: string): string {
  return value.trim().replace(/[),.;]+$/, '')
}

function parseMaybeJson(value: string): unknown {
  if (!value.trim()) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function looksLikePathOrUrl(value: string): boolean {
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('file://') ||
    value.startsWith('data:image/') ||
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/')
  )
}

function looksLikeArtifact(value: string): boolean {
  if (/^(?:https?:\/\/|data:image\/)/.test(value)) return true
  if (looksLikePathOrUrl(value) && (IMAGE_EXT_RE.test(value) || FILE_EXT_RE.test(value))) return true
  return value.startsWith('/') && value.includes('.')
}

function artifactKind(value: string): ArtifactKind {
  if (value.startsWith('data:image/') || IMAGE_EXT_RE.test(value)) return 'image'
  if (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('~/') ||
    value.startsWith('file://')
  ) {
    return 'file'
  }
  return 'link'
}

function artifactHref(value: string): string {
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value
  if (value.startsWith('file://') || value.startsWith('/')) return value
  return value
}

function artifactLabel(value: string): string {
  try {
    const url = new URL(value)
    const item = url.pathname.split('/').filter(Boolean).pop()
    return item || value
  } catch {
    const parts = value.split(/[\\/]/).filter(Boolean)
    return parts.pop() || value
  }
}

/** ELEVE 消息文本提取：content 可能是 string 或多模态 array（适配增强） */
function messageText(message: {
  content?: unknown
  text?: unknown
  context?: unknown
}): string {
  const content = message.content
  if (typeof content === 'string' && content.trim()) return content
  // 多模态 array：拼接 text 项（Hermes 只收 string；ELEVE 消息 content 可为 array）
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && (part as { type?: string; text?: string }).type === 'text') {
          return (part as { text?: string }).text ?? ''
        }
        return ''
      })
      .join('')
      .trim()
  }
  if (typeof message.text === 'string' && message.text.trim()) return message.text
  if (typeof message.context === 'string' && message.context.trim()) return message.context
  return ''
}

function collectStringValues(
  value: unknown,
  keyPath: string,
  collector: (value: string, keyPath: string) => void,
): void {
  if (typeof value === 'string') {
    collector(value, keyPath)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStringValues(entry, `${keyPath}.${index}`, collector))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectStringValues(child, keyPath ? `${keyPath}.${key}` : key, collector)
  }
}

function collectArtifactsFromText(text: string, pushValue: (value: string) => void): void {
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    pushValue(match[2] || '')
  }
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const start = match.index ?? 0
    if (start > 0 && text[start - 1] === '!') continue
    const value = match[2] || ''
    if (looksLikeArtifact(value)) pushValue(value)
  }
  for (const match of text.matchAll(URL_RE)) {
    const value = match[0] || ''
    if (looksLikeArtifact(value)) pushValue(value)
  }
  for (const match of text.matchAll(PATH_RE)) {
    pushValue(match[2] || '')
  }
}

function collectArtifactsFromMessage(
  message: {
    role?: string
    content?: unknown
    text?: unknown
    context?: unknown
    tool_calls?: unknown
  },
  pushValue: (value: string) => void,
): void {
  const text = messageText(message)
  if (text) collectArtifactsFromText(text, pushValue)

  if (message.role !== 'tool' && !Array.isArray(message.tool_calls)) return

  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      collectStringValues(call, 'tool_call', (value, keyPath) => {
        const normalized = normalizeValue(value)
        if (!normalized) return
        if (KEY_HINT_RE.test(keyPath) && (looksLikePathOrUrl(normalized) || FILE_EXT_RE.test(normalized))) {
          pushValue(normalized)
        }
      })
    }
  }

  const parsed = parseMaybeJson(text)
  if (parsed !== null) {
    collectStringValues(parsed, 'tool_result', (value, keyPath) => {
      const normalized = normalizeValue(value)
      if (!normalized) return
      if ((KEY_HINT_RE.test(keyPath) || looksLikePathOrUrl(normalized)) && looksLikeArtifact(normalized)) {
        pushValue(normalized)
      }
    })
  }
}

/** 时间戳回退链（对齐 Hermes：message.timestamp → session.last_active → started_at） */
function artifactTimestamp(
  message: { timestamp?: unknown },
  session: { last_active?: unknown; started_at?: unknown },
): number {
  const toNum = (v: unknown): number | null => {
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = Number(v)
      if (!Number.isNaN(n)) return n
      const t = Date.parse(v)
      if (!Number.isNaN(t)) return t
    }
    return null
  }
  return toNum(message.timestamp) ?? toNum(session.last_active) ?? toNum(session.started_at) ?? Date.now()
}

/**
 * 从会话消息提取产物（对齐 Hermes collectArtifactsForSession）：
 * 只扫 assistant/tool 角色；文本（markdown 图/链、URL、路径）+ tool_calls/tool_result
 * 递归收集（KEY_HINT 提示键 + 路径/URL 形态）；按 sessionId:value 去重。
 */
export function collectArtifactsForSession(
  session: {
    id: string
    title?: string | null
    preview?: string | null
    started_at?: unknown
    last_active?: unknown
  },
  messages: Array<{
    role?: string
    content?: unknown
    text?: unknown
    context?: unknown
    tool_calls?: unknown
    timestamp?: unknown
  }>,
): GalleryArtifact[] {
  const found = new Map<string, GalleryArtifact>()
  const title = artifactSessionTitle(session)

  for (const message of messages) {
    if (message.role !== 'assistant' && message.role !== 'tool') continue
    collectArtifactsFromMessage(message, (candidate) => {
      const value = normalizeValue(candidate)
      if (!value || !looksLikeArtifact(value)) return
      const key = `${session.id}:${value}`
      if (found.has(key)) return
      found.set(key, {
        id: key,
        kind: artifactKind(value),
        value,
        href: artifactHref(value),
        label: artifactLabel(value),
        sessionId: session.id,
        sessionTitle: title,
        timestamp: artifactTimestamp(message, session),
      })
    })
  }

  return Array.from(found.values())
}
