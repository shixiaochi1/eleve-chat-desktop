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

// ── Session types ──
// 🔴 P2-8: 消灭平行类型。Session = SessionInfo（后端真实形状，单一来源 eleve.ts）
export type { SessionInfo as Session } from './eleve';

// ── Store callback types ──

export type ListenerCallback = () => void
export type Unsubscribe = () => void
export type MessageUpdater = (prev: ChatMessage[]) => ChatMessage[]
export type MessagePatch = Partial<ChatMessage>
export type MessagePredicate = (m: ChatMessage) => MessagePatch | null
