/**
 * Messages atomic store — 1:1 alignment with Eleve store/session.ts
 *
 * Key design:
 * - RAF batch flush: same-frame updates coalesce into one React render
 * - getSnapshot returns the same reference until flushed (useSyncExternalStore optimization)
 * - updateMessage(id, patch) for incremental updates — only creates a new
 *   object for the changed message, preserving references for all others
 * - isStreaming is a standalone atom — useSSE writes, MessageContainer reads
 *     without going through App props (prevents parent re-render cascade)
 */

import { useCallback, useSyncExternalStore } from 'react'
import type {
  ChatMessage,
  ListenerCallback,
  Unsubscribe,
  MessageUpdater,
  MessagePatch,
  MessagePredicate,
} from '@/types'

// ── Internal state ──
let messages: ChatMessage[] = []
let listeners = new Set<ListenerCallback>()
let pendingFlush = false
let flushedSnapshot: ChatMessage[] = [] // stable reference returned to React between flushes

// ── isStreaming standalone atom ──
// Written by useSSE, read by MessageContainer via useIsStreaming().
// This breaks the App → MessageContainer re-render cascade that caused scroll hijacking.
let _isStreaming = false
let _isStreamingListeners = new Set<ListenerCallback>()

export function setIsStreaming(value: boolean): void {
  if (_isStreaming === value) return
  _isStreaming = value
  _isStreamingListeners.forEach(cb => cb())
}

function getIsStreamingSnapshot(): boolean {
  return _isStreaming
}

function subscribeIsStreaming(cb: ListenerCallback): Unsubscribe {
  _isStreamingListeners.add(cb)
  return () => { _isStreamingListeners.delete(cb) }
}

export function useIsStreaming(): boolean {
  return useSyncExternalStore(subscribeIsStreaming, getIsStreamingSnapshot, getIsStreamingSnapshot)
}

function scheduleFlush(): void {
  if (pendingFlush) return
  pendingFlush = true
  requestAnimationFrame(() => {
    pendingFlush = false
    // Snapshot the current array — same reference until next flush
    flushedSnapshot = messages
    listeners.forEach(cb => cb())
  })
}

// ── Public API ──

/**
 * Subscribe to message changes (for useSyncExternalStore)
 */
export function subscribe(cb: ListenerCallback): Unsubscribe {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * Get current snapshot — returns a stable reference between flushes
 * so useSyncExternalStore skips unnecessary re-renders
 */
export function getSnapshot(): ChatMessage[] {
  // If no pending flush, return the last flushed snapshot
  // (same reference = no re-render)
  if (!pendingFlush && flushedSnapshot === messages) {
    return flushedSnapshot
  }
  // During pending flush, return current state
  // (useSyncExternalStore will re-check after flush)
  return messages
}

/**
 * Get server snapshot (SSR fallback — same as client)
 */
export function getServerSnapshot(): ChatMessage[] {
  return messages
}

/**
 * Synchronous read of current messages (replaces messagesRef.current)
 */
export function getMessages(): ChatMessage[] {
  return messages
}

/**
 * Full replacement of messages array (1:1 with Eleve setMessages)
 * Accepts either a new array or an updater function.
 */
export function setMessages(next: ChatMessage[] | MessageUpdater): void {
  const prev = messages
  messages = typeof next === 'function' ? (next as MessageUpdater)(prev) : next
  if (messages !== prev) {
    scheduleFlush()
  }
}

/**
 * Incremental update: only create a new object for the message with
 * matching id, preserving all other message references.
 *
 * This is the key optimization: virtualizer's getItemKey matches by group.id
 * (which is message.id), so unchanged groups skip re-measurement entirely.
 *
 * Returns true if the message was found and updated.
 */
export function updateMessage(id: string, patch: MessagePatch): boolean {
  let found = false
  const next = messages.map(m => {
    if (m.id === id) {
      found = true
      return { ...m, ...patch }
    }
    return m
  })
  if (found) {
    messages = next
    scheduleFlush()
  }
  return found
}

/**
 * Append a single message to the end (optimization: avoids full array copy
 * via setMessages(prev => [...prev, msg]))
 */
export function appendMessage(msg: ChatMessage): void {
  messages = [...messages, msg]
  scheduleFlush()
}

/**
 * Map over messages and update those where predicate returns a patch.
 * Used for bulk operations like clearing _streaming flags.
 *
 * Preserves references for messages where predicate returns null.
 */
export function updateMessagesWhere(predicate: MessagePredicate): void {
  let changed = false
  const next = messages.map(m => {
    const patch = predicate(m)
    if (patch) {
      changed = true
      return { ...m, ...patch }
    }
    return m
  })
  if (changed) {
    messages = next
    scheduleFlush()
  }
}

/**
 * React hook — 1:1 replacement for useState([]) messages
 */
export function useMessages(): ChatMessage[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Count-only subscription — App 根组件用此替代 useMessages()。
 * 只在消息数量变化时重渲染（新增/删除），流式内容增长（parts 增长）不触发。
 * 消灭 App 根 30fps 重渲染（性能根因 B1）。
 */
function getCountSnapshot(): number {
  return messages.length
}
export function useMessageCount(): number {
  return useSyncExternalStore(subscribe, getCountSnapshot, getCountSnapshot)
}

/**
 * Scoped message subscription — 1:1 architectural alignment with Eleve.
 * Only re-renders when THIS specific message changes.
 */
export function useMessage(index: number): ChatMessage | null {
  const getMsg = useCallback(() => messages[index] ?? null, [index])
  return useSyncExternalStore(subscribe, getMsg, getMsg)
}

// ── Message signature — 1:1 from Eleve messageSignature ──
// Only changes when message structure (id/type/count) changes.
// Streaming content updates do NOT change the signature.
// This drives buildGroups → virtualizer count/keys stay stable during streaming.

let _sigMessages: ChatMessage[] | null = null
let _sigCache = ''
let _sigQuickKey = ''

function computeSignature(): string {
  // Same messages reference → same signature (no recomputation)
  if (messages === _sigMessages) return _sigCache
  // 🔴 P2-2: O(1) 快速通道 — 流式 30fps flush 每帧产生新 messages 引用（mutateStream），
  // 但结构不变（同一条流式消息 parts 增长）。快查（数量+首尾 id）不变时跳过全量 map+join，
  // 长会话（数百条）下消灭每帧 O(n) 字符串构建。结构变化（增/删消息）快查必变 → 回退全量重算。
  const lastMsg = messages.length ? messages[messages.length - 1] : null
  const quickKey = `${messages.length}:${messages[0]?.id ?? ''}:${lastMsg?.id ?? ''}`
  if (quickKey === _sigQuickKey && _sigCache) {
    _sigMessages = messages
    return _sigCache
  }
  const sig = messages.map((m, i) => `${i}:${m.id}:${m.role}`).join('\n')
  // Only update cache if signature content actually changed
  if (sig !== _sigCache) {
    _sigCache = sig
  }
  _sigQuickKey = quickKey
  _sigMessages = messages
  return _sigCache
}

export function getSignatureSnapshot(): string {
  return computeSignature()
}

/**
 * 1:1 from Eleve: useAuiState(s =>
 *   s.thread.messages.map((m, i) => `${i}:${m.id}:${m.role}`).join('\n')
 * )
 * Returns a string that only changes when message structure changes.
 * Streaming content updates do NOT trigger re-render through this hook.
 */
export function useMessageSignature(): string {
  return useSyncExternalStore(subscribe, getSignatureSnapshot, getSignatureSnapshot)
}
