/**
 * Messages atomic store — 1:1 alignment with Hermes store/session.ts
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
 * Full replacement of messages array (1:1 with Hermes setMessages)
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
 * Scoped message subscription — 1:1 architectural alignment with Hermes.
 * Only re-renders when THIS specific message changes.
 */
export function useMessage(index: number): ChatMessage | null {
  const getMsg = useCallback(() => messages[index] ?? null, [index])
  return useSyncExternalStore(subscribe, getMsg, getMsg)
}

// ── Message signature — 1:1 from Hermes messageSignature ──
// Only changes when message structure (id/type/count) changes.
// Streaming content updates do NOT change the signature.
// This drives buildGroups → virtualizer count/keys stay stable during streaming.

let _sigMessages: ChatMessage[] | null = null
let _sigCache = ''

function computeSignature(): string {
  // Same messages reference → same signature (no recomputation)
  if (messages === _sigMessages) return _sigCache
  const sig = messages.map((m, i) => `${i}:${m.id}:${m.role}`).join('\n')
  // Only update cache if signature content actually changed
  if (sig !== _sigCache) {
    _sigCache = sig
  }
  _sigMessages = messages
  return _sigCache
}

export function getSignatureSnapshot(): string {
  return computeSignature()
}

/**
 * 1:1 from Hermes: useAuiState(s =>
 *   s.thread.messages.map((m, i) => `${i}:${m.id}:${m.role}`).join('\n')
 * )
 * Returns a string that only changes when message structure changes.
 * Streaming content updates do NOT trigger re-render through this hook.
 */
export function useMessageSignature(): string {
  return useSyncExternalStore(subscribe, getSignatureSnapshot, getSignatureSnapshot)
}
