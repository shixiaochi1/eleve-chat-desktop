import { useRef, useCallback, useEffect } from 'react';
import { useIsStreaming, setIsStreaming as storeSetIsStreaming, getIsStreaming } from '@/store/messages';
import { getWsClient } from '@/services/ws-client';
import { handleGlobalEvent } from '@/lib/global-events';
import { notifyExternalChange } from '@/lib/workspace-events';
import { persistSessionPointer } from '../utils/session';
import { createAccumulator, resetAccumulator, resetAccumulatorForStep, finalizeAccumulator, processAccumulatorEvent, type StreamAccumulator } from '@/lib/ws-event-processor';
import type { ChatMessagePart } from '@/lib/chat-messages';

// ── SSE callback types ──
// 🔴 累加器已迁移到 ws-event-processor StreamAccumulator（单一权威源）
// SSEAccumulators 已删除（pendingTools 是死状态，fullText/fullReasoning 对应 acc.text/acc.reasoning）

export interface SSECallbacks {
  onText?: (delta: string) => void
  onReasoning?: (delta: string) => void
  // 🔴 2026-08-08 对齐 Hermes：available = 推理块完成后的摘要（带 text，replace 语义）。
  // 原 onReasoningStart（推理开始空占位）与 onReasoningComplete（reasoning.end 冻结）已随
  // Hermes 基线合并为此单一回调（Hermes 无 reasoning.end，available 即完成态）。
  onReasoningAvailable?: (text: string) => void
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
  /** 🔴 2026-08-13 对齐修复：项目数据变化（工具 create/switch/delete/active）→ 前端刷新项目树 */
  onProjectsChanged?: () => void
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
    // C-5: inflight turn 快照（对齐 Hermes _inflight_snapshot L7549）——
    // 断线重连时携带 failed turn（error/status/recoverable + 部分文本），
    // 前端重建失败气泡（错误语义优先，不把部分文本当健康回复）
    inflight?: {
      user?: string
      assistant?: string
      streaming?: boolean
      error?: string
      status?: string
      recoverable?: boolean
    }
    // T5: pending_prompts — 对齐 Hermes _pending_prompt_payloads
    // 前端刷新后恢复交互弹窗（clarify/approval/sudo/secret/slash_confirm）
    pending_prompts?: {
      clarify?: { clarify_id: string; question: string; choices: string[]; awaiting_text: boolean }
      sudo_password?: { sudo_id: string; prompt: string }
      secret_capture?: { secret_id: string; env_var: string; prompt: string }
      terminal_read?: { read_id: string }
      slash_confirm?: { confirm_id: string; command: string }
      approval?: { request_id: string; command: string; choices?: string[] }
    }
  }) => void
  onDone?: (sessionId: string | null, failure?: { error: string; partial: boolean }) => void
  onError?: (msg: string) => void
  /** 后端自动创建 session 后通知前端更新 sessionId（架构原则：后端是权威源） */
  onSessionCreated?: (newSessionId: string) => void
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
  // E-3: MoA 参考模型输出（对齐 Hermes moa.reference — 带标签推理块）
  onMoaReference?: (data: { index?: number; count?: number; label: string; text: string }) => void
  // E-3: MoA 聚合开始（对齐 Hermes moa.phase aggregator）
  onMoaAggregating?: (data: { aggregator?: string; refCount?: number }) => void
  // P1: 后台 Review 结果（对齐 Hermes background_review_callback）
  onBackgroundReview?: (data: { summary: string }) => void
  // Phase 6: 浏览器连接进度（对齐 Hermes browser.progress）
  onBrowserProgress?: (data: { message: string; level: string }) => void
  // Phase 6: 主题切换（对齐 Hermes theme.changed，由 display.accent/appearance 驱动）
  onThemeChanged?: (data: { accent?: string; appearance?: string }) => void
  // Phase 6: 终端关闭（对齐 Hermes terminal.close）
  onTerminalClose?: (data: { process_id: string }) => void
  // reaction — 用户 affection（ily / <3 / good bot / 心形 emoji，对齐 Hermes reaction 事件）
  // 纯 UI 彩蛋：前端播放爱心动画，永不触碰对话
  onReaction?: (data: { kind: string }) => void
  // wake.detected — 唤醒词命中（对齐 Hermes wake.detected → 提示音 + 开新会话）
  onWakeDetected?: (data: { phrase: string; start_new_session?: boolean }) => void
  // voice.interrupted — full-duplex barge-in 打断（对齐 Hermes voice.interrupted）
  onVoiceInterrupted?: (data: Record<string, unknown>) => void
  // Agent 后台进程输出流（对齐 Hermes agent.terminal.output）
  onAgentTerminalOutput?: (data: { process_id: string; chunk: string }) => void
  // 对齐 Hermes pending_title: 后端应用 pending_title 后推送 session.title 事件
  onSessionTitle?: (data: { session_id: string; title: string }) => void
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
  acc: StreamAccumulator,
  cbs: SSECallbacks,
): string | undefined {
  switch (eventName) {
    // ── 文本 delta（对齐 Eleve: message.delta）──
    // 🔴 累加器走共享处理器（与宫格 useGridChat 同一权威路径）
    case 'message.delta': {
      const delta = (chunk.delta as string) || '';
      processAccumulatorEvent(acc, eventName, chunk);
      cbs.onText?.(delta);
      break;
    }

    // ── 推理 ──
    case 'reasoning.delta': {
      const delta = (chunk.text as string) || '';
      processAccumulatorEvent(acc, eventName, chunk);
      cbs.onReasoning?.(delta);
      break;
    }

    case 'reasoning.available':
      // 🔴 2026-08-08 对齐 Hermes：available = 推理块完成后的摘要（后端带 text），
      // replace 语义（对齐 Hermes appendReasoningDelta(text, true)）。
      processAccumulatorEvent(acc, eventName, chunk);
      cbs.onReasoningAvailable?.((chunk.text as string) || '');
      break;

    // 🔴 reasoning.end 已删除（2026-08-08 对齐 Hermes：Hermes 无此事件，
    // 块冻结由 reasoning.available 完成态 replace 承担）

    // ── Agent 思考状态（对齐 Eleve thinking_callback → thinking.delta）──
    case 'thinking.delta':
      cbs.onThinking?.((chunk.text as string) || '');
      break;

    // ── 工具（对齐 Eleve 通道 A: tool.start / tool.complete）──
    // 🔴 累加器走共享处理器（upsertToolPart），回调保留（useMessageStream 消费）
    case 'tool.start':
      processAccumulatorEvent(acc, eventName, chunk);
      cbs.onToolStart?.({ id: (chunk.toolCallId as string) || null, name: chunk.tool as string, preview: chunk.preview as string | undefined });
      break;

    // 对齐 Eleve: 流式响应中工具名确定、参数还在生成时触发（drafting 状态）
    // 🔴 2026-08-11 对齐 Hermes gateway-event.ts:830：generating 是状态不是工具行——
    // 不进累加器（否则残留无参数幽灵卡，与 tool.start 双卡并存 = 重复调用显示层根因），
    // 只走 onToolGenerating 回调（statusText 状态提示）。
    case 'tool.generating':
      cbs.onToolGenerating?.((chunk.name as string) || '');
      break;

    case 'tool.complete':
      processAccumulatorEvent(acc, eventName, chunk);
      cbs.onToolEnd?.({ id: (chunk.toolCallId as string) || null, name: chunk.tool as string, duration: chunk.duration as number | undefined, error: chunk.error as boolean | undefined });
      break;

    case 'tool.failed': {
      processAccumulatorEvent(acc, eventName, chunk);
      // 🔴 P0-3: tool.failed 是可恢复事件（错误回喂模型继续跑），不路由到 onError。
      // onError 会终止流 + 误发排队消息 + 弹错误 toast，语义完全错误。
      // 走 onToolEnd(error:true) 让 ToolEntry 渲染错误状态（isError 三值），流继续。
      cbs.onToolEnd?.({ id: (chunk.toolCallId as string) || null, name: chunk.tool as string, duration: chunk.duration as number | undefined, error: true });
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
    // 🔴 Phase 1: 步骤级重置（保留 sawStepComplete 标记 — 禁用整轮终稿兜底，防 P1-8 文本重复）
    case 'step.complete':
      resetAccumulatorForStep(acc);
      cbs.onStepComplete?.({
        stepNumber: (chunk.step_number as number) || 0,
        toolResults: (chunk.tool_results as Array<{ tool_name: string; success: boolean }>)?.map(r => ({
          toolName: r.tool_name,
          success: r.success,
        })) || [],
      });
      break;

    // P1: 中间助手消息（对齐 Hermes _emit_interim_assistant_message）
    case 'message.interim':
      cbs.onInterimMessage?.({
        content: (chunk.content as string) || '',
        alreadyStreamed: (chunk.already_streamed as boolean) || false,
      });
      break;

    // ── E-3: MoA 参考模型输出（对齐 Hermes moa.reference，累加器已处理）──
    case 'moa.reference':
      processAccumulatorEvent(acc, eventName, chunk);
      cbs.onMoaReference?.({
        index: typeof chunk.index === 'number' ? chunk.index : undefined,
        count: typeof chunk.count === 'number' ? chunk.count : undefined,
        label: (chunk.label as string) || 'reference',
        text: (chunk.text as string) || '',
      });
      break;

    // ── E-3: MoA 聚合开始（对齐 Hermes moa.phase aggregator，累加器已处理）──
    case 'moa.aggregating':
      processAccumulatorEvent(acc, eventName, chunk);
      cbs.onMoaAggregating?.({
        aggregator: (chunk.aggregator as string) || undefined,
        refCount: typeof chunk.ref_count === 'number' ? chunk.ref_count : undefined,
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

    // Phase 6: 主题切换（对齐 Hermes theme.changed）
    case 'theme.changed':
      cbs.onThemeChanged?.({ accent: chunk.accent as string, appearance: chunk.appearance as string });
      break;

    // Phase 6: 终端关闭（对齐 Hermes terminal.close）
    case 'terminal.close':
      cbs.onTerminalClose?.({ process_id: chunk.process_id as string });
      break;

    // reaction — 用户 affection（ily / <3 / good bot / 心形 emoji）→ 爱心彩蛋
    // 对齐 Hermes: server.py _emit("reaction", sid, {"kind": kind}) → burstVibeHearts()
    case 'reaction':
      cbs.onReaction?.({ kind: (chunk.kind as string) || 'vibe' });
      break;

    // wake.detected — 唤醒词命中（对齐 Hermes wake.detected → 提示音 + 开新会话）
    // 单视图路径：委托共享处理器（与宫格 useGridChat !profile 分支同一权威源）
    case 'wake.detected':
      cbs.onWakeDetected?.({
        // 🔴 2026-08-10：兜底默认值去 Hermes 化（后端默认唤醒词为 "小莉"）
        phrase: (chunk.phrase as string) || '小莉',
        start_new_session: (chunk.start_new_session as boolean) ?? true,
      });
      break;

    // voice.interrupted — full-duplex barge-in 打断（后端已切 TTS + 中断 turn）
    case 'voice.interrupted':
      cbs.onVoiceInterrupted?.(chunk as Record<string, unknown>);
      break;

    // Agent 后台进程输出流（对齐 Hermes agent.terminal.output）
    case 'agent.terminal.output':
      cbs.onAgentTerminalOutput?.({ process_id: chunk.process_id as string, chunk: chunk.chunk as string });
      break;

    // 🔴 3.4: 统一走 global-events（消灭内联 IIFE 重复）
    case 'terminal.read.request':
      handleGlobalEvent('terminal.read.request', chunk as Record<string, unknown>);
      break;

    case 'status.update': {
      // 合并两个重复case — 通用 status.update + lifecycle reset 分发
      const kind = chunk.kind as string;
      cbs.onStatusUpdate?.({ kind, text: chunk.text as string });
      // 🔴 P2-9: lifecycle 无 new_session_id 时不分发 reset（对齐宫格 `if (newSid)` 守卫）—
      // 否则 onSessionReset 会 setSessionId(undefined) + 误清消息列表
      // 🔴 2026-08-11 备注：本分支为死分支（后端 status.update 生产端仅 StreamChunk::StatusUpdate
      // kind/text 与 /background kind=background，均不带 kind='lifecycle'+new_session_id）——
      // /new /reset 已由 session.reset RPC 响应路径接管（handleNewSession），此处保留作防御守卫
      if (kind === 'lifecycle' && chunk.new_session_id) {
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
        // C-5: inflight turn 快照透传（对齐 Hermes resume inflight 投影）
        inflight: chunk.inflight as any,
      });
      break;

    // 对齐 Hermes pending_title: 后端应用 title 后推送此事件
    case 'session.title':
      cbs.onSessionTitle?.({
        session_id: (chunk.session_id as string) || '',
        title: (chunk.title as string) || '',
      });
      break;

    // 🔴 2026-08-13 对齐修复：项目数据变化（无 session_id 全局广播放行）→
    // 前端项目树静默刷新（工具 project_create/switch/delete 后 active 高亮/列表跟随）
    case 'projects.changed':
      cbs.onProjectsChanged?.();
      break;

    // ── 流生命周期 ──
    // 对齐 Hermes: message.start → onRunStart（分配streamId）
    case 'message.start':
    case 'run.started':
      cbs.onRunStart?.(chunk.session_id as string);
      break;

    case 'keepalive':
      // 🔴 2026-08-08：WS 保活帧（对齐 Hermes SSE `: keepalive` 的 WS 等价物）—
      // 显式忽略，避免每 30s 走 default 刷 console.warn。
      break;

    case 'workspace.changed':
      // 外部文件变更（后端 notify 目录监控，单一权威源）→ workspace-events 合并
      // 与 tool.complete 同源去抖合并；消费端 useWorkspaceTick 零改动
      notifyExternalChange({
        root: (chunk.root as string) || undefined,
        dirs: Array.isArray(chunk.dirs) ? (chunk.dirs as string[]) : undefined,
        full: Boolean(chunk.full),
      });
      break;

    case 'error':
      cbs.onError?.((chunk.message as string) || 'Unknown error');
      return 'error';

    case 'message.complete':
      // message.complete 替代 done + run.completed（对齐 Phase 4）
      // 🔴 Phase 4b #5: 记录后端权威终稿（finalizeAccumulator 累加为空时兜底）
      acc.serverContent = (chunk.content as string) || '';
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
      // 🔴 C-1（2026-08-08）：结构化 failure 语义（对齐 Hermes gateway-event.ts L722-733）。
      // status=error 时携带错误信息 + partial 标记（content 是流式部分输出 → 保留文本+
      // error 标记；非 partial → 消费方剥文本只显错误）。旧实现零消费 status/error →
      // LLM 4xx/限流/预算错误被当成普通半截回复，错误信息完全丢失。
      const failure =
        chunk.status === 'error'
          ? {
              error: ((chunk.error as string) || (chunk.content as string) || 'Agent 错误').trim(),
              partial: Boolean(chunk.partial),
            }
          : undefined;
      // 中断处理（原 onRunComplete 的中断逻辑）
      if (chunk.interrupted) {
        cbs.onRunComplete?.({
          sessionId: chunk.session_id as string || '',
          completed: false,
          interrupted: true,
          usage: chunk.usage,
        });
      }
      // 🔴 2026-08-11 修复：chunk.session_id 是【本轮】session_id（build_ws_event 恒注入），
      // 不是"新会话 id"——旧实现把它当 newSessionId 传给 onDone → 每轮触发
      // setSessionId 切换 + 调试面板每轮显示 "new session"（后端实际从未新建）。
      // ELEVE message.complete 无 new_session_id 字段（/new 走 onSessionReset 专门事件），
      // 此处仅当字段存在才传（对齐 Hermes 语义，未来后端补字段可直接生效）。
      const newSid = (chunk as { new_session_id?: string }).new_session_id;
      cbs.onDone?.(newSid ?? null, failure);
      return 'done';

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
 * 🔴 多 Agent 隔离：routeWsEvent 按 session_id 过滤，非当前会话的事件丢弃（后端已持久化）。
 */
export function useSSE(
  callbacks: SSECallbacks = {},
  currentSessionIdRef?: React.MutableRefObject<string | null>,
  enabled: boolean = true,
): {
  isStreaming: boolean
  send: (text: string, sessionId?: string | null) => Promise<void>
  abort: () => Promise<void>
  resetStream: () => void
  drainFinalParts: () => ChatMessagePart[]
} {
  const isStreaming = useIsStreaming();
  const currentSessionRef = useRef<string | null>(null);
  // 🔴 串台绝对闭环：显式标记“本人刚发送新建会话、等后端分配 session_id”。
  // 过滤器 current===null 时仅在此标志为 true 才进入缓冲——区分“刚发送等响应”与“切到空白 Agent”。
  const pendingSendRef = useRef(false);
  // 🔴 串台绝对闭环：新建会话 session 未知窗口内，缓冲原始事件，待响应锁定 session 后冲洗。
  // 后端 tokio::spawn(流式) 与 Ok(session_id) 并发，不保证响应先于事件——不能靠时序，必须缓冲。
  const pendingBufferRef = useRef<Array<{ eventName: string; data: unknown }> | null>(null);
  // routeWsEvent 镜像 ref（供 flushPendingBuffer 重放，避免 useCallback 循环依赖）
  const routeWsEventRef = useRef<((eventName: string, data: unknown) => void) | null>(null);
  const isStreamingRef = useRef(false);
  const cbsRef = useRef<SSECallbacks>(callbacks);
  cbsRef.current = callbacks;

  // ── WS accumulator ref — 🔴 已迁移到 StreamAccumulator（与宫格 useGridChat 同一权威源）──
  const wsAccumulatorsRef = useRef<StreamAccumulator>(createAccumulator());

  // ── WS 事件 → 统一路由（含 session 过滤） ──
  const routeWsEvent = useCallback((eventName: string, data: unknown) => {
    const cbs = cbsRef.current;
    const acc = wsAccumulatorsRef.current;
    const raw = data as Record<string, unknown>;
    if (!raw) return;

    // WS payload 内聚：业务数据在 payload 字段下（对齐 Hermes _emit 格式）
    const chunkBase = (raw.payload && typeof raw.payload === 'object' ? raw.payload : raw) as Record<string, unknown>;
    const chunk: Record<string, unknown> = {
      ...chunkBase,
      ...(raw.session_id != null && chunkBase.session_id == null ? { session_id: raw.session_id } : {}),
      ...(raw.run_id != null && chunkBase.run_id == null ? { run_id: raw.run_id } : {}),
    };

    // 🔴 多 Agent 隔离：事件带 session_id 且不匹配当前会话 → 丢弃
    // 不带 session_id 的事件（notification/skin/terminal 等全局广播）→ 放行
    const eventSessionId = chunk.session_id as string | undefined;
    if (eventSessionId && currentSessionIdRef) {
      const current = currentSessionIdRef.current;
      if (current) {
        // 已锁定当前会话：非本会话事件一律丢弃
        if (eventSessionId !== current) return;
      } else if (pendingSendRef.current) {
        // 🔴 绝对闭环：current 为 null 且本人刚发送新建会话——session 未知，缓冲原始事件，
        // 待响应锁定 session 后冲洗。不丢自己的早期事件（session.info/message.start），不漏外来流式。
        pendingBufferRef.current?.push({ eventName, data });
        return;
      } else {
        // 🔴 串台根因修复：current 为 null 但非本人发送（切到空白 Agent）→ 丢弃外来流式。
        // 后端已持久化，切回源 Agent 时 loadHistory 恢复，不丢消息。
        return;
      }
    }

    const result = processEvent(eventName, chunk, acc, cbs);

    // done/error 清理流式状态
    if (result === 'done' || result === 'error') {
      storeSetIsStreaming(false);
      isStreamingRef.current = false;
    }
  }, [currentSessionIdRef]);
  routeWsEventRef.current = routeWsEvent;

  // 🔴 串台绝对闭环：响应锁定 session 后冲洗缓冲——重放走 routeWsEvent 正常过滤
  // （自己的事件 session 匹配放行，外来事件 session 不匹配丢弃）。与时序无关。
  const flushPendingBuffer = useCallback(() => {
    pendingSendRef.current = false;
    const buf = pendingBufferRef.current;
    pendingBufferRef.current = null;
    if (!buf?.length) return;
    for (const evt of buf) {
      routeWsEventRef.current?.(evt.eventName, evt.data);
    }
  }, []);

  // ── WS 连接生命周期 ──
  // 🔴 宫格/单视图互斥：enabled=false（宫格模式）时 useSSE 暂停、不注册 listener，
  // 由 useGridChat 接管所有 WS 事件。两者以 viewMode 为键由 App 层驱动，天然互斥。
  useEffect(() => {
    if (!enabled) return;
    const wsClient = getWsClient();

    // 注册事件监听器 — WS 推送 → routeWsEvent → processEvent → SSECallbacks
    wsClient.addEventListener(routeWsEvent);

    // 注：原重连恢复回调（请求 session.info）已移除 — session.info 仅为后端推送事件，
    // 无请求 handler，旧调用注定 METHOD_NOT_FOUND 被吞。重连后的会话信息靠后端推送恢复。

    return () => {
      wsClient.removeEventListener(routeWsEvent);
    };
  }, [routeWsEvent, enabled]);

  const send = useCallback(async (text: string, sessionId?: string | null, modelOpts?: { model?: string; provider?: string; title?: string; queued?: boolean }): Promise<void> => {
    if (!text?.trim()) return;
    console.log('[useSSE.send] sessionId:', sessionId, 'wsState:', getWsClient().state);
    // 🔴 Phase 2: busy 直发保护 —— 流式态/发送锁/累加器归属 live turn，
    // wasBusy 路径不重置、失败时不回退（对齐宫格 useGridChat sendTo wasBusy 语义）
    // 🔴 wasBusy 判定含 store 快照：后端 drain turn（run.started → isStreaming=true）
    // 无发送锁，仅看 isStreamingRef（send() 设置/done 清除）会误判为 idle
    const wasBusy = isStreamingRef.current || getIsStreaming();
    storeSetIsStreaming(true);
    isStreamingRef.current = true;

    // 记录当前流式会话 ID，abort 时使用
    currentSessionRef.current = sessionId ?? null;
    // 🔴 串台绝对闭环：
    //  - 已有会话发送 → 预锁过滤 ref，外来事件立即按 session 过滤（无窗口）。
    //  - 新建会话发送 → session 未知，进入缓冲窗口，等响应锁定后冲洗。
    if (sessionId) {
      if (currentSessionIdRef) currentSessionIdRef.current = sessionId;
      pendingSendRef.current = false;
      pendingBufferRef.current = null;
    } else {
      pendingSendRef.current = true;
      pendingBufferRef.current = [];
    }

    const cbs = cbsRef.current;

    // ── WS only：对齐 Hermes TUI，无 HTTP 降级 ──
    // Hermes Desktop 做法参考 (use-gateway-request.ts):
    //   1. WS 断了 → 先重连 (ensureGatewayOpen)
    //   2. 重连成功 → 重试请求
    //   3. 重连失败 → 才报错
    // 🔴 3.1: 统一连接保障入口（消灭 3 份重复）
    const wsClient = getWsClient();
    const connected = await wsClient.ensureConnected(10000);
    if (!connected) {
      console.error('[useSSE] WS not connected after waiting 10s');
      if (!wasBusy) {
        storeSetIsStreaming(false);
        isStreamingRef.current = false;
      }
      pendingSendRef.current = false;
      pendingBufferRef.current = null;
      if (cbs?.onError) {
        cbs.onError('连接断开，正在重连，请稍后重试');
      }
      return;
    }

    // 🔴 Phase 2: busy 直发不重置累加器 —— live turn 正在其中累积 delta，重置会抹掉终稿
    if (!wasBusy) wsAccumulatorsRef.current = createAccumulator();

    try {
      const result = await wsClient.promptSubmit(text, sessionId || undefined, modelOpts) as { session_id?: string; status?: string };
      // 🔴 Phase 2: 消费后端 route_busy_submit outcome（对齐宫格 useGridChat sendTo）：
      // - steered → 注入 live turn，无新 turn 事件，UI 提示
      // - queued 类 → live turn 的 message.complete 是锁释放唯一权威入口，
      //   后端 spawn_ws_turn_with_drain 接续排队消息。两种情况都不动流式态/锁。
      // - 无 status = idle accepted → 正常持锁等 message.complete 释放
      if (result?.status === 'steered') {
        import('../utils/notifications').then(({ notifyInfo }) => notifyInfo('已注入当前轮（steer）', '消息已送达')).catch(() => {});
      }
      // GAP-1: redirect 软重定向成功 → 修正已取消在飞模型请求并注入当前轮
      if (result?.status === 'redirected') {
        import('../utils/notifications').then(({ notifyInfo }) => notifyInfo('已重定向当前轮（redirect）', '修正已注入当前回复')).catch(() => {});
      }
      // 🔴 2026-08-16 方案A 补反馈：queued（busy 直发进 Inbox.followup）——
      // 后端 route_busy_submit 立即 ack（不再挂到轮末），排队可见性由
      // QueuePanel（queue.status 轮询）承担，此处 toast 明确告知用户
      // "已排队，当前任务完成后自动执行"（消除"卡住"感知）。
      if (result?.status === 'queued') {
        import('../utils/notifications').then(({ notifyInfo }) => notifyInfo('任务已加入队列', '当前任务完成后自动执行')).catch(() => {});
      }
      // 对齐架构原则：后端是 session_id 的唯一权威源
      // 后端自动创建 session 时返回 session_id，前端消费并更新本地状态
      if (result?.session_id && result.session_id !== sessionId) {
        const newSid = result.session_id;
        persistSessionPointer(newSid);
        // 🔴 立即锁定 session 过滤 ref
        if (currentSessionIdRef) currentSessionIdRef.current = newSid;
        // 🔴 绝对闭环：锁定后冲洗缓冲窗口（自己的事件匹配放行，外来丢弃）
        flushPendingBuffer();
        if (cbs?.onSessionCreated) {
          cbs.onSessionCreated(newSid);
        }
      } else {
        // 响应未带新 session（已有会话或异常）→ 安全关窗，防缓冲卡死
        pendingSendRef.current = false;
        pendingBufferRef.current = null;
      }
      return; // WS 发送成功，事件通过 routeWsEvent 回调
    } catch (wsErr) {
      console.error('[useSSE] WS prompt.submit failed:', wsErr);
      // 🔴 Phase 2: wasBusy 直发失败不动流式态 —— 归属 live turn（其 complete 负责终止）
      if (!wasBusy) {
        storeSetIsStreaming(false);
        isStreamingRef.current = false;
      }
      pendingSendRef.current = false;
      pendingBufferRef.current = null;
      if (cbs?.onError) {
        cbs.onError(`发送失败: ${(wsErr as Error).message}`);
      }
      return;
    }
  }, [flushPendingBuffer]);

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
    // 🔴 P2-1: abort 必须关闭发送窗口 + 丢弃缓冲（否则残留 pendingSendRef 干扰下次发送过滤）
    pendingSendRef.current = false;
    pendingBufferRef.current = null;

    const cbs = cbsRef.current;
    if (cbs?.onDone) {
      cbs.onDone(null);
    }
  }, []);

  // 🔴 多 Agent 隔离：切换会话/Profile 时重置流式状态（清流式指示器 + 累加器）
  const resetStream = useCallback(() => {
    storeSetIsStreaming(false);
    isStreamingRef.current = false;
    currentSessionRef.current = null;
    // 🔴 串台绝对闭环：切换会话/Agent 时关闭发送窗口 + 丢弃缓冲（外来流式不冲洗进新视图）
    pendingSendRef.current = false;
    pendingBufferRef.current = null;
    wsAccumulatorsRef.current = createAccumulator();
  }, []);

  // 🔴 3.3: drain 语义（取出+重置）— 消灭 useMessageStream 影子累加器 fullTextRef
  // interrupted 时 onRunComplete + onDone 双触发，第二次 drain 返回空 parts → 不创建重复消息
  const drainFinalParts = useCallback(() => {
    const parts = finalizeAccumulator(wsAccumulatorsRef.current);
    resetAccumulator(wsAccumulatorsRef.current);
    return parts;
  }, []);

  return { isStreaming, send, abort, resetStream, drainFinalParts };
}
