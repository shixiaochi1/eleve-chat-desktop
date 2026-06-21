/**
 * Core type definitions — 1:1 alignment with Eleve store/session.ts
 *
 * These types describe the data structures flowing through the app.
 * They are derived from the actual runtime objects produced by the
 * SSE stream (useSSE → useMessageStream → messages store).
 */

import type {
  ChatMessagePart,
  TextMessagePart,
  ReasoningMessagePart,
  ToolCallMessagePart,
} from '@/lib/chat-messages'

// Re-export for convenience
export type { ChatMessagePart, TextMessagePart, ReasoningMessagePart, ToolCallMessagePart }

// ── Message types ──

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: MessageRole
  /** Parts-based content — 1:1 aligned with Eleve. Each assistant message
   *  contains reasoning/text/tool-call parts. User messages contain text parts. */
  parts: ChatMessagePart[]
  timestamp?: number
  pending?: boolean
  error?: string
  hidden?: boolean

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
  agentAttribution?: string
  resultStr?: string
}

// ── Message grouping (1:1 from Eleve buildGroups) ──

export interface StandaloneGroup {
  id: string
  index: number
  kind: 'standalone'
}

export interface TurnGroup {
  id: string
  indices: number[]
  kind: 'turn'
}

export type MessageGroup = StandaloneGroup | TurnGroup

// ── Signature row (internal to buildGroups) ──

export interface SignatureRow {
  id: string
  index: number
  role: MessageRole
}

// ── SSE event types (from gateway /stream endpoint) ──

export type SSEEventType = 'message' | 'reasoning' | 'tool_start' | 'tool_complete' | 'done' | 'error'

export interface SSEEvent {
  type: SSEEventType
  content?: string
  reasoning_content?: string
  tool_call_id?: string
  tool_name?: string
  tool_input?: string
  tool_output?: string
  message_id?: string
}

// ── Session types ──

export interface Session {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

// ── Store callback types ──

export type ListenerCallback = () => void
export type Unsubscribe = () => void
export type MessageUpdater = (prev: ChatMessage[]) => ChatMessage[]
export type MessagePatch = Partial<ChatMessage>
export type MessagePredicate = (m: ChatMessage) => MessagePatch | null
