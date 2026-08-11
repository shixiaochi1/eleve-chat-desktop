/**
 * chat-messages.ts — Message data model aligned 1:1 with Eleve
 *
 * Core types and utilities for the parts-based message architecture.
 * Eleve uses assistant-ui's ThreadMessageLike under the hood;
 * we replicate the same shape directly.
 *
 * Key difference from the old flat model:
 *   OLD: each SSE event → independent ChatMessage (type: 'tool', 'reasoning', etc.)
 *   NEW: one assistant ChatMessage contains parts[] — reasoning, tool-calls, text are parts
 */

// ── ChatMessagePart types (1:1 from assistant-ui ThreadAssistantMessagePart) ──

export interface TextMessagePart {
  readonly type: 'text'
  readonly text: string
}

export interface ReasoningMessagePart {
  readonly type: 'reasoning'
  readonly text: string
  /** 推理块已冻结（reasoning.end 发出）。冻结后下一个 reasoning.delta 新开块 — 多推理块支持 */
  readonly done?: boolean
}

export interface ToolCallMessagePart {
  readonly type: 'tool-call'
  readonly toolCallId: string
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly argsText: string
  readonly result?: unknown
  readonly isError?: boolean
  /** 工具执行耗时（秒）— 来自 tool.complete 事件（对齐 CLI "工具完成: X (12.1s)"） */
  readonly duration?: number
}

/** Union of all part types an assistant message can contain */
export type ChatMessagePart = TextMessagePart | ReasoningMessagePart | ToolCallMessagePart

/** Union of part types a user message can contain */
export interface UserTextPart {
  readonly type: 'text'
  readonly text: string
}

// ── ChatMessage — the top-level message type (3.5: 单一权威源) ──

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: MessageRole
  /** Parts-based content — 1:1 aligned with Eleve. Each assistant message
   *  contains reasoning/text/tool-call parts. User messages contain text parts. */
  parts: ChatMessagePart[]
  timestamp?: number
  pending?: boolean
  /** 🔴 #5/#6（对齐 Hermes chat-messages.ts:22-25）：interim 标记——step/interim 边界
   *  密封的中间助手消息（工具调用轮次的过程文本）。渲染隐藏 action footer，
   *  complete 时若 final 文本延续 interim 则原地 settle（防重复气泡）。 */
  interim?: boolean
  error?: string
  hidden?: boolean
  /** 附件引用（对齐 Hermes submit.ts optimisticAttachmentRef → ChatMessage.attachmentRefs）：
   *  图片 = data URL（可直接 <img> 渲染缩略图）；文件/路径 = 引用文本。
   *  乐观消息/历史恢复两条路径共用，MessageRow 渲染在用户气泡下方。 */
  attachmentRefs?: string[]

  // ── Legacy flat fields (kept for backward compatibility during migration) ──
  /** @deprecated Use parts instead */
  type?: string
  /** @deprecated Use parts instead */
  content?: string
  /** @deprecated Use parts instead */
  reasoning_content?: string
  /** @deprecated Internal streaming flag — use pending instead */
  _streaming?: boolean
  /** @deprecated Use tool-call part.toolCallId */
  tool_call_id?: string
  /** @deprecated Use tool-call part.toolName */
  tool_name?: string
  /** @deprecated Use tool-call part.args */
  tool_input?: string
  /** @deprecated Use tool-call part.result */
  tool_output?: string
  callId?: string
  toolName?: string
  argsStr?: string
  status?: string
  inputTokens?: number
  outputTokens?: number
  time?: string
  show?: boolean
  resultStr?: string
}

// ── GatewayEventPayload — SSE event data shape ──

export interface GatewayEventPayload {
  text?: string
  rendered?: string
  status?: string
  message?: string
  id?: string
  name?: string
  tool_id?: string
  tool_call_id?: string
  args?: unknown
  arguments?: unknown
  context?: string
  input?: unknown
  preview?: string
  result?: unknown
  summary?: string
  error?: string | boolean
  inline_diff?: string
  duration_s?: number
  duration?: number
  todos?: unknown
  model?: string
  provider?: string
  reasoning_effort?: string
  service_tier?: string
  fast?: boolean
  yolo?: boolean
  running?: boolean
  cwd?: string
  branch?: string
  credential_warning?: string
  personality?: string
  usage?: Record<string, unknown>
  // clarify.request
  request_id?: string
  question?: string
  choices?: string[] | null
  // approval.request
  command?: string
  description?: string
  // secret.request
  env_var?: string
  prompt?: string
}

// ── Part factory helpers ──

export function textPart(text: string): TextMessagePart {
  return { type: 'text', text }
}

export function reasoningPart(text: string): ReasoningMessagePart {
  return { type: 'reasoning', text }
}

// ── Append helpers (immutable, return new array) ──

export function appendTextPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  const next = [...parts]
  const last = next.at(-1)

  if (last?.type === 'text') {
    next[next.length - 1] = { ...last, text: `${last.text}${delta}` }
    return next
  }

  // 🔴 2026-08-11 修复（文本晚到乱序）：qwen 推理流中文本可能在工具事件之后到达
  // → append 到末尾会渲染成 [TOOL][TEXT]（工具卡跑到文本前）。对齐 Hermes 视觉
  // （文本上、工具卡下，Hermes mergeFinalAssistantText 是位置保持的替换）：
  // 新开 text 插到第一个 tool-call 之前。
  const firstToolIdx = next.findIndex((p) => p.type === 'tool-call')
  if (firstToolIdx >= 0) {
    return [...next.slice(0, firstToolIdx), textPart(delta), ...next.slice(firstToolIdx)]
  }

  next.push(textPart(delta))
  return next
}

export function appendReasoningPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  // 🔴 块感知追加（对齐 Hermes appendStreamPart 多块语义）：
  // 尾部是未冻结 reasoning 块（done !== true）→ 并入；否则（无/已冻结/尾部是其他类型）→ 新开块。
  // reasoning.end 经 freezeReasoningPart 冻结尾块，下一个 delta 自然新开 — 流式与累加器同构。
  const last = parts.at(-1)
  if (last && last.type === 'reasoning' && !last.done) {
    const next = [...parts]
    next[next.length - 1] = { ...last, text: `${last.text}${delta}` }
    return next
  }
  return [...parts, reasoningPart(delta)]
}

/**
 * 冻结尾部 reasoning 块（reasoning.end 发出）。
 * 冻结后 appendReasoningPart 会新开块 — 单轮多推理块的数据基础。
 * 尾部不是 reasoning 或已冻结时原样返回（纯函数无副作用）。
 */
export function freezeReasoningPart(parts: ChatMessagePart[]): ChatMessagePart[] {
  const last = parts.at(-1)
  if (!last || last.type !== 'reasoning' || last.done) return parts
  const next = [...parts]
  next[next.length - 1] = { ...last, done: true }
  return next
}

/**
 * final 文本是否延续 interim 消息（对齐 Hermes index.ts:552-557 finalContinuesInterim）。
 * 两视图（单视图 useMessageStream / 宫格 useGridChat）complete settle 共用——
 * 单一权威源，防重复气泡判定语义漂移。
 * 双向 startsWith：final 完整包含 interim（正常延续）或 interim 已是完整终稿（
 * final 是它的前缀——后端终稿回传被截断时仍能 settle）。
 */
export function finalContinuesInterim(existing: ChatMessage, finalText: string): boolean {
  if (!existing.interim) return false
  const existingText = existing.parts
    .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim()
  if (!finalText || !existingText) return false
  return (
    finalText === existingText ||
    finalText.startsWith(existingText) ||
    existingText.startsWith(finalText)
  )
}

// ── Tool part ID extraction ──

function toolId(payload: GatewayEventPayload | undefined): string {
  return payload?.tool_id || payload?.tool_call_id || payload?.id || ''
}

let liveToolCounter = 0

function nextLiveToolId(name: string): string {
  liveToolCounter += 1
  return `live-tool:${name}:${liveToolCounter}`
}

// ── Tool argument / result parsing ──

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function firstNonEmptyObject(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const parsed = parseMaybeJsonObject(value)
    if (Object.keys(parsed).length > 0) {
      return parsed
    }
  }
  return {}
}

function liveToolArgs(payload: GatewayEventPayload | undefined): Record<string, unknown> {
  const direct = firstNonEmptyObject(payload?.args, payload?.arguments)
  const input = firstNonEmptyObject(payload?.input)
  const fn = recordFromUnknown(input.function)

  const nested = firstNonEmptyObject(
    input.args,
    input.arguments,
    input.parameters,
    input.input,
    fn?.arguments,
    fn?.args,
    fn?.parameters,
  )

  return { ...input, ...nested, ...direct }
}

function toolArgs(
  payload: GatewayEventPayload | undefined,
  prevArgs?: unknown,
): Record<string, unknown> {
  const prev = parseMaybeJsonObject(prevArgs)
  const eventArgs = liveToolArgs(payload)

  return {
    ...prev,
    ...eventArgs,
    ...(payload?.context ? { context: payload.context } : {}),
    ...(payload?.preview ? { preview: payload.preview } : {}),
  }
}

function toolResult(
  payload: GatewayEventPayload | undefined,
  prevResult?: unknown,
  _prevArgs?: unknown,
): Record<string, unknown> {
  const parsedResult = parseMaybeJsonObject(payload?.result)

  return {
    ...parsedResult,
    ...(payload?.inline_diff ? { inline_diff: payload.inline_diff } : {}),
    ...(payload?.summary ? { summary: payload.summary } : {}),
    ...(payload?.message ? { message: payload.message } : {}),
    ...(payload?.preview ? { preview: payload.preview } : {}),
    ...(payload?.duration_s !== undefined ? { duration_s: payload.duration_s } : {}),
    ...(payload?.error ? { error: payload.error } : {}),
  }
}

// ── Tool part matching ──

function firstStringField(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function normalizeToolMatchValue(value: string): string {
  return value.trim().toLowerCase()
}

function collectToolMatchValues(query: string, context: string, preview: string): string[] {
  return [...new Set([query, context, preview].map(normalizeToolMatchValue).filter(Boolean))]
}

function toolPayloadMatchValues(payload: GatewayEventPayload | undefined): string[] {
  const payloadArgs = liveToolArgs(payload)
  const query = firstStringField(payloadArgs, ['search_term', 'query'])
  const context = typeof payload?.context === 'string' ? payload.context.trim() : ''
  const preview = typeof payload?.preview === 'string' ? payload.preview.trim() : ''

  return collectToolMatchValues(query, context, preview)
}

function toolPartMatchValues(part: ChatMessagePart): string[] {
  if (part.type !== 'tool-call' || !part.args || typeof part.args !== 'object') {
    return []
  }
  const args = part.args as Record<string, unknown>
  const query = firstStringField(args, ['search_term', 'query'])
  const context = typeof args.context === 'string' ? (args.context as string).trim() : ''
  const preview = typeof args.preview === 'string' ? (args.preview as string).trim() : ''

  return collectToolMatchValues(query, context, preview)
}

function hasToolMatchOverlap(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return false
  const rightSet = new Set(right)
  return left.some((value) => rightSet.has(value))
}

function findToolPartIndex(
  parts: ChatMessagePart[],
  name: string,
  stableId: string,
  payload: GatewayEventPayload | undefined,
  phase: 'running' | 'complete',
): number {
  const matchValues = toolPayloadMatchValues(payload)
  const overlaps = (index: number) =>
    hasToolMatchOverlap(matchValues, toolPartMatchValues(parts[index]))

  if (stableId) {
    const stableIndex = parts.findIndex(
      (part) => part.type === 'tool-call' && part.toolCallId === stableId,
    )
    if (stableIndex >= 0) return stableIndex

    // Some live streams start without an id, then complete with one.
    if (phase === 'running' && !matchValues.length) return -1
  }

  const pendingIndices = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.type === 'tool-call' && part.toolName === name && part.result === undefined)
    .map(({ index }) => index)

  if (pendingIndices.length === 0) return -1

  if (matchValues.length) {
    const contextualIndex = pendingIndices.find(overlaps)
    if (contextualIndex !== undefined) return contextualIndex
  }

  if (pendingIndices.length === 1) {
    const [singlePendingIndex] = pendingIndices
    if (phase === 'running' && matchValues.length && !overlaps(singlePendingIndex)) {
      return stableId ? singlePendingIndex : -1
    }
    return singlePendingIndex
  }

  if (phase === 'complete') return pendingIndices[0]
  if (stableId) return pendingIndices[0]

  return pendingIndices.at(-1) ?? -1
}

// ── upsertToolPart — core SSE tool event handler ──

export function upsertToolPart(
  parts: ChatMessagePart[],
  payload: GatewayEventPayload | undefined,
  phase: 'running' | 'complete',
): ChatMessagePart[] {
  const stableId = toolId(payload)
  const name = payload?.name || 'tool'
  const next = [...parts]

  const index = findToolPartIndex(next, name, stableId, payload, phase)

  const prev = index >= 0 ? next[index] : null
  const prevArgs = prev && prev.type === 'tool-call' ? prev.args : undefined
  const prevResult = prev && prev.type === 'tool-call' ? prev.result : undefined
  const args = toolArgs(payload, prevArgs)

  const id =
    stableId ||
    (prev && prev.type === 'tool-call' && prev.toolCallId ? prev.toolCallId : '') ||
    nextLiveToolId(name)

  const base: ToolCallMessagePart = {
    type: 'tool-call',
    toolCallId: id,
    toolName: name,
    args,
    argsText: Object.keys(args).length ? JSON.stringify(args) : '',
    ...(phase === 'complete' && {
      result: toolResult(payload, prevResult, prevArgs),
      isError: Boolean(payload?.error),
    }),
    // 工具执行耗时（tool.complete 事件携带，渲染于 ToolEntry 头部行）
    ...(phase === 'complete' && payload?.duration ? { duration: payload.duration } : {}),
  }

  if (index === -1) {
    return [...next, base]
  }

  next[index] = { ...next[index], ...base } as ChatMessagePart
  return next
}

// ── toChatMessages — convert backend SessionMessage[] → ChatMessage[] ──

/** Backend SessionMessage shape (from /api/session-messages endpoint) */
export interface SessionMessage {
  role: string
  content?: unknown
  text?: string
  context?: string
  name?: string
  timestamp?: number
  reasoning?: string
  reasoning_content?: string
  reasoning_details?: unknown
  tool_calls?: unknown[]
  tool_call_id?: string
  tool_name?: string
  /** 展示分类（对标 Hermes messages.display_kind）：
   *  async_delegation_complete / model_switch / auto_continue / hidden。
   *  role=user 的系统注入 bookkeeping 行，展示层降级/丢弃，不作为用户气泡。 */
  display_kind?: string
  /** 展示元数据（对标 Hermes display_metadata，如委派 task_count） */
  display_metadata?: unknown
  /** 🔴 2026-08-08 发送字节 sidecar（含多模态图片 wire parts）——历史恢复提取图片附件 */
  api_content?: unknown
}

/** 从后端 content / api_content 提取图片 data URL / URL（对齐 Hermes history 消息的
 *  image parts → attachmentRefs）。两种格式都处理：
 *  ① OpenAI wire 格式：{"type":"image_url","image_url":{"url":...}}
 *  ② ELEVE 枚举序列化：{"ImageUrl": "..."}
 *  本地模式后端 native 路由把图片读成 data URL（image_routing.rs file_to_data_url），
 *  恢复时可直接 <img> 渲染。 */
export function extractImageUrlsFromContent(content: unknown, max = 8): string[] {
  if (!Array.isArray(content)) return []
  const urls: string[] = []
  for (const item of content) {
    if (urls.length >= max) break
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    // ① OpenAI wire image part
    if (row.type === 'image_url') {
      const img = row.image_url as Record<string, unknown> | undefined
      if (typeof img?.url === 'string' && img.url) urls.push(img.url)
    } else if (row.type === 'input_image') {
      const url = row.image_url ?? row.url
      if (typeof url === 'string' && url) urls.push(url)
    } else {
      // ② ELEVE ContentPart 枚举序列化（externally tagged）：{"ImageUrl": "..."}
      const imgUrl = row.ImageUrl
      if (typeof imgUrl === 'string' && imgUrl) urls.push(imgUrl)
      // 嵌套 wire 形状兜底：{"ImageUrl": {"url": ...}}
      if (imgUrl && typeof imgUrl === 'object') {
        const u = (imgUrl as Record<string, unknown>).url
        if (typeof u === 'string' && u) urls.push(u)
      }
    }
  }
  return urls
}

function textFromUnknown(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (depth > 2) return ''
  if (Array.isArray(value)) return value.map((item) => textFromUnknown(item, depth + 1)).join('')
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>
    // 图片 part 不是文本——跳过（防止 JSON 噪音拼进用户气泡正文）
    if (row.type === 'image_url' || row.type === 'input_image' || 'ImageUrl' in row) return ''
    const textValue = row.text ?? row.output_text ?? row.content ?? row.message
    const nestedText = textFromUnknown(textValue, depth + 1)
    if (nestedText) return nestedText
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

function displayContentForMessage(role: string, content: unknown): string {
  const textContent = textFromUnknown(content)
  if (role !== 'user') return textContent

  const CONTEXT_MARKER_RE = /(?:^|\n)--- Attached Context ---\s*\n/
  const CONTEXT_WARNINGS_RE = /(?:^|\n)--- Context Warnings ---[\s\S]*$/
  const marker = textContent.match(CONTEXT_MARKER_RE)

  if (!marker || marker.index === undefined) {
    return textContent.replace(CONTEXT_WARNINGS_RE, '').trim()
  }

  const visibleText = textContent.slice(0, marker.index).replace(CONTEXT_WARNINGS_RE, '').trim()
  return visibleText || textContent.replace(CONTEXT_WARNINGS_RE, '').trim()
}

// ── display_kind timeline 处理（1:1 对标 Hermes desktop chat-messages.ts
// L341-396：hidden 丢弃，三类 bookkeeping 行降级为事件行）──

/** hidden 行仍 replay 给模型，但一切展示面丢弃（对标 transcriptContent） */
function transcriptContent(displayKind: string | undefined, content: string): string | null {
  return displayKind === 'hidden' ? null : content
}

/** 远端旧后端可能把 display_metadata 存为 JSON 文本，`in` 对原始值会抛——
 *  解析失败不能弄坏整个会话恢复（对标 Hermes parseDisplayMetadata） */
function parseDisplayMetadata(metadata: unknown): null | Record<string, unknown> {
  let parsed: unknown = metadata
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
}

function timelineTaskCount(metadata: unknown): number | undefined {
  const count = parseDisplayMetadata(metadata)?.task_count
  return typeof count === 'number' ? count : undefined
}

/** timeline 事件行的人类可读文案（对标 Hermes timelineDisplayContent，中文化） */
function timelineDisplayContent(message: SessionMessage, content: string): string {
  if (message.display_kind === 'model_switch') {
    return '模型已切换'
  }
  if (message.display_kind === 'auto_continue') {
    return '已继续中断的回复'
  }
  if (message.display_kind === 'async_delegation_complete') {
    const count = timelineTaskCount(message.display_metadata)
    return count === undefined
      ? '后台任务已完成'
      : count === 1
        ? '1 个后台任务已完成'
        : `${count} 个后台任务已完成`
  }
  return content
}

function toolPartFromStoredCall(call: unknown, fallbackIndex: number): ToolCallMessagePart {
  const row = recordFromUnknown(call) ?? {}
  const fn = recordFromUnknown(row.function)
  const id = String(row.id || row.tool_call_id || `stored-tool-${fallbackIndex}`)

  const toolName = String(
    row.name || row.tool_name || fn?.name || (recordFromUnknown(row.input)?.name as string | undefined) || 'tool',
  )

  const args = firstNonEmptyObject(fn?.arguments, row.arguments, row.args, row.input)

  return {
    type: 'tool-call',
    toolCallId: id,
    toolName,
    args,
    argsText: Object.keys(args).length ? JSON.stringify(args) : '',
  }
}

function storedToolMessagePart(toolMessage: SessionMessage, fallbackIndex: number): ToolCallMessagePart {
  const name = toolMessage.tool_name || toolMessage.name || 'tool'
  const context = textFromUnknown(toolMessage.context || toolMessage.text || toolMessage.content || '')
  const args = context ? { context } : {}

  return {
    type: 'tool-call',
    toolCallId: toolMessage.tool_call_id || `stored-tool-message-${fallbackIndex}`,
    toolName: name,
    args,
    argsText: Object.keys(args).length ? JSON.stringify(args) : '',
    result: context ? { context } : {},
    isError: false,
  }
}

function applyStoredToolResult(messages: ChatMessage[], toolMessage: SessionMessage): boolean {
  const toolCallId = toolMessage.tool_call_id || undefined
  const toolName = toolMessage.tool_name || toolMessage.name || 'tool'
  const content = toolMessage.content || toolMessage.text || toolMessage.context || toolMessage.name

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue

    const partIndex = message.parts.findIndex(
      (part) =>
        part.type === 'tool-call' &&
        ((toolCallId && part.toolCallId === toolCallId) || (!toolCallId && part.toolName === toolName)),
    )

    if (partIndex < 0) continue

    const parts = [...message.parts]
    const existing = parts[partIndex]
    parts[partIndex] = {
      ...existing,
      result: parseMaybeJsonObject(content),
      isError: false,
    } as ChatMessagePart
    messages[i] = { ...message, parts }

    return true
  }

  return false
}

function withUniqueToolCallIds(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>()

  return messages.map((message) => {
    let changed = false

    const parts = message.parts.map((part, index) => {
      if (part.type !== 'tool-call') return part

      const id = part.toolCallId || `${message.id}-tool-${index}`

      if (!seen.has(id)) {
        seen.add(id)
        if (part.toolCallId) return part
        changed = true
        return { ...part, toolCallId: id } as ChatMessagePart
      }

      changed = true
      const uniqueId = `${id}-${message.id}-${index}`
      seen.add(uniqueId)
      return { ...part, toolCallId: uniqueId } as ChatMessagePart
    })

    return changed ? { ...message, parts } : message
  })
}

export function toChatMessages(messages: SessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  let pendingToolParts: ToolCallMessagePart[] = []
  let pendingToolTimestamp: number | undefined
  let activeAssistantIndex: null | number = null

  const clearPendingTools = () => {
    pendingToolParts = []
    pendingToolTimestamp = undefined
  }

  const appendPartsToActiveAssistant = (parts: ChatMessagePart[], timestamp?: number): boolean => {
    if (activeAssistantIndex === null) return false

    const active = result[activeAssistantIndex]
    if (!active || active.role !== 'assistant') {
      activeAssistantIndex = null
      return false
    }

    // Mutation is intentional — we're building the result array in-place
    ;(active as { parts: ChatMessagePart[] }).parts = [...active.parts, ...parts]
    ;(active as { timestamp?: number }).timestamp = timestamp ?? active.timestamp

    return true
  }

  const flushPendingTools = (index: number) => {
    if (!pendingToolParts.length) return

    if (!appendPartsToActiveAssistant(pendingToolParts, pendingToolTimestamp)) {
      result.push({
        id: `${pendingToolTimestamp || Date.now()}-${index}-tools`,
        role: 'assistant',
        parts: pendingToolParts,
        timestamp: pendingToolTimestamp,
      })
      activeAssistantIndex = result.length - 1
    }

    clearPendingTools()
  }

  messages.forEach((message, index) => {
    if (message.role === 'tool') {
      // Try to match to existing pending tool part
      const updatedPending = [...pendingToolParts]
      const toolCallId = message.tool_call_id || undefined
      const toolName = message.tool_name || message.name || 'tool'
      const content = message.content || message.text || message.context || message.name

      const partIndex = updatedPending.findIndex(
        (p) =>
          (toolCallId && p.toolCallId === toolCallId) || (!toolCallId && p.toolName === toolName),
      )

      if (partIndex >= 0) {
        updatedPending[partIndex] = {
          ...updatedPending[partIndex],
          result: parseMaybeJsonObject(content),
          isError: false,
        }
        pendingToolParts = updatedPending
        return
      }

      // Try to match to existing assistant message
      if (applyStoredToolResult(result, message)) return

      // No match — create standalone tool part
      pendingToolParts = [...pendingToolParts, storedToolMessagePart(message, index)]
      pendingToolTimestamp ??= message.timestamp
      return
    }

    const content = message.content || message.text || message.context || message.name
    // 🔴 display_kind 管线（1:1 对标 Hermes desktop toChatMessages L982-989）：
    // hidden → 内容丢弃（行仍 replay 给模型）；model_switch / auto_continue /
    // async_delegation_complete → 降级为 system 事件行 + 人类可读摘要，
    // 绝不把系统注入的委派任务块重绘成用户气泡。
    const displayRole: MessageRole =
      message.display_kind === 'model_switch' ||
      message.display_kind === 'async_delegation_complete' ||
      message.display_kind === 'auto_continue'
        ? 'system'
        : (message.role as MessageRole)
    const displayContent = transcriptContent(
      message.display_kind,
      timelineDisplayContent(message, displayContentForMessage(message.role, content)),
    )
    // 🔴 2026-08-08 图片附件恢复：user 消息的多模态图片提取为 attachmentRefs
    // （对齐 Hermes history → attachmentRefs 渲染缩略图）。来源：
    //  ① content 列（ELEVE 枚举格式数组，如有）
    //  ② api_content sidecar（OpenAI wire 格式，含完整 image_url data URL——
    //     content 列仅存 msg.text() 纯文本，图片只保留在 sidecar）
    const imageRefs =
      message.role === 'user'
        ? [
            ...extractImageUrlsFromContent(content),
            ...extractImageUrlsFromContent(message.api_content),
          ].slice(0, 8)
        : []
    const parts: ChatMessagePart[] = []

    const reasoning =
      message.reasoning ||
      message.reasoning_content ||
      (typeof message.reasoning_details === 'string' ? message.reasoning_details : '')

    if (reasoning && message.role === 'assistant') {
      parts.push(reasoningPart(reasoning))
    }

    if (displayContent) {
      parts.push(textPart(displayContent))
    }

    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      parts.push(...message.tool_calls.map((call, callIndex) => toolPartFromStoredCall(call, callIndex)))
    }

    if (!parts.length && !(displayRole === 'user' && imageRefs.length > 0)) {
      if (displayRole !== 'assistant') {
        flushPendingTools(index)
        activeAssistantIndex = null
      }
      return
    }

    const isToolOnlyAssistant =
      message.role === 'assistant' && parts.length > 0 && parts.every((part) => part.type === 'tool-call')

    if (isToolOnlyAssistant) {
      pendingToolParts = [...pendingToolParts, ...(parts as ToolCallMessagePart[])]
      pendingToolTimestamp ??= message.timestamp
      return
    }

    if (displayRole === 'assistant') {
      if (pendingToolParts.length) {
        if (!appendPartsToActiveAssistant(pendingToolParts, message.timestamp ?? pendingToolTimestamp)) {
          parts.unshift(...pendingToolParts)
        }
        clearPendingTools()
      }

      const activeAssistant =
        activeAssistantIndex !== null && result[activeAssistantIndex]?.role === 'assistant'
          ? result[activeAssistantIndex]
          : null

      const currentHasToolCall = parts.some((part) => part.type === 'tool-call')
      const activeHasToolCall = Boolean(activeAssistant?.parts.some((part) => part.type === 'tool-call'))

      if (activeAssistant && (currentHasToolCall || activeHasToolCall)) {
        ;(activeAssistant as { parts: ChatMessagePart[] }).parts = [
          ...activeAssistant.parts,
          ...parts,
        ]
        ;(activeAssistant as { timestamp?: number }).timestamp =
          message.timestamp ?? activeAssistant.timestamp
        return
      }
    } else {
      flushPendingTools(index)
    }

    result.push({
      id: `${message.timestamp || Date.now()}-${index}-${displayRole}`,
      role: displayRole,
      parts,
      timestamp: message.timestamp ?? Date.now(),
      // 用户消息带图片附件（对齐 Hermes attachmentRefs）
      ...(displayRole === 'user' && imageRefs.length > 0 ? { attachmentRefs: imageRefs } : {}),
    })

    activeAssistantIndex = displayRole === 'assistant' ? result.length - 1 : null
  })

  flushPendingTools(messages.length)

  return withUniqueToolCallIds(
    result.filter(
      (m) =>
        m.parts.some((part) => part.type === 'text' && part.text.trim()) ||
        m.parts.some((part) => part.type !== 'text') ||
        (m.attachmentRefs?.length ?? 0) > 0,
    ),
  )
}

