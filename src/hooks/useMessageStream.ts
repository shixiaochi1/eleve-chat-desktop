import { useRef, useCallback, useEffect, type MutableRefObject } from 'react';
import { useSSE, type SSECallbacks } from './useSSE';
import * as storage from '../utils/storage';
import { profileFromSessionId, persistSessionPointer } from '../utils/session';
import { handleGlobalEvent } from '@/lib/global-events';
import {
  setMessages as storeSetMessages,
  getMessages,
  updateMessage,
  setIsStreaming as storeSetIsStreaming,
} from '../store/messages';
import { type DebugToolCall } from '../store/debug';
import {
  textPart,
  reasoningPart,
  upsertToolPart,
  appendTextPart,
  appendReasoningPart,
  freezeReasoningPart,
  type ChatMessagePart,
  type GatewayEventPayload,
} from '@/lib/chat-messages';
import { extractPendingInteractions } from '@/lib/ws-event-processor';
import type { ChatMessage } from '@/types';
import type { Session } from '@/types';

// ── Props type ──

export interface SessionManagerHandle {
  sessionId: string | null
  sessions: Session[]
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
  create: (options?: { model?: string; provider?: string }) => Promise<void>
  reset: () => Promise<void>
  remove: (id: string) => Promise<void>
  switchTo: (id: string) => void
  setTitle: (id: string, text: string) => void
  getTitle: (s: Session) => string
  loadHistory: (id: string) => Promise<ChatMessage[] | null>
}

export interface UseMessageStreamProps {
  genId: () => string
  addDebugEvent: (type: string, detail: string) => void
  setConnectionStatus: React.Dispatch<React.SetStateAction<string>>
  setDebugToolCalls: React.Dispatch<React.SetStateAction<DebugToolCall[]>>
  setMonitorState: React.Dispatch<React.SetStateAction<{ modelName: string | null; delegateTasks: Record<string, unknown>; tokensIn?: number; tokensOut?: number; lastSent?: string; sessionStartedAt?: number | null; statusText?: string }>>
  setActiveClarify: React.Dispatch<React.SetStateAction<{ clarify_id: string; question: string; choices: string[] } | null>>
  setActiveApproval: React.Dispatch<React.SetStateAction<{ command: string; description: string; pattern: string; choices: string[]; run_id: string } | null>>
  setActiveSudo?: React.Dispatch<React.SetStateAction<{ request_id: string; prompt?: string } | null>>
  setActiveSecret?: React.Dispatch<React.SetStateAction<{ request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> } | null>>
  setActiveSlashConfirm?: React.Dispatch<React.SetStateAction<{ confirmId: string; command: string; description: string } | null>>
  /** 🔴 W-7: 会话 cwd 同步（session.info 推送）— 供 PreviewPanel 重启预览等消费 */
  setSessionCwd?: React.Dispatch<React.SetStateAction<string>>
  sess: SessionManagerHandle
  drainQueueRef: MutableRefObject<(() => void) | null>
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  /** 🔴 宫格/单视图互斥：grid 模式传 false 暂停 useSSE（useGridChat 接管 WS 事件） */
  enabled?: boolean
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
 *    for incremental streaming.
 * 4. Tool events flush text deltas BEFORE upserting tool parts.
 * 5. completeAssistantMessage — on 'done', replaces streaming message parts
 *    with drainFinalParts() from the shared StreamAccumulator.
 *    (3.3: 消灭影子累加器 fullTextRef，单一权威源 ws-event-processor)
 * 6. [FIX #4] reasoning.available triggers start (creates empty reasoning part),
 *    same as Eleve appendReasoningDelta with replace=true.
 */
export function useMessageStream({
  genId,
  addDebugEvent,
  setConnectionStatus,
  setDebugToolCalls,
  setMonitorState,
  setActiveClarify,
  setActiveApproval,
  setActiveSudo,
  setActiveSecret,
  setActiveSlashConfirm,
  setSessionCwd,
  sess,
  drainQueueRef,
  setSessionListVersion,
  enabled = true,
}: UseMessageStreamProps): {
  isStreaming: boolean
  send: (text: string, sessionId?: string | null, modelOpts?: { model?: string; provider?: string }) => Promise<void>
  abort: () => Promise<void>
  resetStream: (nextSessionId?: string | null) => void
  /** 🔴 当前显示 session 的同步权威 ref（resetStream 同步锁定）——loadHistory 过期响应守卫必须比它，不能比异步 sess.sessionId */
  currentSessionIdRef: MutableRefObject<string | null>
} {
  // ── Stream ID — same as Eleve: one unique ID per streaming turn ──
  // [FIX #1] Lazy creation: mutateStream auto-allocates if null
  const streamIdRef = useRef<string | null>(null)

  // ── Queued deltas — accumulated incremental deltas (Eleve pattern) ──
  const queuedDeltasRef = useRef<QueuedStreamDeltas>({ assistant: '', reasoning: '' })
  const flushHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlushAtRef = useRef<number>(0)

  // 🔴 多 Agent 隔离：跟踪当前显示的 session_id，传给 useSSE 做 WS 事件过滤
  const currentSessionIdRef = useRef<string | null>(sess.sessionId)
  useEffect(() => { currentSessionIdRef.current = sess.sessionId }, [sess.sessionId])

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
            timestamp: Date.now(),
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

  // ── completeAssistantMessage — 3.3: 改用 drainFinalParts 共享累加器权威 parts ──
  // On stream end, replace streaming message parts with accumulator-finalized parts.
  // 消灭旧版 fullTextRef 影子累加器 + reasoning 去重 hack（累加器已正确分离 reasoning/text）。
  const completeAssistantMessage = useCallback(
    (finalParts: ChatMessagePart[]) => {
      const streamId = streamIdRef.current
      streamIdRef.current = null // Clear streamId — turn is over

      storeSetMessages((prev) => {
        if (streamId && prev.some(m => m.id === streamId)) {
          // Found our streaming message — finalize with accumulator parts
          return prev.map(m => {
            if (m.id !== streamId) return m
            return {
              ...m,
              parts: finalParts.length ? finalParts : m.parts,
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
            return {
              ...m,
              parts: finalParts.length ? finalParts : m.parts,
              pending: false,
            }
          })
        }

        // No pending message — create a completed one
        if (finalParts.length) {
          return [...prev, { id: genId(), role: 'assistant' as const, parts: finalParts, pending: false, timestamp: Date.now() }]
        }
        return prev
      })
    },
    [genId],
  )

  // ── 🔴 Phase 2: 独立消息追加（系统提示/中间消息/委托 — 审查 #2/#13 修复）──
  // 旧实现经 mutateStream 混进流式助手气泡（绕过累加器 → 完成时被 finalize 整体替换抹掉）。
  // 新实现：独立消息入 store。流式进行中插到 in-flight 气泡之前，
  // 对齐宫格“messages 在前、流式气泡殿后”的视觉顺序（两视图同事件同产物）。
  const appendIndependentMessage = useCallback((msg: ChatMessage) => {
    storeSetMessages((prev) => {
      const streamId = streamIdRef.current;
      if (streamId) {
        const idx = prev.findIndex(m => m.id === streamId);
        if (idx >= 0) return [...prev.slice(0, idx), msg, ...prev.slice(idx)];
      }
      return [...prev, msg];
    });
  }, []);

  // ── finalizeStepBoundary — 对齐 Hermes _emit_interim_assistant_message 消息分界 ──
  // step.complete 到达时：当前步骤的 text + tool parts 已全量流入，
  // 将当前流式消息标记完成（pending:false）并重置 streamId，
  // 下一步的 delta 自动创建新消息气泡。
  const finalizeStepBoundary = useCallback(() => {
    // 先刷尽排队 delta，确保当前步骤文本完整
    if (flushHandleRef.current !== null) {
      clearTimeout(flushHandleRef.current)
      flushHandleRef.current = null
    }
    flushQueuedDeltas()

    const streamId = streamIdRef.current
    if (!streamId) return

    // 标记当前消息完成（保留 parts 原样，不做文本替换）
    storeSetMessages((prev) =>
      prev.map(m => m.id === streamId ? { ...m, pending: false } : m)
    )

    // 重置：下一步 delta 会创建新消息
    streamIdRef.current = null
  }, [flushQueuedDeltas])

  // ── SSE streaming callbacks — aligned with Eleve handleGatewayEvent ──
  sseCallbacks.current = {
    // ── Text delta — 1:1 with Eleve message.delta ──
    // queueDelta uses the INCREMENTAL delta.
    // 3.3: fullText 不再追踪 — onDone 走 drainFinalParts() 从共享累加器取权威 parts
    onText: (delta: string) => {
      queueDelta('assistant', delta)
    },

    // ── Reasoning delta — 1:1 with Eleve reasoning.delta ──
    onReasoning: (delta: string) => {
      queueDelta('reasoning', delta)
    },

    // reasoning.available = 推理开始通知（拆变体后不带文本）
    // 🔴 Phase 1: 种空未冻结推理块占位（与累加器 reasoning.available 处理同构）。
    // 多块支持：尾部已是未冻结推理块则跳过（不重复种）；flush 先走保证前序 delta 落定。
    onReasoningStart: () => {
      flushQueuedDeltas()
      mutateStream(
        (parts) => {
          const last = parts.at(-1)
          if (last && last.type === 'reasoning' && !last.done) return parts
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
        persistSessionPointer(sessionId);
        setMonitorState((prev) => ({ ...prev, sessionStartedAt: Date.now() }));
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
      // 🔴 Phase 2: 独立 system 消息（对齐宫格 useGridChat delegate.start）
      appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(`▶ 委托子 Agent: ${goal || taskId}`)], timestamp: Date.now() });
    },

    onDelegateEnd: ({ taskId, status, summary, model, tokensInput, tokensOutput, duration }: { taskId: string; status?: string; summary?: string; model?: string; tokensInput?: number; tokensOutput?: number; duration?: number }) => {
      setMonitorState((prev) => {
        const next = { ...((prev.delegateTasks as Record<string, unknown>) || {}) };
        if (next[taskId]) {
          next[taskId] = { ...(next[taskId] as Record<string, unknown>), status, summary, tokensInput, tokensOutput, duration };
        }
        return { ...prev, delegateTasks: next };
      });
      // 🔴 Phase 2: 独立 system 消息（对齐宫格 useGridChat delegate.end）
      appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(`✔ 子 Agent 完成: ${summary || status || 'done'}`)], timestamp: Date.now() });
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
      // T5: pending_prompts
      pending_prompts?: {
        clarify?: { clarify_id: string; question: string; choices: string[]; awaiting_text: boolean }
        sudo_password?: { sudo_id: string; prompt: string }
        secret_capture?: { secret_id: string; env_var: string; prompt: string }
        terminal_read?: { read_id: string }
        slash_confirm?: { confirm_id: string; command: string }
        approval?: { request_id: string; command: string; choices?: string[] }
      }
    }) => {
      addDebugEvent('session_info', `model=${data.model} running=${data.running} branch=${data.branch}`);
      // 🔴 W-7: 同步会话 cwd（后端 session.info 携带；旧版丢弃 → preview.restart cwd 恒空）
      setSessionCwd?.(data.cwd || '');
      // T5: 恢复 pending 交互 UI — 归一化提取（与宫格 useGridChat 同一权威源）
      const pending = extractPendingInteractions(data.pending_prompts as Record<string, Record<string, unknown>> | undefined, data.run_id);
      if (pending) {
        if (pending.clarify) setActiveClarify(pending.clarify);
        if (pending.approval) setActiveApproval(pending.approval);
        if (pending.sudo) setActiveSudo?.(pending.sudo);
        if (pending.secret) setActiveSecret?.(pending.secret);
        // 🔴 P1 修复：slash_confirm 恢复（之前漏掉，刷新后 pending 的 /new /undo /reset 确认卡不恢复）
        if (pending.slashConfirm) setActiveSlashConfirm?.(pending.slashConfirm as { confirmId: string; command: string; description: string });
      }
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
          completeAssistantMessage(drainFinalParts());
        }
        storeSetIsStreaming(false);
        setConnectionStatus('idle');
        // 🔴 P0-4: 自愈必须释放发送锁（对齐宫格 useGridChat:574-577 + 单视图 onDone:624）
        // 不释锁 → isSendingRef 恒 true → 后续消息静默进死队列永不发送
        if (drainQueueRef.current) drainQueueRef.current();
      } else {
        storeSetIsStreaming(true);
        setConnectionStatus('streaming');
      }
    },

    // ── Done — 1:1 with Hermes message.complete ──
    // 3.3: drainFinalParts() 从共享累加器取权威 parts（消灭影子累加器 fullTextRef）
    onDone: (newSessionId: string | null) => {
      addDebugEvent('done', newSessionId ? `new session: ${newSessionId?.slice(0, 8)}` : 'complete');

      // Cancel any pending flush timer
      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current)
        flushHandleRef.current = null
      }

      // Flush any remaining queued deltas
      flushQueuedDeltas()

      // 3.3: drain 共享累加器 → 权威 parts（reasoning → tools → text）
      // drain 语义：取出+重置。interrupted 双触发时第二次 drain 返回空 → 不创建重复消息
      completeAssistantMessage(drainFinalParts())

      // 🔴 修复：显式重置 isStreaming 状态（对齐 Hermes session.info(running=false)）
      // 后端在对话完成后发送 message.complete，前端 onDone 被调用，
      // 但之前没有重置 isStreaming，导致审批后输入框被禁用
      storeSetIsStreaming(false)

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
          persistSessionPointer(newSessionId);
          sess.refresh();
          if (setSessionListVersion) setSessionListVersion(v => v + 1);
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

      if (getMessages().some(m => m.id === errorStreamId)) {
        updateMessage(errorStreamId, { error: msg, pending: false })
      } else {
        storeSetMessages((prev) => [...prev, { id: genId(), role: 'assistant', parts: [textPart(msg)], error: msg, timestamp: Date.now() } as ChatMessage]);
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
      persistSessionPointer(new_session_id);
      storeSetMessages([]);
      sess.refresh();
      if (setSessionListVersion) setSessionListVersion(v => v + 1);
      setMonitorState((prev) => ({ ...prev, sessionStartedAt: Date.now() }));
      // 同步 WS 连接到新 session
      import('@/services/ws-client').then(({ getWsClient }) => {
        const wsClient = getWsClient();
        if (wsClient.state === 'connected') {
          wsClient.switchSession(new_session_id);
        }
      });
    },

    // 对齐架构原则：后端是 session_id 唯一权威源
    // 后端在 prompt.submit 中自动创建 session 时通知前端更新
    onSessionCreated: (newSessionId: string) => {
      addDebugEvent('session_created', `new: ${newSessionId?.slice(0, 8)}`);
      sess.setSessionId(newSessionId);
      persistSessionPointer(newSessionId);
      if (setSessionListVersion) setSessionListVersion(v => v + 1);
      setMonitorState((prev) => ({ ...prev, sessionStartedAt: Date.now() }));
      import('@/services/ws-client').then(({ getWsClient }) => {
        const wsClient = getWsClient();
        if (wsClient.state === 'connected') {
          wsClient.switchSession(newSessionId);
        }
      });
    },

    // 对齐 Hermes pending_title: 后端应用 title 后推送 session.title 事件
    // 前端消费事件更新 titles map + 刷新 session 列表
    onSessionTitle: (data: { session_id: string; title: string }) => {
      if (data.session_id && data.title) {
        sess.setTitle(data.session_id, data.title);
        if (setSessionListVersion) setSessionListVersion(v => v + 1);
      }
    },

    // ── Run completed — aligned with Eleve session.info(running=false) ──
    // Eleve doesn't explicitly handle run.completed in handleGatewayEvent,
    // but the event carries usage data. Process it here for stats tracking.
    onRunComplete: (data: { sessionId: string; completed?: boolean; interrupted?: boolean; usage?: unknown }) => {
      addDebugEvent('run_complete', `session=${data.sessionId?.slice(0, 8)} completed=${data.completed} interrupted=${data.interrupted}`);
      // 如果被中断，清理流式状态
      if (data.interrupted && streamIdRef.current) {
        flushQueuedDeltas();
        completeAssistantMessage(drainFinalParts());
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

    // ── System notice — 委托共享处理器（与宫格 useGridChat 同一权威源）──
    onSystemNotice: (data: { text: string; level?: string; kind?: string; ttl_ms?: number; key?: string; id?: string }) => {
      addDebugEvent('system_notice', `${data.level || 'info'}: ${data.text.slice(0, 60)}`);
      handleGlobalEvent('notification.show', data as Record<string, unknown>);
    },
    onNoticeClear: (data: { key: string }) => {
      addDebugEvent('notice_clear', `key=${data.key}`);
      handleGlobalEvent('notification.clear', data as Record<string, unknown>);
    },

    // Phase 6: 浏览器连接进度 — 委托共享处理器
    onBrowserProgress: (data: { message: string; level: string }) => {
      addDebugEvent('browser_progress', `${data.level}: ${data.message}`);
      handleGlobalEvent('browser.progress', data as Record<string, unknown>);
    },

    // Phase 6: 皮肤切换 — App 层处理（重新加载主题配置）
    onSkinChanged: (_data: { skin: unknown }) => {
      addDebugEvent('skin_changed', 'skin updated');
    },

    // Phase 6: 终端关闭 — 委托共享处理器
    onTerminalClose: (data: { process_id: string }) => {
      addDebugEvent('terminal_close', `process ${data.process_id} closed`);
      handleGlobalEvent('terminal.close', data as Record<string, unknown>);
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
          // 🔴 Phase 2: 压缩/目标变更 → 独立 system 消息（对齐宫格）+ 状态栏
          // （旧实现混进流式气泡，完成时被 finalize 抹掉 — 审查 #2）
          if (text) appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(text)], timestamp: Date.now() });
          setMonitorState((prev) => ({ ...prev, modelName: prev.modelName, statusText: text }));
          break;
        case 'background':
          // 🔴 Phase 2: 后台任务结果回推（对齐 Hermes _run_background_task deliver）→ 独立 system 消息（对齐宫格）+ toast
          if (text) appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(text)], timestamp: Date.now() });
          import('../utils/notifications').then(({ notifySuccess, notifyError }) => {
            if (text.startsWith('❌')) notifyError(text, '后台任务失败');
            else notifySuccess('后台任务已完成');
          });
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

    // ── Reasoning completed — 推理块结束 → 冻结 live 尾部推理块 ──
    // 🔴 Phase 1: 与累加器 reasoning.end 处理同构（freezeReasoningPart）。
    // 冻结后下一个 reasoning.delta 经 appendReasoningPart 自然新开块 — 多推理块流式不合并。
    // 守卫：streamId 存在但消息未生成（run.started 预分配）时不种空气泡。
    onReasoningComplete: () => {
      const streamId = streamIdRef.current
      if (!streamId) return
      if (!getMessages().some(m => m.id === streamId)) return
      mutateStream(
        (parts) => freezeReasoningPart(parts),
        () => [],
        { pending: m => m.pending ?? true },
      )
    },

    // ── 🔴 Phase 2b: 补齐单视图缺失的 8 个事件（对齐宫格 useGridChat 已处理）──

    // Agent 思考状态（对齐 Hermes thinking_callback）
    onThinking: (text: string) => {
      addDebugEvent('thinking', text.slice(0, 60));
      setMonitorState((prev) => ({ ...prev, statusText: text }));
    },

    // 工具参数生成中（drafting spinner）
    onToolGenerating: (name: string) => {
      addDebugEvent('tool_generating', name);
    },

    // 工具进度（对齐 Hermes tool_progress_command）
    onToolProgress: (data: { eventType: string; toolName: string; preview?: string; args?: unknown; duration?: number; error?: boolean; toolCallId?: string }) => {
      addDebugEvent('tool_progress', `${data.toolName}: ${data.preview || data.eventType}`);
      setMonitorState((prev) => ({ ...prev, statusText: data.preview ? `${data.toolName}: ${data.preview}` : `${data.toolName} 执行中...` }));
    },

    // Fallback 已激活（对齐 Hermes fallback 通知）
    onFallbackActivated: (data: { model: string; provider: string }) => {
      addDebugEvent('fallback', `${data.provider}/${data.model}`);
      setMonitorState((prev) => ({ ...prev, modelName: data.model }));
      import('../utils/notifications').then(({ notifyWarning }) => {
        notifyWarning(`模型回退: ${data.provider}/${data.model}`, 'Fallback');
      }).catch(() => {});
    },

    // 文本段结束（对齐 Hermes stream_delta_callback(None)）
    onSectionEnd: () => {
      flushQueuedDeltas();
    },

    // 步骤完成（对齐 Hermes step_callback + _emit_interim_assistant_message 消息分界）
    // 内部记账进 DebugPanel；同时 finalize 当前流式消息，下一步 delta 创建新气泡
    onStepComplete: (data: { stepNumber: number; toolResults: Array<{ toolName: string; success: boolean }> }) => {
      const text = data.toolResults.length
        ? `步骤 ${data.stepNumber}: ${data.toolResults.map(r => `${r.toolName} ${r.success ? '✓' : '✗'}`).join(', ')}`
        : `步骤 ${data.stepNumber} 完成`;
      addDebugEvent('step_complete', text);
      finalizeStepBoundary();
    },

    // 中间助手消息（对齐 Hermes _emit_interim_assistant_message）
    // 🔴 Phase 2: 独立 assistant 消息（对齐宫格 useGridChat interim.message）
    onInterimMessage: (data: { content: string; alreadyStreamed: boolean }) => {
      if (data.content && !data.alreadyStreamed) {
        addDebugEvent('interim_message', data.content.slice(0, 60));
        appendIndependentMessage({ id: genId(), role: 'assistant' as const, parts: [textPart(data.content)], timestamp: Date.now() });
      }
    },

    // 后台 Review 结果（对齐 Hermes background_review_callback）
    // 🔴 Phase 2: 独立 system 消息（对齐宫格 useGridChat background.review）
    onBackgroundReview: (data: { summary: string }) => {
      if (data.summary) {
        addDebugEvent('background_review', data.summary.slice(0, 60));
        appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(`🔍 后台审查: ${data.summary}`)], timestamp: Date.now() });
      }
    },
  } satisfies SSECallbacks;

  const { isStreaming, send, abort, resetStream: resetSSEStream, drainFinalParts } = useSSE(sseCallbacks.current, currentSessionIdRef, enabled);

  // 🔴 多 Agent 隔离：切换会话时重置全部流式状态（SSE 累加器 + streamId）
  // 🔴 串台根因修复：nextSessionId 提供时同步锁定过滤 ref，消灭“effect 异步更新”的串台窗口。
  // 稳态仍由 useEffect([sess.sessionId]) 对账（后端驱动的 session 变更经 onRunStart/onSessionCreated）。
  const resetStream = useCallback((nextSessionId?: string | null) => {
    if (nextSessionId !== undefined) {
      currentSessionIdRef.current = nextSessionId;
    }
    resetSSEStream();
    streamIdRef.current = null;
    queuedDeltasRef.current = { assistant: '', reasoning: '' };
    if (flushHandleRef.current !== null) {
      clearTimeout(flushHandleRef.current);
      flushHandleRef.current = null;
    }
  }, [resetSSEStream]);

  return {
    isStreaming,
    send,
    abort,
    resetStream,
    currentSessionIdRef,
  };
}
