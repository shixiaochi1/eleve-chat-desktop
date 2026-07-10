import { useRef, useCallback, useEffect, type MutableRefObject } from 'react';
import { useSSE, type SSECallbacks } from './useSSE';
import * as storage from '../utils/storage';
import { closeAgentTerminalByProc } from '@/store/terminals';
import {
  setMessages as storeSetMessages,
  getMessages,
  updateMessage,
  setIsStreaming as storeSetIsStreaming,
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
  freshDraftReady: boolean
  setFreshDraftReady: React.Dispatch<React.SetStateAction<boolean>>
  pendingTitle: string | null
  setPendingTitle: React.Dispatch<React.SetStateAction<string | null>>
  setSessionId: (id: string | null) => void
  saveCache: (updater: ((cache: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) | Record<string, ChatMessage[]>) => void
  saveTitles: (updater: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) => void
  refresh: () => void
  create: () => Promise<void>
  reset: () => Promise<void>
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
  setMonitorState: React.Dispatch<React.SetStateAction<{ modelName: string | null; delegateTasks: Record<string, unknown>; tokensIn?: number; tokensOut?: number; lastSent?: string; sessionStartedAt?: number | null; statusText?: string }>>
  setActiveClarify: React.Dispatch<React.SetStateAction<{ clarify_id: string; question: string; choices: string[] } | null>>
  setActiveApproval: React.Dispatch<React.SetStateAction<{ command: string; description: string; pattern: string; choices: string[]; run_id: string } | null>>
  setActiveSudo?: React.Dispatch<React.SetStateAction<{ request_id: string; prompt?: string } | null>>
  setActiveSecret?: React.Dispatch<React.SetStateAction<{ request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> } | null>>
  sess: SessionManagerHandle
  drainQueueRef: MutableRefObject<(() => void) | null>
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
}

/**
 * Queued deltas — same shape as Eleve QueuedStreamDeltas.
 * We accumulate *incremental deltas* here (not fullText), then flush
 * them into the store via mutateStream.
 */
interface QueuedStreamDeltas {
  assistant: string
  reasoning: string
}

// Minimum gap between two assistant-text flushes — same as Eleve (33ms).
const STREAM_DELTA_FLUSH_MS = 33

/**
 * useMessageStream — SSE streaming callbacks, aligned 1:1 with Eleve
 *
 * Key architecture (matching Eleve use-message-stream.ts):
 * 1. streamId — unique ID for each streaming turn, guarantees only ONE
 *    assistant message is ever created per response.
 *    [FIX #1] Lazy creation in mutateStream — if streamId is null when
 *    the first delta arrives, auto-allocate one (same as Eleve).
 * 2. mutateStream — single entry point for all message mutations.
 *    Checks streamId to decide: create new or update existing.
 * 3. queueDelta + flushQueuedDeltas — accumulates incremental deltas
 *    (not fullText), then flushes via mutateStream at ~30fps.
 *    [FIX #2] onText receives (delta, fullText) — queueDelta uses delta
 *    for incremental streaming; completeText uses fullText for final
 *    replacement (Eleve message.complete pattern).
 * 4. Tool events flush text deltas BEFORE upserting tool parts.
 * 5. completeAssistantMessage — on 'done', replaces text with the final
 *    full content and deduplicates reasoning, then clears streamId.
 *    [FIX #3] finalText comes from the accumulated fullText in SSE
 *    (not from message parts which may be stale).
 * 6. [FIX #4] reasoning.available triggers start (creates empty reasoning part),
 *    same as Eleve appendReasoningDelta with replace=true.
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
  setActiveSudo,
  setActiveSecret,
  sess,
  drainQueueRef,
  setSessionListVersion,
}: UseMessageStreamProps): {
  isStreaming: boolean
  send: (text: string, sessionId?: string | null) => Promise<void>
  abort: () => Promise<void>
} {
  // ── Stream ID — same as Eleve: one unique ID per streaming turn ──
  // [FIX #1] Lazy creation: mutateStream auto-allocates if null
  const streamIdRef = useRef<string | null>(null)

  // ── Queued deltas — accumulated incremental deltas (Eleve pattern) ──
  const queuedDeltasRef = useRef<QueuedStreamDeltas>({ assistant: '', reasoning: '' })
  const flushHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlushAtRef = useRef<number>(0)

  // [FIX #3] Track the fullText accumulator from SSE — used by onDone
  // to get the final complete text (same as Eleve message.complete payload)
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

  // ── mutateStream — 1:1 from Eleve mutateStream ──
  // Single entry point for all streaming message mutations.
  // Uses streamId to guarantee at most ONE assistant message per turn.
  // [FIX #1] Lazy streamId: if null, auto-allocate (same as Eleve).
  const mutateStream = useCallback(
    (
      transform: (parts: ChatMessagePart[], message: ChatMessage) => ChatMessagePart[],
      seed: () => ChatMessagePart[],
      opts: { pending?: (message: ChatMessage) => boolean } = {},
    ) => {
      // [FIX #1] Lazy creation — same as Eleve:
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

  // ── flushQueuedDeltas — 1:1 from Eleve flushQueuedDeltas ──
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

  // ── scheduleDeltaFlush — 1:1 from Eleve scheduleDeltaFlush ──
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

  // ── queueDelta — 1:1 from Eleve queueDelta ──
  const queueDelta = useCallback(
    (key: keyof QueuedStreamDeltas, delta: string) => {
      if (!delta) return
      queuedDeltasRef.current[key] += delta
      scheduleDeltaFlush()
    },
    [scheduleDeltaFlush],
  )

  // ── upsertToolCall — 1:1 from Eleve upsertToolCall ──
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

  // ── completeAssistantMessage — 1:1 from Eleve completeAssistantMessage ──
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

  // ── SSE streaming callbacks — aligned with Eleve handleGatewayEvent ──
  sseCallbacks.current = {
    // ── Text delta — 1:1 with Eleve message.delta ──
    // queueDelta uses the INCREMENTAL delta (not fullText).
    // fullText is tracked in fullTextRef for onDone final replacement.
    onText: (delta: string, fullText: string) => {
      fullTextRef.current = fullText // [FIX #3] Track for onDone
      queueDelta('assistant', delta)
    },

    // ── Reasoning delta — 1:1 with Eleve reasoning.delta ──
    onReasoning: (delta: string, _fullText: string) => {
      queueDelta('reasoning', delta)
    },

    // [FIX #4] Reasoning replace — 1:1 with Eleve appendReasoningDelta(replace=true).
    // reasoning.available = 推理开始通知（拆变体后不带文本）
    // Must flush first, then replace the reasoning part content.
    // 对齐 Eleve: replace 模式下，filter 掉所有旧 reasoning parts 再添加新的
    onReasoningStart: () => {
      // ReasoningStart → 创建空推理 part 占位，后续 delta 会追加内容
      flushQueuedDeltas()
      mutateStream(
        (parts, message) => {
          // 如果已有推理 part，不重复创建
          if (parts.some(p => p.type === 'reasoning')) return parts
          // 如果已有文本内容，跳过（reasoning 已展示过了）
          const hasText = message.parts
            .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
            .some(p => p.text.trim())
          if (hasText) return parts
          return [...parts, reasoningPart('')]
        },
        () => [reasoningPart('')],
      )
    },
    // ── Tool start — 1:1 with Eleve tool.start ──
    // KEY: flush queued text/reasoning BEFORE upserting tool part.
    onToolStart: ({ id, name, preview }: { id: string | null; name: string; preview?: string }) => {
      addDebugEvent('tool_start', `${name} (${id?.slice(0, 8)})${preview ? ` - ${preview}` : ''}`);
      setDebugToolCalls((prev) => [...prev, { name, callId: id || '', args: '', result: '', status: 'pending' }]);
      flushQueuedDeltas()
      const toolPayload: GatewayEventPayload = { tool_call_id: id || '', name, preview };
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

    // ── Tool end — 1:1 with Eleve tool.complete ──
    onToolEnd: ({ id, name, duration, error }: { id: string | null; name: string; duration?: number; error?: boolean }) => {
      addDebugEvent('tool_complete', `${name || 'tool'} (${id?.slice(0, 8)})${duration ? ` ${duration.toFixed(1)}s` : ''}${error ? ' ❌' : ''}`);
      setDebugToolCalls((prev) => prev.map((t) => t.callId === id ? { ...t, status: 'done' } : t));
      flushQueuedDeltas()
      const toolPayload: GatewayEventPayload = { tool_call_id: id || '', name, duration, error };
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
        // 同步 WS 连接到新 session
        import('@/services/ws-client').then(({ getWsClient }) => {
          const wsClient = getWsClient();
          if (wsClient.state === 'connected') {
            wsClient.switchSession(sessionId);
          }
        });
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

    // 🔴 对齐 Hermes: 收到 approval.responded 事件时关闭弹窗
    onApprovalResponded: (data: { run_id: string; choice: string; resolved: number }) => {
      addDebugEvent('approval.responded', `run_id=${data.run_id} choice=${data.choice} resolved=${data.resolved}`);
      setActiveApproval(null);
    },

    onSudo: (data: { request_id: string; prompt?: string }) => {
      addDebugEvent('sudo', `request_id=${data.request_id} prompt=${(data.prompt?.slice(0, 40)) ?? ''}`);
      setActiveSudo?.(data);
    },

    onSecret: (data: { request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> }) => {
      addDebugEvent('secret', `request_id=${data.request_id} env_var=${data.env_var}`);
      setActiveSecret?.(data);
    },

    onSessionInfo: (data: {
      session_id: string
      run_id: string
      model: string
      provider: string
      cwd: string
      branch: string | null
      running: boolean
      title: string
      version: string
      reasoning_effort: string
      service_tier: string
      fast: boolean
      yolo: boolean
      personality: string
      desktop_contract: string
      release_date: string
      update_behind: number | null
      update_command: string
      profile_name: string
      credential_warning: boolean | null
      tools: Record<string, unknown>
      skills: Record<string, unknown>
      usage?: {
        input_tokens?: number
        output_tokens?: number
        reasoning_tokens?: number
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        api_calls?: number
        context_used?: number
        context_max?: number
        compressions?: number
        cache_read_tokens?: number
        cache_write_tokens?: number
      }
      mcp_servers: Array<{ name: string; status: string }>
      system_prompt: string
    }) => {
      addDebugEvent('session_info', `model=${data.model} running=${data.running} branch=${data.branch}`);
      // 更新 monitorState — 同步 usage 绝对值（session.info 每次 push 都是完整快照）
      setMonitorState((prev) => ({
        ...prev,
        modelName: data.model,
        tokensIn: data.usage?.input_tokens ?? prev.tokensIn,
        tokensOut: data.usage?.output_tokens ?? prev.tokensOut,
      }));
      // 同步 store 中的 streaming 状态
      if (!data.running) {
        // 对齐 Eleve session.info running=false: 重置全部流式状态
        // Eleve: streamId=null, busy=false, awaitingResponse=false,
        //         pendingBranchGroup=null, turnStartedAt=null
        // 先 flush 残留 delta，再 finalize pending 消息
        if (flushHandleRef.current !== null) {
          clearTimeout(flushHandleRef.current);
          flushHandleRef.current = null;
        }
        flushQueuedDeltas();
        // 如果还有活跃的 streamId，说明 agent 异常退出没发 done → finalize
        if (streamIdRef.current) {
          completeAssistantMessage(fullTextRef.current);
        }
        storeSetIsStreaming(false);
        setConnectionStatus('idle');
      } else {
        storeSetIsStreaming(true);
        setConnectionStatus('streaming');
      }
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

      // 🔴 对齐 Hermes：onDone 后无条件 refresh 列表（确保新session标题更新）
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
      } else {
        // 🔴 对齐 Hermes：即使无新session，也刷新列表（标题可能已更新）
        sess.refresh();
        if (setSessionListVersion) setSessionListVersion(v => v + 1);
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

    // ── Session reset — aligned with Eleve /new /reset ──
    // When backend resets session (via /new command), update UI session_id + clear messages.
    onSessionReset: ({ new_session_id }: { old_session_id: string; new_session_id: string }) => {
      addDebugEvent('session_reset', `new: ${new_session_id?.slice(0, 8)}`);
      sess.setSessionId(new_session_id);
      storage.save('session_id', new_session_id);
      storeSetMessages([]);
      sess.refresh();
      if (setSessionListVersion) setSessionListVersion(v => v + 1);
      setDebugInfo((prev) => ({ ...prev, sessionId: new_session_id, sessionStartedAt: Date.now() }));
      // 同步 WS 连接到新 session
      import('@/services/ws-client').then(({ getWsClient }) => {
        const wsClient = getWsClient();
        if (wsClient.state === 'connected') {
          wsClient.switchSession(new_session_id);
        }
      });
    },

    // ── Run completed — aligned with Eleve session.info(running=false) ──
    // Eleve doesn't explicitly handle run.completed in handleGatewayEvent,
    // but the event carries usage data. Process it here for stats tracking.
    onRunComplete: (data: { sessionId: string; completed?: boolean; interrupted?: boolean; usage?: unknown }) => {
      addDebugEvent('run_complete', `session=${data.sessionId?.slice(0, 8)} completed=${data.completed} interrupted=${data.interrupted}`);
      // 如果被中断，清理流式状态
      if (data.interrupted && streamIdRef.current) {
        flushQueuedDeltas();
        completeAssistantMessage(fullTextRef.current);
        storeSetIsStreaming(false);
      }
    },

    // ── Delegate progress — aligned with Eleve upsertSubagent ──
    // Eleve handles subagent events via upsertSubagent.
    // Eleve routes delegate.* events through this callback for monitor display.
    onDelegateProgress: (data: {
      subagentId?: string; eventType?: string; taskIndex?: number; taskCount?: number
      goal?: string; toolName?: string; toolArgs?: Record<string, unknown>; toolPreview?: string; thinkingText?: string
      progressSummary?: string; depth?: number
      parentId?: string; model?: string; toolsets?: string[]; childSessionId?: string; toolCount?: number
      status?: string; durationSeconds?: number; summary?: string
      inputTokens?: number; outputTokens?: number; reasoningTokens?: number; apiCalls?: number
      filesRead?: string[]; filesWritten?: string[]; outputTail?: unknown[]; costUsd?: number; exitReason?: string
    }) => {
      addDebugEvent('delegate_progress', `${data.eventType || ''} ${data.goal?.slice(0, 40) || data.toolName || ''}`);
      // 更新 monitorState 显示子代理进度
      if (data.subagentId) {
        setMonitorState((prev) => {
          const tasks = { ...((prev.delegateTasks as Record<string, unknown>) || {}) };
          tasks[data.subagentId!] = {
            ...(tasks[data.subagentId!] as Record<string, unknown> || {}),
            id: data.subagentId,
            goal: data.goal,
            eventType: data.eventType,
            taskIndex: data.taskIndex,
            taskCount: data.taskCount,
            toolName: data.toolName,
            toolArgs: data.toolArgs,
            progressSummary: data.progressSummary,
            depth: data.depth,
            parentId: data.parentId,
            model: data.model,
            toolsets: data.toolsets,
            childSessionId: data.childSessionId,
            toolCount: data.toolCount,
            // 🔴 对齐Hermes: 统一 subagent.complete + status字段区分完成/失败
            status: data.status || (data.eventType === 'subagent.complete' && data.summary ? 'completed' : data.eventType === 'subagent.complete' ? 'failed' : 'running'),
            durationSeconds: data.durationSeconds,
            duration: data.durationSeconds, // 映射到UI已有字段
            summary: data.summary,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            reasoningTokens: data.reasoningTokens,
            apiCalls: data.apiCalls,
            filesRead: data.filesRead,
            filesWritten: data.filesWritten,
            outputTail: data.outputTail,
            costUsd: data.costUsd,
            exitReason: data.exitReason,
          };
          return { ...prev, delegateTasks: tasks };
        });
      }
    },

    // ── System notice — 对齐 Hermes notification.show WS 事件 ──
    // Hermes AgentNotice: text, level, kind(sticky|ttl), ttl_ms, key, id
    onSystemNotice: (data: { text: string; level?: string; kind?: string; ttl_ms?: number; key?: string; id?: string }) => {
      addDebugEvent('system_notice', `${data.level || 'info'}: ${data.text.slice(0, 60)}`);
      import('../utils/notifications').then(({ notifyError }) => {
        if (data.level === 'error' || data.level === 'warning') {
          notifyError(data.text, data.level === 'error' ? '错误' : '警告');
        }
      });
    },
    onNoticeClear: (_data: { key: string }) => {
      // 通知清除 — 预留，对齐 Hermes notification.clear
    },

    // Phase 6: 浏览器连接进度 — 对齐 Hermes browser.progress
    onBrowserProgress: (data: { message: string; level: string }) => {
      addDebugEvent('browser_progress', `${data.level}: ${data.message}`);
      if (data.level === 'error' || data.level === 'warning') {
        import('../utils/notifications').then(({ notifyError }) => {
          notifyError(data.message, data.level === 'error' ? '浏览器' : '警告');
        });
      }
    },

    // Phase 6: 皮肤切换 — 对齐 Hermes skin.changed
    onSkinChanged: (_data: { skin: unknown }) => {
      addDebugEvent('skin_changed', 'skin updated');
      // 皮肤切换由 App 层处理（重新加载主题配置）
    },

    // Phase 6: 终端关闭 — 对齐 Hermes terminal.close → closeAgentTerminalByProc
    onTerminalClose: (data: { process_id: string }) => {
      addDebugEvent('terminal_close', `process ${data.process_id} closed`);
      // 对齐 Hermes: gateway-event.ts L547-550
      // Agent closed its read-only tab via close_terminal tool → drop the view
      closeAgentTerminalByProc(data.process_id);
    },

    // ── Status update — Eleve status.update (覆盖式状态，按 kind 分流) ──
    // 对齐 Eleve TUI 前端 createGatewayEventHandler.ts L425-470:
    //   kind=goal/compressing → sys(text)+setStatus(brief)
    //   kind=lifecycle/warn/error → setStatus(text)+pushActivity(text, level)
    //   kind=status → 仅 setStatus()
    onStatusUpdate: (data: { kind: string; text: string }) => {
      addDebugEvent('status_update', `${data.kind}: ${data.text.slice(0, 60)}`);
      const { kind, text } = data;
      switch (kind) {
        case 'goal':
        case 'compressing':
          // 压缩/目标变更 → 追加系统提示到聊天流 + 更新状态栏
          mutateStream(
            (parts) => [...parts, textPart(text)],
            () => [textPart(text)],
          );
          setMonitorState((prev) => ({ ...prev, modelName: prev.modelName, statusText: text }));
          break;
        case 'lifecycle':
        case 'warn':
        case 'error': {
          // 生命周期/警告/错误 → 更新状态栏 + 错误通知
          setMonitorState((prev) => ({ ...prev, modelName: prev.modelName, statusText: text }));
          const level = kind === 'error' ? 'error' : kind === 'warn' ? 'warning' : 'info';
          import('../utils/notifications').then(({ notifyError }) => {
            if (level === 'error' || level === 'warning') {
              notifyError(text, level === 'error' ? '错误' : '警告');
            }
          });
          break;
        }
        case 'status':
        default:
          // 普通状态 → 仅更新状态栏
          setMonitorState((prev) => ({ ...prev, modelName: prev.modelName, statusText: text }));
          break;
      }
    },

    // ── Reasoning completed — NOT wired, Eleve doesn't process this event ──
    // reasoning.completed is explicitly silenced in useSSE (handled=true, no callback call).
    // Eleve lifecycle: reasoning.available (start) + reasoning.delta (append) + reasoning.end (complete).
    // Keep this no-op to satisfy SSECallbacks interface; the event is already
    // handled by onReasoning + onReasoningStart above.
    onReasoningComplete: (_reasoning: string) => {
      // Intentionally no-op — Eleve doesn't process reasoning.completed
    },
  } satisfies SSECallbacks;

  const { isStreaming, send, abort } = useSSE(sseCallbacks.current);

  return {
    isStreaming,
    send,
    abort,
  };
}
