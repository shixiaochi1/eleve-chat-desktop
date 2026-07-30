/**
 * ws-event-processor — WS 事件处理核心（纯函数，零副作用）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  单一权威源：单视图（useSSE/useMessageStream）和宫格（useGridChat）
 *  共用同一套累加器逻辑、payload 归一化、交互提取。
 *
 *  职责边界：
 *    ✅ 事件 → 累加器更新（text / reasoning / tool parts）
 *    ✅ 累加器 → 最终消息 parts
 *    ✅ 工具事件 payload 归一化（不同事件字段名差异）
 *    ✅ pending_prompts → 归一化交互对象（session.info 重建）
 *    ❌ 事件路由（session 过滤 / profile 解复用）— 调用方负责
 *    ❌ 状态存储（global store / per-agent slot）— 调用方负责
 *    ❌ 副作用（session 列表刷新 / debug 事件）— 调用方负责
 * ═══════════════════════════════════════════════════════════════════
 */
import { upsertToolPart, textPart, type ChatMessagePart, type GatewayEventPayload } from './chat-messages';

/** 流式累加器 — 收集一轮对话的 text / reasoning / tool parts */
export interface StreamAccumulator {
  text: string;
  reasoning: string;
  parts: ChatMessagePart[];
}

export function createAccumulator(): StreamAccumulator {
  return { text: '', reasoning: '', parts: [] };
}

export function resetAccumulator(acc: StreamAccumulator): void {
  acc.text = '';
  acc.reasoning = '';
  acc.parts = [];
}

/**
 * 工具事件 payload 归一化。
 *
 * 后端不同工具事件的字段名不一致（toolCallId / tool_call_id、tool / name），
 * 本函数统一为 GatewayEventPayload 形状，供 upsertToolPart 消费。
 */
export function toolPayloadFromEvent(eventName: string, p: Record<string, unknown>): GatewayEventPayload {
  const toolCallId = (p.toolCallId as string) || (p.tool_call_id as string) || '';
  const name = (p.tool as string) || (p.name as string) || 'tool';
  switch (eventName) {
    case 'tool.start':
      return { tool_call_id: toolCallId, name, preview: p.preview as string | undefined };
    case 'tool.generating':
      return { tool_call_id: toolCallId, name, args: p.args as Record<string, unknown> | undefined };
    case 'tool.complete':
      return { tool_call_id: toolCallId, name, duration: p.duration as number | undefined, error: p.error as boolean | undefined };
    case 'tool.failed':
      return { tool_call_id: toolCallId, name, error: true };
    default:
      return { tool_call_id: toolCallId, name };
  }
}

/**
 * 处理流式累加事件（message.delta / reasoning.delta / tool.*）。
 * 纯函数：只修改 acc，无副作用。
 * @returns true 如果事件被处理（调用方可跳过后续 switch）
 */
export function processAccumulatorEvent(
  acc: StreamAccumulator,
  eventName: string,
  payload: Record<string, unknown>,
): boolean {
  switch (eventName) {
    case 'message.delta':
      acc.text += (payload.delta as string) || '';
      return true;
    case 'reasoning.delta':
      acc.reasoning += (payload.text as string) || '';
      return true;
    case 'tool.start':
    case 'tool.generating':
      acc.parts = upsertToolPart(acc.parts, toolPayloadFromEvent(eventName, payload), 'running');
      return true;
    case 'tool.complete':
    case 'tool.failed':
      acc.parts = upsertToolPart(acc.parts, toolPayloadFromEvent(eventName, payload), 'complete');
      return true;
    default:
      return false;
  }
}

/**
 * 将累加器转为最终消息 parts。
 * 顺序：reasoning → tool-call parts → text（与单视图 useMessageStream 一致）。
 */
export function finalizeAccumulator(acc: StreamAccumulator): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  if (acc.reasoning) parts.push({ type: 'reasoning' as const, text: acc.reasoning });
  parts.push(...acc.parts);
  if (acc.text) parts.push(textPart(acc.text));
  return parts;
}

// ── pending_prompts 归一化（session.info 交互重建）──

/** 归一化的 pending 交互对象（两视图共用） */
export interface PendingInteractions {
  approval?: { command: string; description: string; pattern: string; choices: string[]; run_id: string };
  clarify?: { clarify_id: string; question: string; choices: string[] };
  sudo?: { request_id: string; prompt?: string };
  secret?: { request_id: string; prompt: string; env_var: string };
  slashConfirm?: { confirmId: string; command: string; description: string };
}

/**
 * 从 session.info 的 pending_prompts 提取归一化交互对象。
 *
 * 后端 pending_prompts 字段名与前端状态字段名不一致：
 *   - approval.request_id → run_id
 *   - sudo_password.sudo_id → request_id
 *   - secret_capture.secret_id → request_id
 *   - slash_confirm.confirm_id → confirmId
 * 本函数统一映射，消除两视图重复转换。
 *
 * @param pp session.info payload 中的 pending_prompts
 * @param fallbackRunId 当 approval 缺 request_id 时的兜底 run_id（通常为 session_id）
 * @returns 归一化对象，无任何 pending 时返回 null
 */
export function extractPendingInteractions(
  pp: Record<string, Record<string, unknown>> | undefined | null,
  fallbackRunId?: string,
): PendingInteractions | null {
  if (!pp) return null;
  const result: PendingInteractions = {};
  let hasAny = false;

  if (pp.approval) {
    result.approval = {
      command: (pp.approval.command as string) || '',
      description: (pp.approval.description as string) || '',
      pattern: (pp.approval.pattern as string) || '',
      choices: (pp.approval.choices as string[]) || ['once', 'session', 'deny'],
      run_id: (pp.approval.request_id as string) || fallbackRunId || '',
    };
    hasAny = true;
  }
  if (pp.clarify) {
    result.clarify = {
      clarify_id: (pp.clarify.clarify_id as string) || '',
      question: (pp.clarify.question as string) || '',
      choices: (pp.clarify.choices as string[]) || [],
    };
    hasAny = true;
  }
  if (pp.sudo_password) {
    result.sudo = {
      request_id: (pp.sudo_password.sudo_id as string) || '',
      prompt: pp.sudo_password.prompt as string | undefined,
    };
    hasAny = true;
  }
  if (pp.secret_capture) {
    result.secret = {
      request_id: (pp.secret_capture.secret_id as string) || '',
      prompt: (pp.secret_capture.prompt as string) || '',
      env_var: (pp.secret_capture.env_var as string) || '',
    };
    hasAny = true;
  }
  if (pp.slash_confirm) {
    result.slashConfirm = {
      confirmId: (pp.slash_confirm.confirm_id as string) || '',
      command: (pp.slash_confirm.command as string) || '',
      description: (pp.slash_confirm.description as string) || '',
    };
    hasAny = true;
  }

  return hasAny ? result : null;
}
