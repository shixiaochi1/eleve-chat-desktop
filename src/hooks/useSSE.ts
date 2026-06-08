import { useRef, useCallback } from 'react';
import { getApiBase } from '../utils/api';
import { call } from '../utils/bridge';
import { useIsStreaming, setIsStreaming as storeSetIsStreaming } from '@/store/messages';

// ── SSE callback types ──

export interface SSEAccumulators {
  fullText: string
  fullReasoning: string
  pendingTools: Record<string, { name: string; argsStr: string }>
}

export interface SSECallbacks {
  onText?: (delta: string, fullText: string) => void
  onReasoning?: (delta: string, fullText: string) => void
  onReasoningReplace?: (fullText: string) => void
  onToolStart?: (data: { id: string | null; name: string }) => void
  onToolArgs?: (data: { id: string; delta: string; accumulated: string }) => void
  onToolEnd?: (data: { id: string | null; name: string }) => void
  onUsage?: (data: { input: number; output: number; cacheRead?: number; cacheWrite?: number }) => void
  onModelName?: (name: string) => void
  onRunStart?: (sessionId: string) => void
  onRunComplete?: (data: { sessionId: string; completed?: boolean; interrupted?: boolean; usage?: unknown }) => void
  onDelegateStart?: (data: { taskId: string; goal?: string; model?: string }) => void
  onDelegateEnd?: (data: { taskId: string; status?: string; summary?: string; model?: string; tokensInput?: number; tokensOutput?: number; duration?: number }) => void
  onDelegateProgress?: (data: {
    subagentId?: string; eventType?: string; taskIndex?: number; taskCount?: number
    goal?: string; toolName?: string; toolPreview?: string; thinkingText?: string
    progressSummary?: string; depth?: number
  }) => void
  onSystemNotice?: (data: { message: string; level?: string }) => void
  onClarify?: (data: { clarify_id: string; question: string; choices?: string[] }) => void
  onApproval?: (data: unknown) => void
  onDone?: (sessionId: string | null) => void
  onError?: (msg: string) => void
  onReasoningComplete?: (reasoning: string) => void
}

// ── Raw SSE event shapes (snake_case from Rust StreamEvent) ──

interface ToolCallStartEvent {
  id: string
  name: string
}

interface ToolCallArgumentsEvent {
  id: string
  arguments_delta: string
}

interface ToolCallEndEvent {
  id: string
}

interface DelegateStartEvent {
  task_id: string
  goal?: string
  model?: string
}

interface DelegateEndEvent {
  task_id: string
  status?: string
  summary?: string
  model?: string
  tokens_input?: number
  tokens_output?: number
  duration_secs?: number
}

interface SystemNoticeEvent {
  message: string
  level?: string
}

interface ClarifyQuestionEvent {
  clarify_id: string
  question: string
  choices?: string[]
}

interface ToolProgressEvent {
  event?: string
  tool?: string
  error?: string
  text?: string
  preview?: string
}

interface RunStartedEvent {
  session_id: string
}

interface RunCompletedEvent {
  session_id: string
  completed?: boolean
  interrupted?: boolean
}

interface UsageEvent {
  input_tokens: number
  output_tokens: number
  cache_read_tokens?: number
  cache_write_tokens?: number
}

interface ToolProgressChunk {
  tool_name?: string
  tool_id?: string
  delta?: string
}

interface RunCompleteChunk {
  session_id?: string
  completed?: boolean
  interrupted?: boolean
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }
}

/**
 * SSE streaming hook v2 — HTTP 版
 * 
 * 桌面模式 & 浏览器模式统一走 HTTP SSE
 */
export function useSSE(callbacks: SSECallbacks = {}): {
  isStreaming: boolean
  send: (text: string, sessionId?: string | null) => Promise<void>
  abort: () => Promise<void>
} {
  // isStreaming is now a STORE atom, not local useState.
  // This prevents App → MessageContainer re-render cascade.
  const isStreaming = useIsStreaming();
  const controllerRef = useRef<AbortController | null>(null);
  const currentSessionRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef(false);
  const cbsRef = useRef<SSECallbacks>(callbacks);
  cbsRef.current = callbacks;

  /**
   * 处理单个 StreamEvent（从 HTTP SSE 解析）
   */
  const handleEvent = useCallback((event: Record<string, unknown>, accumulators: SSEAccumulators): string | undefined => {
    const cbs = cbsRef.current;
    if (!event) return;

    // ── Done ──
    if (event.done !== undefined) {
      const doneVal = event.done as (Record<string, unknown> | undefined)
      const sessionId = (doneVal?.session_id as string) || (event.session_id as string) || null;
      cbs.onDone?.(sessionId);
      return 'done';
    }

    // ── Error ──
    if (event.error !== undefined) {
      const msg = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
      cbs.onError?.(msg);
      return 'error';
    }

    // ── Usage ──
    if (event.usage !== undefined) {
      const usage = event.usage as UsageEvent;
      cbs.onUsage?.({
        input: usage.input_tokens,
        output: usage.output_tokens,
      });
      return;
    }

    // ── Reasoning ──
    if (event.reasoning !== undefined) {
      const r = typeof event.reasoning === 'string' ? event.reasoning : String(event.reasoning);
      accumulators.fullReasoning += r;
      cbs.onReasoning?.(r, accumulators.fullReasoning);
      return;
    }

    // ── ToolCallStart ──
    if (event.tool_call_start !== undefined) {
      const { id, name } = event.tool_call_start as ToolCallStartEvent;
      accumulators.pendingTools[id] = { name, argsStr: '' };
      cbs.onToolStart?.({ id, name });
      return;
    }

    // ── ToolCallArguments ──
    if (event.tool_call_arguments !== undefined) {
      const { id, arguments_delta } = event.tool_call_arguments as ToolCallArgumentsEvent;
      const pending = accumulators.pendingTools[id];
      const delta = typeof arguments_delta === 'string'
        ? arguments_delta
        : JSON.stringify(arguments_delta);
      if (pending) pending.argsStr += delta;
      cbs.onToolArgs?.({ id, delta, accumulated: pending?.argsStr ?? delta });
      return;
    }

    // ── ToolCallEnd ──
    if (event.tool_call_end !== undefined) {
      const { id } = event.tool_call_end as ToolCallEndEvent;
      const pending = accumulators.pendingTools[id];
      delete accumulators.pendingTools[id];
      cbs.onToolEnd?.({ id, name: pending?.name ?? 'tool' });
      return;
    }

    // ── ModelName ──
    if (event.model_name !== undefined) {
      const modelNameVal = event.model_name;
      const name = typeof modelNameVal === 'object' && modelNameVal !== null
        ? (modelNameVal as Record<string, unknown>).name as string || String(modelNameVal)
        : String(modelNameVal);
      cbs.onModelName?.(name);
      return;
    }

    // ── DelegateStart ──
    if (event.delegate_start !== undefined) {
      const { task_id, goal, model } = event.delegate_start as DelegateStartEvent;
      cbs.onDelegateStart?.({ taskId: task_id, goal, model });
      return;
    }

    // ── DelegateEnd ──
    if (event.delegate_end !== undefined) {
      const { task_id, status, summary, model, tokens_input, tokens_output, duration_secs } = event.delegate_end as DelegateEndEvent;
      cbs.onDelegateEnd?.({ taskId: task_id, status, summary, model, tokensInput: tokens_input, tokensOutput: tokens_output, duration: duration_secs });
      return;
    }

    // ── SystemNotice ──
    if (event.system_notice !== undefined) {
      const { message, level } = event.system_notice as SystemNoticeEvent;
      cbs.onSystemNotice?.({ message, level });
      return;
    }

    // ── ClarifyQuestion ──
    if (event.clarify_question !== undefined) {
      const { clarify_id, question, choices } = event.clarify_question as ClarifyQuestionEvent;
      cbs.onClarify?.({ clarify_id, question, choices });
      return;
    }

    // ── ToolProgress (fallback — only reached for unnamed SSE lines) ──
    // NOTE: reasoning.available is handled via named-event 'tool_progress' route
    // with onReasoningReplace (not onReasoning). We must NOT re-handle it here
    // with onReasoning (append) or it creates a second reasoning bubble.
    if (event.tool_progress !== undefined) {
      const tp = event.tool_progress as ToolProgressEvent;
      const ev = tp.event || tp.tool;
      if (ev === 'tool.failed' || ev === 'tool_error') {
        cbs.onError?.(tp.error || `Tool ${tp.tool} failed`);
      }
      // reasoning.available intentionally NOT handled here — named-event route
      // above handles it with onReasoningReplace (replace mode).
      return;
    }

    // ── RunStarted ──
    if (event.run_started !== undefined) {
      const rs = event.run_started as RunStartedEvent;
      cbs.onRunStart?.(rs.session_id);
      return;
    }

    // ── RunCompleted ──
    if (event.run_completed !== undefined) {
      const rc = event.run_completed as RunCompletedEvent;
      cbs.onRunComplete?.({
        sessionId: rc.session_id,
        completed: rc.completed,
        interrupted: rc.interrupted,
      });
      return;
    }

    // ── No more 'text' fallback ──
    // REMOVED: The old `if (event.text !== undefined)` fallback here
    // caused DUPLICATE content. When the backend sends named SSE events
    // (assistant.delta), the switch-case above already routes them.
    // This fallback would fire for unnamed data lines that also contain
    // a 'text' field, double-triggering onText. Hermes does NOT have
    // this fallback — it only uses named events.
  }, []);

  const send = useCallback(async (text: string, sessionId?: string | null): Promise<void> => {
    console.log('🔍 useSSE.send called, text=', JSON.stringify(text), 'len=', text?.length);
    if (!text?.trim()) { console.warn('⚠️ useSSE.send blocked: empty text'); return; }
    storeSetIsStreaming(true);
    isStreamingRef.current = true;

    // 记录当前流式会话 ID，abort 时使用
    currentSessionRef.current = sessionId ?? null;

    const cbs = cbsRef.current;

    // Accumulators for multi-chunk fields
    const accumulators: SSEAccumulators = {
      fullText: '',
      fullReasoning: '',
      pendingTools: {},
    };

    // ── 统一走 HTTP SSE ──
    const MAX_RETRIES = 3;
    const SSE_IDLE_TIMEOUT_MS = 60_000;
    const SSE_TOTAL_TIMEOUT_MS = 600_000;
    let attempt = 0;
    const controller = new AbortController();
    controllerRef.current = controller;

    while (attempt <= MAX_RETRIES) {
      // Reset accumulators on retry
      accumulators.fullText = '';
      accumulators.fullReasoning = '';
      accumulators.pendingTools = {};

      try {
        const apiBase = getApiBase();
        const resp = await fetch(`${apiBase}/v1/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, session_id: sessionId || null }),
          signal: controller.signal,
        });

        console.log('🔍 [SSE] Response received, status=', resp.status, 'ok=', resp.ok, 'body=', !!resp.body);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (!resp.body) throw new Error('不支持流式响应');

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastEventName = '';
        let eventCount = 0;
        let lastDataTime = Date.now();
        const streamStartTime = Date.now();

        while (true) {
          const readPromise = reader.read();
          const idleDeadline = Date.now() + SSE_IDLE_TIMEOUT_MS;
          const timeoutPromise = new Promise<never>((_, reject) => {
            const remaining = Math.min(
              idleDeadline - Date.now(),
              streamStartTime + SSE_TOTAL_TIMEOUT_MS - Date.now()
            );
            if (remaining <= 0) {
              reject(new Error('SSE stream timeout'));
              return;
            }
            setTimeout(() => reject(new Error(
              Date.now() - lastDataTime > SSE_IDLE_TIMEOUT_MS
                ? 'SSE idle timeout (60s no data)'
                : 'SSE total timeout (10min limit)'
            )), remaining);
          });

          let readResult: ReadableStreamReadResult<Uint8Array>;
          try {
            readResult = await Promise.race([readPromise, timeoutPromise]);
          } catch (timeoutErr) {
            console.warn(`[SSE] ${(timeoutErr as Error).message}, aborting session=${sessionId}`);
            controller.abort();
            cbs.onError?.((timeoutErr as Error).message);
            break;
          }

          const { done, value } = readResult;
          if (done) {
            console.log('🔍 [SSE] ReadableStream done, total events=', eventCount);
            buffer += decoder.decode();
            break;
          }
          lastDataTime = Date.now();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('event:')) {
              lastEventName = trimmed.slice(6).trim();
              continue;
            }
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            eventCount++;

            // 防御: 空 data 行 (如旧版 keepalive event: keepalive + data:"")
            // 对齐 Hermes: keepalive 用 SSE comment (`: keepalive\n\n`)，前端自动跳过
            if (!dataStr) continue;

            if (eventCount <= 20) {
              console.log(`🔍 [SSE] event#${eventCount} eventName=${lastEventName} data=${dataStr.slice(0, 200)}`);
            }

            try {
              const chunk = JSON.parse(dataStr);

              if (eventCount <= 20) {
                console.log(`🔍 [SSE] parsed keys=${Object.keys(chunk).join(',')} typeof=${typeof chunk}`, chunk);
              }

              // ── Route by named event (Hermes format) ──
              let handled = false;
              let result: string | undefined = '';
              switch (lastEventName) {
                case 'assistant.delta':
                  accumulators.fullText += chunk.delta || '';
                  cbs.onText?.(chunk.delta || '', accumulators.fullText);
                  handled = true;
                  break;
                case 'reasoning.delta':
                  accumulators.fullReasoning += chunk.delta || '';
                  cbs.onReasoning?.(chunk.delta || '', accumulators.fullReasoning);
                  handled = true;
                  break;
                case 'tool.started':
                  cbs.onToolStart?.({ id: chunk.tool_id || null, name: chunk.tool_name });
                  handled = true;
                  break;
                case 'tool.completed':
                  cbs.onToolEnd?.({ id: chunk.tool_id || null, name: chunk.tool_name });
                  handled = true;
                  break;
                case 'tool_progress':
                  {
                    // NOTE: tool_progress is a legacy path.  The structured
                    // tool_call_start / tool_call_end events (routed above via
                    // the named-event switch) already fire onToolStart/onToolEnd.
                    // We only handle sub-events that the structured path does
                    // NOT cover: reasoning.available and tool.failed.
                    const ev = chunk.event || chunk.tool;
                    if (ev === 'reasoning.available') {
                      // [FIX #4] reasoning.available = REPLACE, not append.
                      // Same as Hermes appendReasoningDelta(sessionId, text, replace=true).
                      cbs.onReasoningReplace?.(chunk.text || '');
                    } else if (ev === 'tool.failed' || ev === 'tool_error') {
                      cbs.onError?.(chunk.error || `Tool ${chunk.tool} failed`);
                    }
                    // Intentionally NOT forwarding tool.started / tool.completed
                    // here to avoid double-firing onToolStart/onToolEnd — the
                    // named-event switch above already handles those.
                  }
                  handled = true;
                  break;
                case 'tool.progress':
                  // NOTE: Hermes does NOT handle _thinking via tool.progress.
                  // Reasoning is handled by:
                  //   - reasoning.delta (named event) → onReasoning (append)
                  //   - tool_progress(reasoning.available) → onReasoningReplace (replace)
                  // The old _thinking branch here would APPEND reasoning content
                  // that the reasoning.delta path already appended, causing
                  // duplicate reasoning bubbles.
                  {
                    const tid = chunk.tool_id || 'unknown';
                    if (!accumulators.pendingTools[tid]) {
                      accumulators.pendingTools[tid] = { name: chunk.tool_name || '', argsStr: '' };
                    }
                    const deltaStr = typeof chunk.delta === 'string' ? chunk.delta : JSON.stringify(chunk.delta);
                    accumulators.pendingTools[tid].argsStr += deltaStr;
                    cbs.onToolArgs?.({ id: tid, delta: deltaStr, accumulated: accumulators.pendingTools[tid].argsStr });
                  }
                  handled = true;
                  break;
                case 'tool.failed':
                  cbs.onError?.(chunk.error || `Tool ${chunk.tool_name} failed`);
                  handled = true;
                  break;
                case 'delegate.start':
                  cbs.onDelegateStart?.({ taskId: chunk.task_id, goal: chunk.goal });
                  handled = true;
                  break;
                case 'delegate.end':
                  cbs.onDelegateEnd?.({ taskId: chunk.task_id, status: chunk.status, summary: chunk.summary });
                  handled = true;
                  break;
                case 'model.name':
                  cbs.onModelName?.(chunk.name);
                  handled = true;
                  break;
                case 'system.notice':
                  cbs.onSystemNotice?.({ message: chunk.message, level: chunk.level });
                  handled = true;
                  break;
                case 'clarify.question':
                  cbs.onClarify?.({ clarify_id: chunk.clarify_id, question: chunk.question, choices: chunk.choices });
                  handled = true;
                  break;
                case 'approval.request':
                  cbs.onApproval?.(chunk);
                  handled = true;
                  break;
                case 'error':
                  cbs.onError?.(chunk.message || 'Unknown error');
                  result = 'error';
                  handled = true;
                  break;
                case 'done':
                  cbs.onDone?.(chunk.session_id);
                  result = 'done';
                  handled = true;
                  break;
                case 'run.started':
                  cbs.onRunStart?.(chunk.session_id);
                  handled = true;
                  break;
                case 'run.completed':
                  {
                    const runChunk = chunk as RunCompleteChunk;
                    if (runChunk.usage) {
                      cbs.onUsage?.({
                        input: runChunk.usage.input_tokens,
                        output: runChunk.usage.output_tokens,
                        cacheRead: runChunk.usage.cache_read_tokens,
                        cacheWrite: runChunk.usage.cache_write_tokens,
                      });
                    }
                    cbs.onRunComplete?.({
                      sessionId: runChunk.session_id || '',
                      completed: runChunk.completed,
                      interrupted: runChunk.interrupted,
                      usage: runChunk.usage,
                    });
                  }
                  handled = true;
                  break;
                case 'assistant.completed':
                  // REMOVED: Hermes does NOT process this event.
                  // The 'done' event already triggers completeAssistantMessage
                  // via onDone. Processing assistant.completed here would:
                  // 1. Update fullTextRef with potentially stale content
                  // 2. Call onText('', fullText) which is a no-op for delta
                  //    but still touches fullTextRef, creating a race with onDone
                  // Hermes only uses message.complete → completeAssistantMessage.
                  handled = true;
                  break;
                case 'message.started':
                case 'usage':
                  handled = true;
                  break;
                case 'delegate.progress':
                  cbs.onDelegateProgress?.({
                    subagentId: chunk.subagent_id,
                    eventType: chunk.event_type,
                    taskIndex: chunk.task_index,
                    taskCount: chunk.task_count,
                    goal: chunk.goal,
                    toolName: chunk.tool_name,
                    toolPreview: chunk.tool_preview,
                    thinkingText: chunk.thinking_text,
                    progressSummary: chunk.progress_summary,
                    depth: chunk.depth,
                  });
                  handled = true;
                  break;
                case 'reasoning.completed':
                  // REMOVED: Hermes does NOT have this event.
                  // Reasoning lifecycle: reasoning.delta (append) + reasoning.available (replace).
                  // Processing reasoning.completed would fire onReasoningComplete which
                  // appends ANOTHER reasoning part, creating a second bubble.
                  handled = true;
                  break;
                case 'finish_reason':
                  handled = true;
                  break;
                default:
                  if (lastEventName) {
                    console.warn('[SSE] Unknown event:', lastEventName, chunk);
                  }
                  break;
              }

              if (handled) {
                lastEventName = '';
                if (result === 'done' || result === 'error') {
                  storeSetIsStreaming(false);
                  isStreamingRef.current = false;
                  controllerRef.current = null;
                  return;
                }
                continue;
              }

              // ── Fallback: unnamed events ──
              result = handleEvent(chunk, accumulators);
              if (eventCount <= 20) {
                console.log(`🔍 [SSE] handleEvent result=${result} fullText="${accumulators.fullText.slice(0, 50)}"`);
              }
              if (result === 'done' || result === 'error') {
                storeSetIsStreaming(false);
                isStreamingRef.current = false;
                controllerRef.current = null;
                return;
              }
              lastEventName = '';
            } catch (e) {
              console.warn(`🔍 [SSE] JSON parse error: dataStr="${dataStr.slice(0, 100)}" err=${(e as Error).message}`);
            }
          }
        }

        // Stream ended naturally
        storeSetIsStreaming(false);
        isStreamingRef.current = false;
        controllerRef.current = null;
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;
        attempt++;
        if (attempt > MAX_RETRIES) {
          cbs.onError?.((err as Error).message || '连接失败');
          break;
        }
        const delay = Math.pow(2, attempt - 1) * 1000;
        cbs.onError?.(`连接失败，${delay / 1000}s 后重试 (${attempt}/${MAX_RETRIES})…`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    storeSetIsStreaming(false);
    isStreamingRef.current = false;
    controllerRef.current = null;
  }, [handleEvent]);

  const abort = useCallback(async () => {
    // 中止 HTTP SSE 流
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    // 通知后端中止
    const sid = currentSessionRef.current;
    if (sid) {
      try {
        await call('abort_chat', { session_id: sid });
      } catch { /* ignore */ }
      currentSessionRef.current = null;
    }
    storeSetIsStreaming(false);
    isStreamingRef.current = false;

    const cbs = cbsRef.current;
    if (cbs?.onDone) {
      cbs.onDone(null);
    }
  }, []);

  return { isStreaming, send, abort };
}
