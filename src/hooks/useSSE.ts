import { useRef, useCallback, useEffect } from 'react';
import { getApiBase } from '../utils/api';
import { call } from '../utils/bridge';
import { useIsStreaming, setIsStreaming as storeSetIsStreaming } from '@/store/messages';
import { getWsClient } from '@/services/ws-client';

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
  onToolGenerating?: (name: string) => void
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
    goal?: string; toolName?: string; toolArgs?: Record<string, unknown>; toolPreview?: string; thinkingText?: string
    progressSummary?: string; depth?: number
    parentId?: string; model?: string; toolsets?: string[]; childSessionId?: string; toolCount?: number
    status?: string; durationSeconds?: number; summary?: string
    inputTokens?: number; outputTokens?: number; reasoningTokens?: number; apiCalls?: number
    filesRead?: string[]; filesWritten?: string[]; outputTail?: unknown[]; costUsd?: number; exitReason?: string
  }) => void
  onSystemNotice?: (data: { message: string; level?: string }) => void
  onStatusUpdate?: (data: { kind: string; text: string }) => void
  onClarify?: (data: { clarify_id: string; question: string; choices?: string[] }) => void
  onApproval?: (data: unknown) => void
  onApprovalResponded?: (data: { run_id: string; choice: string; resolved: number }) => void
  onSudo?: (data: { request_id: string; prompt?: string }) => void
  onSecret?: (data: { request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> }) => void
  onSessionInfo?: (data: {
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
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cache_write_tokens?: number }
    mcp_servers: unknown[]
    system_prompt: string
  }) => void
  onDone?: (sessionId: string | null) => void
  onError?: (msg: string) => void
  onReasoningComplete?: (reasoning: string) => void
  onSessionReset?: (data: { old_session_id: string; new_session_id: string }) => void
  // 对齐 Eleve thinking_callback → thinking.delta 事件（Agent 思考状态，如"正在思考..."）
  onThinking?: (text: string) => void
  // P1: 工具进度通知（对齐 Hermes tool_progress_command → StreamChunk::ToolProgress）
  onToolProgress?: (data: { eventType: string; toolName: string; preview?: string; args?: unknown }) => void
  // P1: Fallback 已激活（对齐 Hermes fallback 通知，前端可显示 provider 切换提示）
  onFallbackActivated?: (data: { model: string; provider: string }) => void
  // P1: 文本段结束（对齐 Hermes stream_delta_callback(None)，关闭当前流式显示框）
  onSectionEnd?: () => void
  // P1: 步骤完成（对齐 Hermes step_callback，含工具执行结果摘要）
  onStepComplete?: (data: { stepNumber: number; toolResults: Array<{ toolName: string; success: boolean }> }) => void
  // P1: 中间助手消息（对齐 Hermes _emit_interim_assistant_message）
  onInterimMessage?: (data: { content: string; alreadyStreamed: boolean }) => void
  // P1: 后台 Review 结果（对齐 Hermes background_review_callback）
  onBackgroundReview?: (data: { summary: string }) => void
}

// ── Chunk types (from Rust StreamChunk / api_server) ──

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

// ── 统一事件路由函数 ──
// SSE 和 WS 共用，事件名已统一为 Eleve 标准
// 返回 'done' | 'error' | undefined

function processEvent(
  eventName: string,
  chunk: Record<string, unknown>,
  acc: SSEAccumulators,
  cbs: SSECallbacks,
): string | undefined {
  switch (eventName) {
    // ── 文本 delta（对齐 Eleve: message.delta）──
    case 'message.delta':
      acc.fullText += (chunk.delta as string) || '';
      cbs.onText?.((chunk.delta as string) || '', acc.fullText);
      break;

    // ── 推理 ──
    case 'reasoning.delta':
      acc.fullReasoning += (chunk.text as string) || '';
      cbs.onReasoning?.((chunk.text as string) || '', acc.fullReasoning);
      break;

    case 'reasoning.available':
      // 对齐 Eleve: reasoning.available = REPLACE, not append
      cbs.onReasoningReplace?.((chunk.text as string) || '');
      break;

    // ── 推理结束（对齐 Hermes: reasoning块结束 → 清reasoning状态）──
    case 'reasoning.end':
      cbs.onReasoningComplete?.(acc.fullReasoning);
      break;

    // ── Agent 思考状态（对齐 Eleve thinking_callback → thinking.delta）──
    case 'thinking.delta':
      cbs.onThinking?.((chunk.text as string) || '');
      break;

    // ── 工具（对齐 Eleve 通道 A: tool.start / tool.complete）──
    case 'tool.start':
      cbs.onToolStart?.({ id: (chunk.tool_id as string) || null, name: chunk.tool_name as string });
      break;

    // 对齐 Eleve: 流式响应中工具名确定、参数还在生成时触发（drafting spinner）
    case 'tool.generating':
      cbs.onToolGenerating?.((chunk.name as string) || '');
      break;

    case 'tool.complete':
      cbs.onToolEnd?.({ id: (chunk.tool_id as string) || null, name: chunk.tool_name as string });
      break;

    case 'tool.failed': {
      // 工具执行失败（对齐 Eleve 后端独立 tool.failed 事件）
      cbs.onError?.((chunk.error as string) || `Tool ${chunk.tool_name || chunk.tool || ''} failed`);
      break;
    }

    // P1: 工具进度（对齐 Hermes tool_progress_command → StreamChunk::ToolProgress）
    case 'tool.progress':
      cbs.onToolProgress?.({
        eventType: (chunk.event_type as string) || '',
        toolName: (chunk.tool as string) || (chunk.tool_name as string) || '',
        preview: chunk.preview as string | undefined,
        args: chunk.args,
      });
      break;

    // P1: Fallback 已激活（对齐 Hermes fallback 通知）
    case 'fallback.activated':
      cbs.onFallbackActivated?.({
        model: (chunk.model as string) || '',
        provider: (chunk.provider as string) || '',
      });
      break;

    // P1: 文本段结束（对齐 Hermes stream_delta_callback(None)，关闭当前流式显示框）
    case 'assistant.section_end':
      cbs.onSectionEnd?.();
      break;

    // P1: 步骤完成（对齐 Hermes step_callback）
    case 'step.complete':
      cbs.onStepComplete?.({
        stepNumber: (chunk.step_number as number) || 0,
        toolResults: (chunk.tool_results as Array<{ tool_name: string; success: boolean }>)?.map(r => ({
          toolName: r.tool_name,
          success: r.success,
        })) || [],
      });
      break;

    // P1: 中间助手消息（对齐 Hermes _emit_interim_assistant_message）
    case 'interim.message':
      cbs.onInterimMessage?.({
        content: (chunk.content as string) || '',
        alreadyStreamed: (chunk.already_streamed as boolean) || false,
      });
      break;

    // P1: 后台 Review 结果（对齐 Hermes background_review_callback）
    case 'background.review':
      cbs.onBackgroundReview?.({
        summary: (chunk.summary as string) || '',
      });
      break;

    // ── 委托 ──
    case 'delegate.start':
      cbs.onDelegateStart?.({ taskId: chunk.task_id as string, goal: chunk.goal as string | undefined, model: chunk.model as string | undefined });
      break;

    case 'delegate.end':
      cbs.onDelegateEnd?.({
        taskId: chunk.task_id as string,
        status: chunk.status as string | undefined,
        summary: chunk.summary as string | undefined,
        model: chunk.model as string | undefined,
        tokensInput: chunk.tokens_input as number | undefined,
        tokensOutput: chunk.tokens_output as number | undefined,
        duration: chunk.duration_secs as number | undefined,
      });
      break;

    case 'delegate.progress':
      cbs.onDelegateProgress?.({
        subagentId: chunk.subagent_id as string | undefined,
        eventType: chunk.event_type as string | undefined,
        taskIndex: chunk.task_index as number | undefined,
        taskCount: chunk.task_count as number | undefined,
        goal: chunk.goal as string | undefined,
        toolName: chunk.tool_name as string | undefined,
        toolArgs: chunk.tool_args as Record<string, unknown> | undefined,
        toolPreview: chunk.tool_preview as string | undefined,
        thinkingText: chunk.thinking_text as string | undefined,
        progressSummary: chunk.progress_summary as string | undefined,
        depth: chunk.depth as number | undefined,
        // 🔴 对齐Hermes _identity_kwargs
        parentId: chunk.parent_id as string | undefined,
        model: chunk.model as string | undefined,
        toolsets: chunk.toolsets as string[] | undefined,
        childSessionId: chunk.child_session_id as string | undefined,
        toolCount: chunk.tool_count as number | undefined,
        // 🔴 对齐Hermes complete_kwargs: 完成事件字段
        status: chunk.status as string | undefined,
        durationSeconds: chunk.duration_seconds as number | undefined,
        summary: chunk.summary as string | undefined,
        inputTokens: chunk.input_tokens as number | undefined,
        outputTokens: chunk.output_tokens as number | undefined,
        reasoningTokens: chunk.reasoning_tokens as number | undefined,
        apiCalls: chunk.api_calls as number | undefined,
        filesRead: chunk.files_read as string[] | undefined,
        filesWritten: chunk.files_written as string[] | undefined,
        outputTail: chunk.output_tail as unknown[] | undefined,
        costUsd: chunk.cost_usd as number | undefined,
        exitReason: chunk.exit_reason as string | undefined,
      });
      break;

    // ── 模型 / 系统 ──
    case 'model.name': {
      const name = typeof chunk.name === 'string' ? chunk.name : (typeof chunk === 'object' && chunk !== null && chunk.name ? String(chunk.name) : String(chunk));
      cbs.onModelName?.(name);
      break;
    }

    case 'system.notice':
      cbs.onSystemNotice?.({ message: chunk.message as string, level: chunk.level as string | undefined });
      break;

    case 'status.update': {
      // 合并两个重复case — 通用 status.update + lifecycle reset 分发
      const kind = chunk.kind as string;
      cbs.onStatusUpdate?.({ kind, text: chunk.text as string });
      if (kind === 'lifecycle') {
        cbs.onSessionReset?.({ old_session_id: '', new_session_id: chunk.new_session_id as string });
      }
      break;
    }

    // ── 交互 ──
    case 'clarify.request':
      cbs.onClarify?.({ clarify_id: chunk.clarify_id as string, question: chunk.question as string, choices: chunk.choices as string[] | undefined });
      break;

    case 'approval.request':
      cbs.onApproval?.(chunk);
      break;

    case 'approval.responded':
      cbs.onApprovalResponded?.(chunk as any);
      break;

    case 'sudo.request':
      cbs.onSudo?.({ request_id: chunk.request_id as string, prompt: chunk.prompt as string | undefined });
      break;

    case 'secret.request':
      cbs.onSecret?.({ request_id: chunk.request_id as string, prompt: chunk.prompt as string, env_var: chunk.env_var as string, metadata: chunk.metadata as Record<string, unknown> | undefined });
      break;

    // ── 会话 ──
    case 'session.info':
      cbs.onSessionInfo?.({
        session_id: (chunk.session_id as string) || '',
        run_id: (chunk.run_id as string) || '',
        model: (chunk.model as string) || '',
        provider: (chunk.provider as string) || '',
        cwd: (chunk.cwd as string) || '',
        branch: chunk.branch as string | null,
        running: (chunk.running as boolean) || false,
        title: (chunk.title as string) || '',
        version: (chunk.version as string) || '',
        reasoning_effort: (chunk.reasoning_effort as string) || '',
        service_tier: (chunk.service_tier as string) || '',
        fast: (chunk.fast as boolean) || false,
        yolo: (chunk.yolo as boolean) || false,
        personality: (chunk.personality as string) || '',
        desktop_contract: (chunk.desktop_contract as string) || '',
        release_date: (chunk.release_date as string) || '',
        update_behind: chunk.update_behind as number | null,
        update_command: (chunk.update_command as string) || '',
        profile_name: (chunk.profile_name as string) || '',
        credential_warning: typeof chunk.credential_warning === 'boolean' ? chunk.credential_warning as boolean : null,
        tools: (chunk.tools as Record<string, unknown>) || {},
        skills: (chunk.skills as Record<string, unknown>) || {},
        usage: chunk.usage as any,
        mcp_servers: (chunk.mcp_servers as unknown[]) || [],
        system_prompt: (chunk.system_prompt as string) || '',
      });
      break;

    // ── 流生命周期 ──
    // 对齐 Hermes: message.start → onRunStart（分配streamId）
    case 'message.start':
    case 'run.started':
      cbs.onRunStart?.(chunk.session_id as string);
      break;

    case 'error':
      cbs.onError?.((chunk.message as string) || 'Unknown error');
      return 'error';

    case 'message.complete':
      // message.complete 替代 done + run.completed（对齐 Phase 4）
      if (chunk.usage) {
        cbs.onUsage?.({
          input: (chunk.usage as any).input_tokens,
          output: (chunk.usage as any).output_tokens,
          cacheRead: (chunk.usage as any).cache_read_tokens,
          cacheWrite: (chunk.usage as any).cache_write_tokens,
        });
      }
      // 中断处理（原 onRunComplete 的中断逻辑）
      if (chunk.interrupted) {
        cbs.onRunComplete?.({
          sessionId: chunk.session_id as string || '',
          completed: false,
          interrupted: true,
          usage: chunk.usage,
        });
      }
      cbs.onDone?.(chunk.session_id as string | null);
      return 'done';

    case 'dequeue':
      cbs.onText?.((chunk.text as string) || '', '');
      break;

    // ── 用量汇总（对齐 Hermes: Done时推送usage统计）──
    case 'usage.summary':
      cbs.onUsage?.({
        input: (chunk.usage as any)?.input_tokens,
        output: (chunk.usage as any)?.output_tokens,
        cacheRead: (chunk.usage as any)?.cache_read_tokens,
        cacheWrite: (chunk.usage as any)?.cache_write_tokens,
      });
      break;

    // ── 静默事件（WS/SSE 路由中不需要额外处理）──
    case 'usage':
    case 'finish_reason':
    case 'rate_limit':
      break;

    default:
      console.warn('[useSSE] Unknown event:', eventName, chunk);
      break;
  }

  return undefined;
}

/**
 * SSE streaming hook v2 — 统一事件路由
 *
 * WS 和 SSE 路径共用 processEvent()，事件名已统一为 Eleve 标准。
 */
export function useSSE(callbacks: SSECallbacks = {}): {
  isStreaming: boolean
  send: (text: string, sessionId?: string | null) => Promise<void>
  abort: () => Promise<void>
} {
  const isStreaming = useIsStreaming();
  const controllerRef = useRef<AbortController | null>(null);
  const currentSessionRef = useRef<string | null>(null);
  const isStreamingRef = useRef(false);
  const cbsRef = useRef<SSECallbacks>(callbacks);
  cbsRef.current = callbacks;

  // ── WS accumulator ref — WS 事件与 SSE 共享累加器 ──
  const wsAccumulatorsRef = useRef<SSEAccumulators>({
    fullText: '',
    fullReasoning: '',
    pendingTools: {},
  });

  // ── WS 事件 → 统一路由 ──
  const routeWsEvent = useCallback((eventName: string, data: unknown) => {
    const cbs = cbsRef.current;
    const acc = wsAccumulatorsRef.current;
    const raw = data as Record<string, unknown>;
    if (!raw) return;

    // WS payload 内聚：业务数据在 payload 字段下（对齐 Hermes _emit 格式）
    // Hermes: params = {type, session_id, payload: {...}}
    // SSE 路径无 payload 包装，直接用 data
    const chunkBase = (raw.payload && typeof raw.payload === 'object' ? raw.payload : raw) as Record<string, unknown>;
    // 🔴 对齐 Hermes：session_id/run_id 在 params 顶层（raw），不在 payload 中
    // 注入到 chunk 中，使 processEvent 的回调能正确读取 session_id
    const chunk: Record<string, unknown> = {
      ...chunkBase,
      ...(raw.session_id != null && chunkBase.session_id == null ? { session_id: raw.session_id } : {}),
      ...(raw.run_id != null && chunkBase.run_id == null ? { run_id: raw.run_id } : {}),
    };

    const result = processEvent(eventName, chunk, acc, cbs);

    // done/error 清理流式状态
    if (result === 'done' || result === 'error') {
      storeSetIsStreaming(false);
      isStreamingRef.current = false;
      controllerRef.current = null;
    }
  }, []);

  // ── WS 连接生命周期 ──
  useEffect(() => {
    const wsClient = getWsClient();

    // 注册事件监听器 — WS 推送 → routeWsEvent → processEvent → SSECallbacks
    wsClient.addEventListener(routeWsEvent);

    // 重连恢复回调：WS 重连成功后请求 session.info
    // 对齐 Eleve: gateway.ready → session.resume
    const handleWsOpen = (wasReconnect: boolean) => {
      if (wasReconnect) {
        const sid = currentSessionRef.current;
        if (sid) {
          wsClient.sendRpc('session.info', { session_id: sid }).catch(() => {});
        }
      }
    };
    wsClient.setReconnectCallback(handleWsOpen);

    return () => {
      wsClient.removeEventListener(routeWsEvent);
      wsClient.setReconnectCallback(null);
    };
  }, [routeWsEvent]);

  const send = useCallback(async (text: string, sessionId?: string | null): Promise<void> => {
    if (!text?.trim()) return;
    storeSetIsStreaming(true);
    isStreamingRef.current = true;

    // 记录当前流式会话 ID，abort 时使用
    currentSessionRef.current = sessionId ?? null;

    const cbs = cbsRef.current;

    // ── WS 优先：通过 JSON-RPC prompt.submit 发送 ──
    const wsClient = getWsClient();
    // 对齐 Hermes: 首次发消息时 session 刚创建，WS 可能还在连接中
    // 等待最多 2 秒让 WS 连上，避免走 HTTP 降级（SSE 格式不兼容）
    if (wsClient.state !== 'connected' && wsClient.state !== 'disconnected') {
      const connected = await wsClient.waitForConnected(2000);
      if (connected) {
        console.log('[useSSE] WS connected after waiting, using WS path');
      }
    }
    if (wsClient.state === 'connected') {
      // 重置 WS 累加器
      wsAccumulatorsRef.current = { fullText: '', fullReasoning: '', pendingTools: {} };

      try {
        await wsClient.promptSubmit(text, sessionId || undefined);
        return; // WS 发送成功，事件通过 routeWsEvent 回调
      } catch (wsErr) {
        console.warn('[useSSE] WS prompt.submit failed, falling back to SSE:', wsErr);
        // 降级到 HTTP SSE
      }
    }

    // ── 降级：HTTP SSE ──
    const accumulators: SSEAccumulators = {
      fullText: '',
      fullReasoning: '',
      pendingTools: {},
    };

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
        const resp = await fetch(`${apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: text }],
            stream: true,
            session_id: sessionId || null,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          // 人性化错误消息
          let userMsg: string;
          switch (resp.status) {
            case 401:
              userMsg = 'API Key 无效或未配置，请在设置中检查';
              break;
            case 403:
              userMsg = '访问被拒绝，请检查 API Key 权限';
              break;
            case 404:
              userMsg = '模型不存在或 API 地址不正确';
              break;
            case 429:
              userMsg = '请求过于频繁，请稍后再试';
              break;
            case 500:
            case 502:
            case 503:
              userMsg = '服务端错误，请稍后重试';
              break;
            default:
              userMsg = `请求失败 (HTTP ${resp.status})`;
          }
          throw new Error(userMsg);
        }
        if (!resp.body) throw new Error('不支持流式响应');

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastEventName = '';
        let eventCount = 0;
        let doneReceived = false;
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
            controller.abort();
            cbs.onError?.((timeoutErr as Error).message);
            break;
          }

          const { done, value } = readResult;
          if (done) {
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

            // 防御: 空 data 行
            if (!dataStr) continue;

            try {
              const chunk = JSON.parse(dataStr);

              // ── OpenAI SSE 格式兼容（SSE 降级路径）──
              // chat/completions 返回 OpenAI 格式（无 event: 行），
              // 需要转换为 Eleve 标准事件名才能被 processEvent 处理
              let effectiveEventName = lastEventName;
              let effectiveChunk = chunk;
              if (!effectiveEventName && chunk.object === 'chat.completion.chunk') {
                const choice = chunk.choices?.[0];
                if (choice?.finish_reason === 'stop') {
                  effectiveEventName = 'message.complete';
                  effectiveChunk = { completed: true };
                } else if (choice?.delta?.role === 'assistant') {
                  // role chunk — 忽略，不需要处理
                  lastEventName = '';
                  continue;
                } else if (choice?.delta?.content != null) {
                  effectiveEventName = 'message.delta';
                  effectiveChunk = { delta: choice.delta.content };
                } else if (choice?.delta?.reasoning_content != null) {
                  effectiveEventName = 'reasoning.delta';
                  effectiveChunk = { text: choice.delta.reasoning_content };
                }
              }

              // ── 统一路由 ──
              const result = processEvent(effectiveEventName, effectiveChunk, accumulators, cbs);

              if (result === 'done' || result === 'error') {
                if (result === 'done') doneReceived = true;
                storeSetIsStreaming(false);
                isStreamingRef.current = false;
                controllerRef.current = null;
                return;
              }
              lastEventName = '';
            } catch (e) {
              console.warn(`[SSE] JSON parse error: ${(e as Error).message}`);
            }
          }
        }

        // Stream ended naturally — 可能未收到 done
        if (!doneReceived) {
          cbs.onDone?.(null);
        }
        storeSetIsStreaming(false);
        isStreamingRef.current = false;
        controllerRef.current = null;
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;
        attempt++;
        if (attempt > MAX_RETRIES) {
          const errMsg = (err as Error).message || '';
          let userMsg: string;
          if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch failed')) {
            userMsg = '无法连接 Agent 服务，请检查是否已配置 API Key 和主模型';
          } else if (errMsg.includes('API Key') || errMsg.includes('无效')) {
            userMsg = errMsg;
          } else {
            userMsg = errMsg || '连接失败，请检查配置';
          }
          cbs.onError?.(userMsg);
          break;
        }
        const delay = Math.pow(2, attempt - 1) * 1000;
        cbs.onError?.(`连接失败，${delay / 1000}s 后重试 (${attempt}/${MAX_RETRIES})…`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    storeSetIsStreaming(false);
    isStreamingRef.current = false;
  }, []);

  const abort = useCallback(async () => {
    // ── WS 优先：JSON-RPC abort ──
    const wsClient = getWsClient();
    if (wsClient.state === 'connected') {
      try {
        await wsClient.abortStream(currentSessionRef.current || undefined);
      } catch { /* ignore */ }
    }

    // 中止 HTTP SSE 流（降级路径）
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    // 通知后端中止（SSE 路径）
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
