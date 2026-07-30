/**
 * ws-event-processor — WS 流式事件处理核心（纯函数，零副作用）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  单一权威源：单视图（useSSE/useMessageStream）和宫格（useGridChat）
 *  共用同一套累加器逻辑和 payload 归一化。
 *
 *  职责边界：
 *    ✅ 事件 → 累加器更新（text / reasoning / tool parts）
 *    ✅ 累加器 → 最终消息 parts
 *    ✅ 工具事件 payload 归一化（不同事件字段名差异）
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
