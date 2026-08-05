/**
 * Artifact 检测 — 对齐 Hermes lib/artifact-detect.ts + lib/markdown-code.ts
 *
 * 判定何时把消息里的代码围栏"提升"为 artifact 卡片（右栏/浮层预览）而非行内代码块：
 * - html：完整文档（<!doctype/<html>/<head>/<body>）≥160 字符；或大片段 ≥1200 字符含标签
 * - svg：≥2000 字符的独立图形
 * - code：非散文类语言 + 足够大（≥3000 字符 或 ≥48 行）
 * 纯函数、无 store 访问 —— 流式每 delta 在增长中的 fence 上运行，全部是有界正则/行数扫描。
 */

export type ArtifactKind = 'code' | 'html' | 'svg'

export interface ArtifactDetection {
  kind: ArtifactKind
  /** 清洗后的围栏语言（html/svg 按形态检测时可能为 ''） */
  language: string
  /** 人类可读标题（html <title>、svg <title>、代码命名声明/文件名注释；回退 kind/语言标签） */
  title: string
}

// ── 阈值（对齐 Hermes）──
const HTML_DOC_RE = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i
const HTML_TAG_RE = /<[a-z][a-z0-9-]*(\s[^>]*)?>/i
const HTML_DOC_MIN_CHARS = 160
const HTML_FRAGMENT_MIN_CHARS = 1200
const SVG_MIN_CHARS = 2000
const CODE_MIN_LINES = 48
const CODE_MIN_CHARS = 3000

const HTML_LANGUAGES = new Set(['html', 'htm', 'xhtml'])

// 永不提升为 artifact 的语言：散文类、终端输出、已被更丰富渲染器占用的 fence
const NON_ARTIFACT_LANGUAGES = new Set([
  '', 'console', 'diff', 'log', 'logs', 'markdown', 'md', 'mermaid',
  'output', 'patch', 'plain', 'plaintext', 'shell-session', 'stdout', 'text', 'txt',
])

// ── 语言标签清洗（对齐 Hermes sanitizeLanguageTag）──
const VALID_LANGUAGE_RE = /^[a-z0-9][a-z0-9+#-]*$/i

export function sanitizeLanguageTag(tag: string): string {
  const trimmed = tag.trim()
  const first = trimmed.split(/\s/, 1)[0] || ''
  return VALID_LANGUAGE_RE.test(first) && first.length <= 16 ? first.toLowerCase() : ''
}

// ── 散文代码块判定（对齐 Hermes isLikelyProseCodeBlock + codeSignals，2026-08-05 审查修正）──
// 🔴 审查发现：初版凭记忆简化（布尔判断 + 自创模式集）→ 判定结果漂移；
// 现逐条对齐 Hermes markdown-code.ts 原文（三组正则 match 计数累加）。
const NON_CODE_FENCE_LANGUAGES = new Set(['', 'text', 'plain', 'plaintext', 'md', 'markdown'])
const COMMON_CODE_LANGUAGES = new Set([
  'bash', 'c', 'cpp', 'css', 'diff', 'go', 'html', 'java', 'javascript', 'js',
  'json', 'jsx', 'markdown', 'md', 'php', 'python', 'py', 'ruby', 'rust', 'rs',
  'sh', 'sql', 'swift', 'tsx', 'ts', 'typescript', 'xml', 'yaml', 'yml',
])

const CODE_SIGNAL_RE = [
  /(^|\s)(const|let|var|function|class|import|export|return|if|for|while|switch)\b/gim,
  /=>|==|===|!=|!==|\{|\}|;|<\/?[a-z][^>]*>/gi,
  /^\s*(#include|SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b/gim,
]

function codeSignalCount(body: string): number {
  return CODE_SIGNAL_RE.reduce((total, pattern) => total + (body.match(pattern)?.length ?? 0), 0)
}

function proseLineCount(body: string): number {
  return body.split('\n').filter((line) => {
    const trimmed = line.trim()
    return Boolean(trimmed) && /^[A-Za-z0-9"'`*-]/.test(trimmed)
  }).length
}

function codeSignals(body: string): {
  trimmed: string
  bulletLines: number
  codeSignals: number
  hasMarkdown: boolean
  proseLines: number
  urlLines: number
} {
  const trimmed = body.trim()
  const markdownSignals = (trimmed.match(/\*\*[^*]+\*\*/g) || []).length + (trimmed.match(/`[^`\n]+`/g) || []).length
  return {
    trimmed,
    bulletLines: (trimmed.match(/^\s*[-*]\s+\S+/gm) || []).length,
    codeSignals: codeSignalCount(trimmed),
    hasMarkdown: markdownSignals > 0,
    proseLines: proseLineCount(trimmed),
    urlLines: (trimmed.match(/^\s*https?:\/\/\S+\s*$/gim) || []).length,
  }
}

function isLikelyProseCodeBlock(language: string | undefined, code: string | undefined): boolean {
  const cleanLanguage = sanitizeLanguageTag(language || '')
  const signals = codeSignals(code || '')
  if (!signals.trimmed || signals.codeSignals >= 3) return false
  if (signals.bulletLines >= 1 && (signals.hasMarkdown || signals.proseLines >= 2)) return true
  if (NON_CODE_FENCE_LANGUAGES.has(cleanLanguage)) {
    return signals.proseLines >= 3 && signals.codeSignals === 0
  }
  return !COMMON_CODE_LANGUAGES.has(cleanLanguage) && signals.proseLines >= 2 && signals.codeSignals <= 1
}

// ── 标题提取（对齐 Hermes）──
function countLines(text: string): number {
  let lines = 1
  let index = text.indexOf('\n')
  while (index !== -1) {
    lines += 1
    index = text.indexOf('\n', index + 1)
  }
  return lines
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function titleFromTag(content: string, tag: 'h1' | 'title'): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(content)
  return match ? stripTags(match[1] || '').slice(0, 80) : ''
}

const CODE_DECLARATION_RE =
  /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|struct|interface|enum|trait|impl|def|fn)\s+([A-Za-z_$][\w$]*)/

// `// app.py`、`# server.ts`、`<!-- index.html -->`、`/* main.rs */` 首行文件命名惯例
const FILENAME_COMMENT_RE = /^\s*(?:\/\/|#|--|<!--|\/\*)\s*([\w./-]+\.[a-z0-9]{1,8})\b/i

function codeTitle(language: string, content: string): string {
  const head = content.slice(0, 2000)
  const fileName = FILENAME_COMMENT_RE.exec(head)?.[1]
  if (fileName) return fileName
  const declaration = CODE_DECLARATION_RE.exec(head)?.[1]
  if (declaration) return declaration
  return language
}

export function detectArtifact(language: string | undefined, code: string | undefined): ArtifactDetection | null {
  const trimmed = (code ?? '').trim()
  if (!trimmed) return null

  const clean = sanitizeLanguageTag(language || '')

  if (HTML_LANGUAGES.has(clean)) {
    const isDocument = HTML_DOC_RE.test(trimmed)
    if (
      (isDocument && trimmed.length >= HTML_DOC_MIN_CHARS) ||
      (!isDocument && trimmed.length >= HTML_FRAGMENT_MIN_CHARS && HTML_TAG_RE.test(trimmed))
    ) {
      return {
        kind: 'html',
        language: clean,
        title: titleFromTag(trimmed, 'title') || titleFromTag(trimmed, 'h1') || 'HTML',
      }
    }
    return null
  }

  if (clean === 'svg') {
    if (trimmed.length >= SVG_MIN_CHARS && /<svg[\s>]/i.test(trimmed)) {
      return { kind: 'svg', language: clean, title: titleFromTag(trimmed, 'title') || 'SVG' }
    }
    return null
  }

  if (NON_ARTIFACT_LANGUAGES.has(clean)) return null

  if (trimmed.length < CODE_MIN_CHARS && countLines(trimmed) < CODE_MIN_LINES) return null

  if (isLikelyProseCodeBlock(clean, trimmed)) return null

  return { kind: 'code', language: clean, title: codeTitle(clean, trimmed) }
}

/** 稳定身份 slug（对齐 Hermes artifactSlug）：title 小写 slug 化（非字母数字→'-'、
 *  截断 48、空→'untitled'）。大小写/特殊字符不同的标题归一到同一 artifact。 */
export function artifactSlug(detection: Pick<ArtifactDetection, 'kind' | 'language' | 'title'>): string {
  const title = detection.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${detection.kind}:${detection.language}:${title || 'untitled'}`
}

/** 非加密内容哈希（FNV-1a，对齐 Hermes artifactContentHash）— 版本去重用 */
export function artifactContentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
