import { useRef, useCallback, useEffect } from 'react';
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
  onReasoningStart?: () => void
  onToolStart?: (data: { id: string | null; name: string; preview?: string }) => void
  onToolGenerating?: (name: string) => void
  onToolArgs?: (data: { id: string; delta: string; accumulated: string }) => void
  onToolEnd?: (data: { id: string | null; name: string; duration?: number; error?: boolean }) => void
  onUsage?: (data: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
    reasoning?: number
    total?: number
    apiCalls?: number
    contextUsed?: number
    contextMax?: number
    compressions?: number
  }) => void
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
  onSystemNotice?: (data: { text: string; level?: string; kind?: string; ttl_ms?: number; key?: string; id?: string }) => void
  onNoticeClear?: (data: { key: string }) => void
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
      // 兼容旧字段
      cache_read_tokens?: number
      cache_write_tokens?: number
    }
    mcp_servers: Array<{ name: string; status: string }>
    system_prompt: string
    // T5: pending_prompts — 对齐 Hermes _pending_prompt_payloads
    // 前端刷新后恢复交互弹窗（clarify/approval/sudo/secret/slash_confirm）
    pending_prompts?: {
      clarify?: { clarify_id: string; question: string; choices: string[]; awaiting_text: boolean }
      sudo_password?: { sudo_id: string; prompt: string }
      secret_capture?: { secret_id: string; env_var: string; prompt: string }
      terminal_read?: { read_id: string }
      slash_confirm?: { confirm_id: string; command: string }
      approval?: { request_id: string; command: string }
    }
  }) => void
  onDone?: (sessionId: string | null) => void
  onError?: (msg: string) => void
  onReasoningComplete?: (reasoning: string) => void
  onSessionReset?: (data: { old_session_id: string; new_session_id: string }) => void
  // 对齐 Eleve thinking_callback → thinking.delta 事件（Agent 思考状态，如"正在思考..."）
  onThinking?: (text: string) => void
  // P1: 工具进度通知（对齐 Hermes tool_progress_command → StreamChunk::ToolProgress）
  onToolProgress?: (data: { eventType: string; toolName: string; preview?: string; args?: unknown; duration?: number; error?: boolean; toolCallId?: string }) => void
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
  // Phase 6: 浏览器连接进度（对齐 Hermes browser.progress）
  onBrowserProgress?: (data: { message: string; level: string }) => void
  // Phase 6: 皮肤切换（对齐 Hermes skin.changed）
  onSkinChanged?: (data: { skin: unknown }) => void
  // Phase 6: 终端关闭（对齐 Hermes terminal.close）
  onTerminalClose?: (data: { process_id: string }) => void
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
      // 拆变体后: ReasoningStart 不带文本，只是"推理开始"通知
      cbs.onReasoningStart?.();
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
      cbs.onToolStart?.({ id: (chunk.toolCallId as string) || null, name: chunk.tool as string, preview: chunk.preview as string | undefined });
      break;

    // 对齐 Eleve: 流式响应中工具名确定、参数还在生成时触发（drafting spinner）
    case 'tool.generating':
      cbs.onToolGenerating?.((chunk.name as string) || '');
      break;

    case 'tool.complete':
      cbs.onToolEnd?.({ id: (chunk.toolCallId as string) || null, name: chunk.tool as string, duration: chunk.duration as number | undefined, error: chunk.error as boolean | undefined });
      break;

    case 'tool.failed': {
      // 工具执行失败（对齐 Eleve 后端独立 tool.failed 事件）
      cbs.onError?.((chunk.error as string) || `Tool ${chunk.tool || ''} failed`);
      break;
    }

    // P1: 工具进度（对齐 Hermes tool_progress_command → StreamChunk::ToolProgress）
    case 'tool.progress':
      cbs.onToolProgress?.({
        eventType: (chunk.event_type as string) || '',
        toolName: (chunk.tool as string) || (chunk.tool_name as string) || '',
        preview: chunk.preview as string | undefined,
        args: chunk.args,
        duration: chunk.duration as number | undefined,
        error: chunk.error as boolean | undefined,
        toolCallId: chunk.toolCallId as string | undefined,
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

    case 'notification.show':
      cbs.onSystemNotice?.({ text: chunk.text as string, level: chunk.level as string | undefined, kind: chunk.kind as string | undefined, ttl_ms: chunk.ttl_ms as number | undefined, key: chunk.key as string | undefined, id: chunk.id as string | undefined });
      break;

    case 'notification.clear':
      cbs.onNoticeClear?.({ key: chunk.key as string });
      break;

    // Phase 6: 浏览器连接进度（对齐 Hermes browser.progress）
    case 'browser.progress':
      cbs.onBrowserProgress?.({ message: chunk.message as string, level: chunk.level as string });
      break;

    // Phase 6: 皮肤切换（对齐 Hermes skin.changed）
    case 'skin.changed':
      cbs.onSkinChanged?.({ skin: chunk.skin });
      break;

    // Phase 6: 终端关闭（对齐 Hermes terminal.close）
    case 'terminal.close':
      cbs.onTerminalClose?.({ process_id: chunk.process_id as string });
      break;

    // Phase 6G: 终端读取请求（对齐 Hermes terminal.read.request）
    // Agent 调 read_terminal → Gateway 推 terminal.read.request → 前端读 xterm buffer → 回复 terminal.read.respond
    case 'terminal.read.request': {
      const requestId = typeof chunk.request_id === 'string' ? chunk.request_id : '';
      if (requestId) {
        const startLine = typeof chunk.start === 'number' ? chunk.start : undefined;
        const count = typeof chunk.count === 'number' ? chunk.count : undefined;
        // IIFE async — processEvent 本身非 async
        (async () => {
          const { readActiveTerminal } = await import('@/store/terminal-buffer');
          const result = readActiveTerminal({ start: startLine, count });
          const { getWsClient } = await import('@/services/ws-client');
          const wsClient = getWsClient();
          wsClient.sendRpc('terminal.read.respond', {
            request_id: requestId,
            text: result ? JSON.stringify(result) : '',
          }).catch(() => { /* ignore send failure */ });
        })();
      }
      break;
    }

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
        mcp_servers: (chunk.mcp_servers as any as Array<{ name: string; status: string }>) || [],
        system_prompt: (chunk.system_prompt as string) || '',
        // T5: pending_prompts — 透传给回调消费
        pending_prompts: chunk.pending_prompts as any,
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
          reasoning: (chunk.usage as any).reasoning_tokens,
          total: (chunk.usage as any).total_tokens,
          apiCalls: (chunk.usage as any).api_calls,
          contextUsed: (chunk.usage as any).context_used,
          contextMax: (chunk.usage as any).context_max,
          compressions: (chunk.usage as any).compressions,
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
        reasoning: (chunk.usage as any)?.reasoning_tokens,
        total: (chunk.usage as any)?.total_tokens,
        apiCalls: (chunk.usage as any)?.api_calls,
        contextUsed: (chunk.usage as any)?.context_used,
        contextMax: (chunk.usage as any)?.context_max,
        compressions: (chunk.usage as any)?.compressions,
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
    console.log('[useSSE.send] sessionId:', sessionId, 'wsState:', getWsClient().state);
    storeSetIsStreaming(true);
    isStreamingRef.current = true;

    // 记录当前流式会话 ID，abort 时使用
    currentSessionRef.current = sessionId ?? null;

    const cbs = cbsRef.current;

    // ── WS only：对齐 Hermes TUI，无 HTTP 降级 ──
    // Hermes Desktop 做法参考 (use-gateway-request.ts):
    //   1. WS 断了 → 先重连 (ensureGatewayOpen)
    //   2. 重连成功 → 重试请求
    //   3. 重连失败 → 才报错
    const wsClient = getWsClient();
    if (wsClient.state !== 'connected') {
      // 对齐 Hermes Desktop use-gateway-request.ts:
      // WS 断了 → 先触发重连，而不是等
      if (wsClient.state === 'disconnected' && sessionId) {
        // 主动重连
        console.log('[useSSE] WS disconnected, triggering reconnect for session:', sessionId.slice(0, 8));
        wsClient.connect(sessionId, {
          onOpen: () => console.log('[useSSE] WS reconnected'),
          onClose: (code, reason) => console.log('[useSSE] WS closed:', code, reason),
          onError: (err) => console.error('[useSSE] WS error:', err),
        });
      }
      // 等待重连完成（最多 10 秒）
      const connected = await wsClient.waitForConnected(10000);
      if (!connected) {
        console.error('[useSSE] WS not connected after waiting 10s');
        storeSetIsStreaming(false);
        isStreamingRef.current = false;
        if (cbs?.onError) {
          cbs.onError('连接断开，正在重连，请稍后重试');
        }
        return;
      }
    }

    // 重置 WS 累加器
    wsAccumulatorsRef.current = { fullText: '', fullReasoning: '', pendingTools: {} };

    try {
      await wsClient.promptSubmit(text, sessionId || undefined);
      return; // WS 发送成功，事件通过 routeWsEvent 回调
    } catch (wsErr) {
      console.error('[useSSE] WS prompt.submit failed:', wsErr);
      storeSetIsStreaming(false);
      isStreamingRef.current = false;
      if (cbs?.onError) {
        cbs.onError(`发送失败: ${(wsErr as Error).message}`);
      }
      return;
    }
  }, []);

  const abort = useCallback(async () => {
    // ── WS only：对齐 Hermes TUI，无 HTTP 降级 ──
    const wsClient = getWsClient();
    if (wsClient.state === 'connected') {
      try {
        await wsClient.abortStream(currentSessionRef.current || undefined);
      } catch { /* ignore */ }
    }

    currentSessionRef.current = null;
    storeSetIsStreaming(false);
    isStreamingRef.current = false;

    const cbs = cbsRef.current;
    if (cbs?.onDone) {
      cbs.onDone(null);
    }
  }, []);

  return { isStreaming, send, abort };
}
