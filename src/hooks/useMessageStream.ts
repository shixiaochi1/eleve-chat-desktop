import { useRef, useCallback, useEffect, type MutableRefObject } from 'react';
import { useSSE, type SSECallbacks } from './useSSE';
import * as storage from '../utils/storage';
import {
  setMessages as storeSetMessages,
  getMessages,
  updateMessage,
} from '../store/messages';
import {
  textPart,
  reasoningPart,
  upsertToolPart,
  appendTextPart,
  appendReasoningPart,
  replaceReasoningPart,
  type ChatMessagePart,
  type GatewayEventPayload,
} from '@/lib/chat-messages';
import type { ChatMessage } from '@/types';
import type { Session } from '@/types';

// ── Props type ──

export interface SessionManagerHandle {
  sessionId: string | null
  sessions: { id: string; title: string; created_at: string; updated_at: string; message_count?: number }[]
  msgCache: Record<string, ChatMessage[]>
  titles: Record<string, string>
  setSessionId: (id: string) => void
  saveCache: (updater: ((cache: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) | Record<string, ChatMessage[]>) => void
  saveTitles: (updater: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) => void
  refresh: () => void
  create: () => Promise<void>
  remove: (id: string) => Promise<void>
  switchTo: (id: string) => void
  setTitle: (id: string, text: string) => void
  getTitle: (s: Session) => string
  loadHistory: (id: string) => Promise<ChatMessage[] | null>
}

export interface DebugToolCall {
  name: string
  callId: string
  args: string
  result: string
  status: string
}

export interface UseMessageStreamProps {
  genId: () => string
  addDebugEvent: (type: string, detail: string) => void
  setConnectionStatus: React.Dispatch<React.SetStateAction<string>>
  setDebugInfo: React.Dispatch<React.SetStateAction<{ sessionId: string; tokensIn: number; tokensOut: number; lastSent: string; sessionStartedAt: number | null }>>
  setDebugToolCalls: React.Dispatch<React.SetStateAction<DebugToolCall[]>>
  setMonitorState: React.Dispatch<React.SetStateAction<{ modelName: string | null; delegateTasks: Record<string, unknown>; tokensIn?: number; tokensOut?: number; lastSent?: string; sessionStartedAt?: number | null }>>
  setActiveClarify: React.Dispatch<React.SetStateAction<{ clarify_id: string; question: string; choices: string[] } | null>>
  setActiveApproval: React.Dispatch<React.SetStateAction<{ command: string; description: string; pattern: string; choices: string[]; session_id: string } | null>>
  sess: SessionManagerHandle
  drainQueueRef: MutableRefObject<(() => void) | null>
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
}

/**
 * Queued deltas — same shape as Hermes QueuedStreamDeltas.
 * We accumulate *incremental deltas* here (not fullText), then flush
 * them into the store via mutateStream.
 */
interface QueuedStreamDeltas {
  assistant: string
  reasoning: string
}

// Minimum gap between two assistant-text flushes — same as Hermes (33ms).
const STREAM_DELTA_FLUSH_MS = 33

/**
 * useMessageStream — SSE streaming callbacks, aligned 1:1 with Hermes
 *
 * Key architecture (matching Hermes use-message-stream.ts):
 * 1. streamId — unique ID for each streaming turn, guarantees only ONE
 *    assistant message is ever created per response.
 *    [FIX #1] Lazy creation in mutateStream — if streamId is null when
 *    the first delta arrives, auto-allocate one (same as Hermes).
 * 2. mutateStream — single entry point for all message mutations.
 *    Checks streamId to decide: create new or update existing.
 * 3. queueDelta + flushQueuedDeltas — accumulates incremental deltas
 *    (not fullText), then flushes via mutateStream at ~30fps.
 *    [FIX #2] onText receives (delta, fullText) — queueDelta uses delta
 *    for incremental streaming; completeText uses fullText for final
 *    replacement (Hermes message.complete pattern).
 * 4. Tool events flush text deltas BEFORE upserting tool parts.
 * 5. completeAssistantMessage — on 'done', replaces text with the final
 *    full content and deduplicates reasoning, then clears streamId.
 *    [FIX #3] finalText comes from the accumulated fullText in SSE
 *    (not from message parts which may be stale).
 * 6. [FIX #4] reasoning.available triggers REPLACE (not append),
 *    same as Hermes appendReasoningDelta with replace=true.
 */
export function useMessageStream({
  genId,
  addDebugEvent,
  setConnectionStatus,
  setDebugInfo,
  setDebugToolCalls,
  setMonitorState,
  setActiveClarify,
  setActiveApproval,
  sess,
  drainQueueRef,
  setSessionListVersion,
}: UseMessageStreamProps): {
  isStreaming: boolean
  send: (text: string, sessionId?: string | null) => Promise<void>
  abort: () => Promise<void>
} {
  // ── Stream ID — same as Hermes: one unique ID per streaming turn ──
  // [FIX #1] Lazy creation: mutateStream auto-allocates if null
  const streamIdRef = useRef<string | null>(null)

  // ── Queued deltas — accumulated incremental deltas (Hermes pattern) ──
  const queuedDeltasRef = useRef<QueuedStreamDeltas>({ assistant: '', reasoning: '' })
  const flushHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlushAtRef = useRef<number>(0)

  // [FIX #3] Track the fullText accumulator from SSE — used by onDone
  // to get the final complete text (same as Hermes message.complete payload)
  const fullTextRef = useRef<string>('')

  const sseCallbacks = useRef<SSECallbacks>({});

  // ── Cleanup on unmount — flush any remaining deltas ──
  useEffect(() => {
    return () => {
      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current)
        flushHandleRef.current = null
      }
    }
  }, [])

  // ── mutateStream — 1:1 from Hermes mutateStream ──
  // Single entry point for all streaming message mutations.
  // Uses streamId to guarantee at most ONE assistant message per turn.
  // [FIX #1] Lazy streamId: if null, auto-allocate (same as Hermes).
  const mutateStream = useCallback(
    (
      transform: (parts: ChatMessagePart[], message: ChatMessage) => ChatMessagePart[],
      seed: () => ChatMessagePart[],
      opts: { pending?: (message: ChatMessage) => boolean } = {},
    ) => {
      // [FIX #1] Lazy creation — same as Hermes:
      // state.streamId ?? `assistant-stream-${Date.now()}`
      if (!streamIdRef.current) {
        streamIdRef.current = `assistant-stream-${Date.now()}`
      }
      const streamId = streamIdRef.current

      storeSetMessages((prev) => {
        if (prev.some(m => m.id === streamId)) {
          // Message exists — transform its parts
          return prev.map(m =>
            m.id === streamId
              ? {
                  ...m,
                  parts: transform(m.parts, m),
                  pending: opts.pending ? opts.pending(m) : true,
                }
              : m
          )
        }
        // Message doesn't exist yet — seed it with id = streamId
        return [
          ...prev,
          {
            id: streamId,
            role: 'assistant' as const,
            parts: seed(),
            pending: true,
          },
        ]
      })
    },
    [],
  )

  // ── flushQueuedDeltas — 1:1 from Hermes flushQueuedDeltas ──
  // Takes accumulated deltas from queue, applies them via mutateStream.
  // [FIX] 合并 text + reasoning 为一次 mutateStream 调用，避免双次 React re-render
  const flushQueuedDeltas = useCallback(() => {
    const queued = queuedDeltasRef.current
    queuedDeltasRef.current = { assistant: '', reasoning: '' }

    if (!queued.assistant && !queued.reasoning) return

    // 合并：一次 mutateStream 同时处理 text 和 reasoning
    mutateStream(
      (parts) => {
        let result = parts
        if (queued.reasoning) {
          result = appendReasoningPart(result, queued.reasoning)
        }
        if (queued.assistant) {
          result = appendTextPart(result, queued.assistant)
        }
        return result
      },
      () => {
        const seed: ChatMessagePart[] = []
        if (queued.reasoning) seed.push(reasoningPart(queued.reasoning))
        if (queued.assistant) seed.push(textPart(queued.assistant))
        return seed
      },
    )
  }, [mutateStream])

  // ── scheduleDeltaFlush — 1:1 from Hermes scheduleDeltaFlush ──
  const scheduleDeltaFlush = useCallback(() => {
    if (flushHandleRef.current !== null) return

    const sinceLast = performance.now() - lastFlushAtRef.current
    const runFlush = () => {
      flushHandleRef.current = null
      lastFlushAtRef.current = performance.now()
      flushQueuedDeltas()
    }

    if (sinceLast >= STREAM_DELTA_FLUSH_MS) {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        flushHandleRef.current = window.requestAnimationFrame(runFlush) as unknown as ReturnType<typeof setTimeout>
      } else {
        flushHandleRef.current = setTimeout(runFlush, 0)
      }
    } else {
      flushHandleRef.current = setTimeout(runFlush, Math.max(0, STREAM_DELTA_FLUSH_MS - sinceLast))
    }
  }, [flushQueuedDeltas])

  // ── queueDelta — 1:1 from Hermes queueDelta ──
  const queueDelta = useCallback(
    (key: keyof QueuedStreamDeltas, delta: string) => {
      if (!delta) return
      queuedDeltasRef.current[key] += delta
      scheduleDeltaFlush()
    },
    [scheduleDeltaFlush],
  )

  // ── upsertToolCall — 1:1 from Hermes upsertToolCall ──
  const upsertToolCall = useCallback(
    (payload: GatewayEventPayload | undefined, phase: 'running' | 'complete') => {
      mutateStream(
        parts => upsertToolPart(parts, payload, phase),
        () => upsertToolPart([], payload, phase),
        { pending: m => phase !== 'complete' || (m.pending ?? false) }
      )
    },
    [mutateStream],
  )

  // ── completeAssistantMessage — 1:1 from Hermes completeAssistantMessage ──
  // On stream end, replace text with final content and deduplicate reasoning.
  // [FIX #3] finalText comes from SSE fullText accumulator (not message parts)
  const completeAssistantMessage = useCallback(
    (finalText: string) => {
      const streamId = streamIdRef.current
      streamIdRef.current = null // Clear streamId — turn is over
      fullTextRef.current = '' // Reset fullText accumulator

      const normalizedFinal = finalText.replace(/\s+/g, ' ').trim()

      storeSetMessages((prev) => {
        if (streamId && prev.some(m => m.id === streamId)) {
          // Found our streaming message — finalize it
          return prev.map(m => {
            if (m.id !== streamId) return m

            // Deduplicate reasoning if finalText contains it
            const kept = m.parts.filter(part => {
              if (part.type === 'text') return false // Remove streamed text — will be replaced
              if (part.type === 'reasoning' && normalizedFinal) {
                const r = part.text.replace(/\s+/g, ' ').trim()
                // If reasoning is a prefix of the final text (or vice versa), drop it
                if (r && (normalizedFinal.startsWith(r) || r.startsWith(normalizedFinal))) {
                  return false
                }
              }
              return true
            })

            return {
              ...m,
              parts: finalText ? [...kept, textPart(finalText)] : kept,
              pending: false,
            }
          })
        }

        // Fallback: find the last pending assistant message
        const fallbackIndex = [...prev]
          .reverse()
          .findIndex(m => m.role === 'assistant' && m.pending)

        if (fallbackIndex >= 0) {
          const index = prev.length - 1 - fallbackIndex
          return prev.map((m, i) => {
            if (i !== index) return m
            const kept = m.parts.filter(part => {
              if (part.type === 'text') return false
              if (part.type === 'reasoning' && normalizedFinal) {
                const r = part.text.replace(/\s+/g, ' ').trim()
                if (r && (normalizedFinal.startsWith(r) || r.startsWith(normalizedFinal))) {
                  return false
                }
              }
              return true
            })
            return {
              ...m,
              parts: finalText ? [...kept, textPart(finalText)] : kept,
              pending: false,
            }
          })
        }

        // No pending message — create a completed one
        if (finalText) {
          return [...prev, { id: genId(), role: 'assistant' as const, parts: [textPart(finalText)], pending: false }]
        }
        return prev
      })
    },
    [genId],
  )

  // ── SSE streaming callbacks — aligned with Hermes handleGatewayEvent ──
  sseCallbacks.current = {
    // ── Text delta — 1:1 with Hermes message.delta ──
    // queueDelta uses the INCREMENTAL delta (not fullText).
    // fullText is tracked in fullTextRef for onDone final replacement.
    onText: (delta: string, fullText: string) => {
      fullTextRef.current = fullText // [FIX #3] Track for onDone
      queueDelta('assistant', delta)
    },

    // ── Reasoning delta — 1:1 with Hermes reasoning.delta ──
    onReasoning: (delta: string, _fullText: string) => {
      queueDelta('reasoning', delta)
    },

    // [FIX #4] Reasoning replace — 1:1 with Hermes appendReasoningDelta(replace=true).
    // reasoning.available sends the COMPLETE reasoning text, not a delta.
    // Must flush first, then replace the reasoning part content.
    // 对齐 Hermes: replace 模式下，filter 掉所有旧 reasoning parts 再添加新的
    onReasoningReplace: (fullText: string) => {
      flushQueuedDeltas()
      mutateStream(
        (parts) => {
          // 对齐 Hermes L394-396: [...parts.filter(p => p.type !== 'reasoning'), reasoningPart(delta)]
          return [...parts.filter(p => p.type !== 'reasoning'), reasoningPart(fullText)]
        },
        () => [reasoningPart(fullText)],
      )
    },

    // ── Tool start — 1:1 with Hermes tool.start ──
    // KEY: flush queued text/reasoning BEFORE upserting tool part.
    onToolStart: ({ id, name }: { id: string | null; name: string }) => {
      addDebugEvent('tool_start', `${name} (${id?.slice(0, 8)})`);
      setDebugToolCalls((prev) => [...prev, { name, callId: id || '', args: '', result: '', status: 'pending' }]);
      flushQueuedDeltas()
      const toolPayload: GatewayEventPayload = { tool_call_id: id || '', name };
      upsertToolCall(toolPayload, 'running');
    },

    onToolArgs: ({ id, accumulated }: { id: string; delta?: string; accumulated: string }) => {
      setDebugToolCalls((prev) => prev.map((t) => t.callId === id ? { ...t, args: accumulated } : t));
      flushQueuedDeltas()
      let parsedArgs: Record<string, unknown> = {};
      try {
        if (accumulated && accumulated.trim()) {
          parsedArgs = JSON.parse(accumulated);
        }
      } catch { /* ignore parse errors for partial streaming args */ }
      const toolPayload: GatewayEventPayload = { tool_call_id: id, args: parsedArgs };
      upsertToolCall(toolPayload, 'running');
    },

    // ── Tool end — 1:1 with Hermes tool.complete ──
    onToolEnd: ({ id, name }: { id: string | null; name: string }) => {
      addDebugEvent('tool_end', `${name || 'tool'} (${id?.slice(0, 8)})`);
      setDebugToolCalls((prev) => prev.map((t) => t.callId === id ? { ...t, status: 'done' } : t));
      flushQueuedDeltas()
      const toolPayload: GatewayEventPayload = { tool_call_id: id || '', name };
      upsertToolCall(toolPayload, 'complete');
    },

    onUsage: ({ input, output }: { input: number; output: number }) => {
      addDebugEvent('usage', `↑${input} ↓${output}`);
      setDebugInfo((prev) => ({ ...prev, tokensIn: (prev.tokensIn as number || 0) + input, tokensOut: (prev.tokensOut as number || 0) + output }));
      setMonitorState((prev) => ({ ...prev, tokensIn: (prev.tokensIn as number || 0) + input, tokensOut: (prev.tokensOut as number || 0) + output }));
      const streamId = streamIdRef.current
      if (streamId) {
        updateMessage(streamId, { inputTokens: input, outputTokens: output })
      }
    },

    onModelName: (name: string) => {
      addDebugEvent('model', name);
      setMonitorState((prev) => ({ ...prev, modelName: name }));
    },

    onRunStart: (sessionId: string) => {
      if (sessionId && sessionId !== sess.sessionId) {
        addDebugEvent('run_start', `new session: ${sessionId?.slice(0, 8)}`);
        if (sess.sessionId && getMessages()?.length) {
          sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: getMessages() }));
        }
        sess.setSessionId(sessionId);
        storage.save('session_id', sessionId);
        setDebugInfo((prev) => ({ ...prev, sessionId, sessionStartedAt: Date.now() }));
        if (setSessionListVersion) setSessionListVersion(v => v + 1);
      }
      // Allocate streamId — if already set by lazy creation, keep it
      if (!streamIdRef.current) {
        streamIdRef.current = `assistant-stream-${Date.now()}`
      }
    },

    onDelegateStart: ({ taskId, goal, model }: { taskId: string; goal?: string; model?: string }) => {
      addDebugEvent('delegate', `start: ${goal?.slice(0, 50)}`);
      setMonitorState((prev) => ({
        ...prev,
        delegateTasks: { ...((prev.delegateTasks as Record<string, unknown>) || {}), [taskId]: { id: taskId, goal, model, status: 'running', startTs: Date.now() } },
      }));
    },

    onDelegateEnd: ({ taskId, status, summary, model, tokensInput, tokensOutput, duration }: { taskId: string; status?: string; summary?: string; model?: string; tokensInput?: number; tokensOutput?: number; duration?: number }) => {
      setMonitorState((prev) => {
        const next = { ...((prev.delegateTasks as Record<string, unknown>) || {}) };
        if (next[taskId]) {
          next[taskId] = { ...(next[taskId] as Record<string, unknown>), status, summary, tokensInput, tokensOutput, duration };
        }
        return { ...prev, delegateTasks: next };
      });
    },

    onClarify: ({ clarify_id, question, choices }: { clarify_id: string; question: string; choices?: string[] }) => {
      addDebugEvent('clarify', question.slice(0, 60));
      setActiveClarify({ clarify_id, question, choices: choices ?? [] });
    },

    onApproval: (data: unknown) => {
      const d = data as { command?: string };
      addDebugEvent('approval', (d.command?.slice(0, 60)) ?? '');
      setActiveApproval(data as any);
    },

    // ── Done — 1:1 with Hermes message.complete ──
    // Flush remaining deltas, then finalize with the FULL accumulated text.
    // [FIX #3] Use fullTextRef (from SSE accumulator) instead of reading
    // from message parts — parts may be stale if flush hadn't run.
    onDone: (newSessionId: string | null) => {
      addDebugEvent('done', newSessionId ? `new session: ${newSessionId?.slice(0, 8)}` : 'complete');

      // Cancel any pending flush timer
      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current)
        flushHandleRef.current = null
      }

      // Flush any remaining queued deltas
      flushQueuedDeltas()

      // [FIX #3] Use the fullText from SSE accumulator — this is the
      // complete text the backend sent, not a partial from message parts.
      // Same as Hermes: completeAssistantMessage(sessionId, coerceGatewayText(payload?.text))
      const finalText = fullTextRef.current

      // Complete: replace streamed text with final, dedup reasoning, clear pending
      completeAssistantMessage(finalText)

      setConnectionStatus('idle');

      const currentSessionId = sess.sessionId;
      const effectiveId = newSessionId || currentSessionId;
      if (effectiveId && getMessages()?.length) {
        sess.saveCache((cache) => ({ ...cache, [effectiveId]: getMessages() }));
      }

      if (drainQueueRef.current) drainQueueRef.current();

      if (newSessionId && newSessionId !== currentSessionId) {
        if (currentSessionId && getMessages()?.length) {
          sess.saveCache((cache) => ({ ...cache, [currentSessionId]: getMessages() }));
        }
        setTimeout(() => {
          sess.setSessionId(newSessionId);
          storage.save('session_id', newSessionId);
          sess.refresh();
          if (setSessionListVersion) setSessionListVersion(v => v + 1);
          setDebugInfo((prev) => ({ ...prev, sessionId: newSessionId }));
        }, 0);
      }
    },

    onError: (msg: string) => {
      addDebugEvent('error', msg);
      const errorStreamId = streamIdRef.current || `assistant-error-${Date.now()}`
      streamIdRef.current = null
      fullTextRef.current = ''
      if (getMessages().some(m => m.id === errorStreamId)) {
        updateMessage(errorStreamId, { error: msg, pending: false })
      } else {
        storeSetMessages((prev) => [...prev, { id: genId(), role: 'assistant', parts: [textPart(msg)], error: msg } as ChatMessage]);
      }
      setConnectionStatus('error');
      import('../utils/notifications').then(({ notifyError }) => {
        notifyError(msg, 'Agent 错误');
      });
      if (drainQueueRef.current) drainQueueRef.current();
      setTimeout(() => setConnectionStatus((s) => (s === 'error' ? 'idle' : s)), 3000);
    },
  } satisfies SSECallbacks;

  const { isStreaming, send, abort } = useSSE(sseCallbacks.current);

  return {
    isStreaming,
    send,
    abort,
  };
}
