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
  ChatMessage,
  MessageRole,
} from '@/lib/chat-messages'

// 3.5: ChatMessage / MessageRole 单一权威源在 lib/chat-messages.ts
export type { ChatMessagePart, TextMessagePart, ReasoningMessagePart, ToolCallMessagePart, ChatMessage, MessageRole }

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
