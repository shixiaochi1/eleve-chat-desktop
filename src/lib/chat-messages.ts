/**
 * chat-messages.ts — Message data model aligned 1:1 with Hermes
 *
 * Core types and utilities for the parts-based message architecture.
 * Hermes uses assistant-ui's ThreadMessageLike under the hood;
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
}

export interface ToolCallMessagePart {
  readonly type: 'tool-call'
  readonly toolCallId: string
  readonly toolName: string
  readonly args: Record<string, unknown>
  readonly argsText: string
  readonly result?: unknown
  readonly isError?: boolean
}

/** Union of all part types an assistant message can contain */
export type ChatMessagePart = TextMessagePart | ReasoningMessagePart | ToolCallMessagePart

/** Union of part types a user message can contain */
export interface UserTextPart {
  readonly type: 'text'
  readonly text: string
}

// ── ChatMessage — the top-level message type ──

export interface ChatMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly parts: ChatMessagePart[]
  readonly timestamp?: number
  readonly pending?: boolean
  readonly error?: string
  readonly hidden?: boolean
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

  next.push(textPart(delta))
  return next
}

/**
 * Replace the content of the last text part with fullText (not append).
 * Used by flushThrottled which stores fullText, not incremental deltas.
 */
export function replaceTextPart(parts: ChatMessagePart[], fullText: string): ChatMessagePart[] {
  const next = [...parts]
  const last = next.at(-1)

  if (last?.type === 'text') {
    next[next.length - 1] = { ...last, text: fullText }
    return next
  }

  next.push(textPart(fullText))
  return next
}

export function appendReasoningPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  // 对齐 Hermes: reasoning 永远只有一个 part
  // 找到现有的 reasoning part 并追加，而非只在 last 是 reasoning 时追加
  const reasoningIdx = parts.findIndex(p => p.type === 'reasoning')
  if (reasoningIdx >= 0) {
    const next = [...parts]
    const existing = next[reasoningIdx] as { type: 'reasoning'; text: string }
    next[reasoningIdx] = { ...existing, text: `${existing.text}${delta}` }
    return next
  }

  // 没有 reasoning part — 创建新的
  const next = [...parts]
  next.push(reasoningPart(delta))
  return next
}

/**
 * Replace the content of the last reasoning part with fullText (not append).
 * Used by flushThrottled which stores fullText, not incremental deltas.
 */
export function replaceReasoningPart(parts: ChatMessagePart[], fullText: string): ChatMessagePart[] {
  // 对齐 Hermes: 先过滤掉所有 reasoning parts，再 push 新的
  // 确保数组中永远只有 1 个 reasoning part，避免气泡分裂
  const filtered: ChatMessagePart[] = parts.filter(part => part.type !== 'reasoning')
  filtered.push(reasoningPart(fullText))
  return filtered
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
}

function textFromUnknown(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (depth > 2) return ''
  if (Array.isArray(value)) return value.map((item) => textFromUnknown(item, depth + 1)).join('')
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>
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
    const displayContent = displayContentForMessage(message.role, content)
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

    if (!parts.length) {
      if (message.role !== 'assistant') {
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

    if (message.role === 'assistant') {
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
      id: `${message.timestamp || Date.now()}-${index}-${message.role}`,
      role: message.role as 'user' | 'assistant',
      parts,
      timestamp: message.timestamp,
    })

    activeAssistantIndex = message.role === 'assistant' ? result.length - 1 : null
  })

  flushPendingTools(messages.length)

  return withUniqueToolCallIds(
    result.filter(
      (m) =>
        m.parts.some((part) => part.type === 'text' && part.text.trim()) ||
        m.parts.some((part) => part.type !== 'text'),
    ),
  )
}

// ── Utility: extract text content from a ChatMessage ──

export function chatMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part): part is TextMessagePart => part.type === 'text')
    .map((part) => part.text)
    .join('')
}
