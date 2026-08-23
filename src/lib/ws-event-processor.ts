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
import {
  upsertToolPart,
  textPart,
  reasoningPart,
  appendTextPart,
  appendReasoningPart,
  type ChatMessagePart,
  type GatewayEventPayload,
} from './chat-messages';

/**
 * 流式累加器 — 一轮对话 in-flight parts 的唯一持有者（对齐 Hermes segment 模型）。
 *
 * parts = 到达序 segment 数组：text / reasoning / tool-call 按事件到达序交错。
 *   - message.delta   → 并入尾部 text segment（尾部非 text 则新开，tool-call 为界）
 *   - reasoning.delta → 并入尾部未冻结 reasoning 块（冻结则新开）
 *   - reasoning.end   → 冻结尾部 reasoning 块
 *   - tool.*          → upsert tool-call segment
 * 两视图 live 渲染走同一套 segment 规则（chat-messages 的 appendText/appendReasoning/freeze/upsertToolPart），
 * finalize 输出与流式骨架结构同构 → 完成替换点无结构性跳变（审查 P1-1/P1-3 根因）。
 */
export interface StreamAccumulator {
  parts: ChatMessagePart[];
  /** 后端 message.complete 权威终稿全文（仅“本轮无 step 边界且累加文本为空”时兜底） */
  serverContent?: string;
  /** 本轮已出现 step.complete（跨步骤级重置存活）→ 禁用 serverContent 整轮终稿兜底，防末步纯工具时重复整轮文本（审查 P1-8） */
  sawStepComplete: boolean;
}

export function createAccumulator(): StreamAccumulator {
  return { parts: [], serverContent: undefined, sawStepComplete: false };
}

/** 轮级重置（message.complete / error / send / 会话切换）：全清 */
export function resetAccumulator(acc: StreamAccumulator): void {
  acc.parts = [];
  acc.serverContent = undefined;
  acc.sawStepComplete = false;
}

/** 步骤级重置（step.complete）：清 parts 但保留本轮步骤边界标记 */
export function resetAccumulatorForStep(acc: StreamAccumulator): void {
  acc.parts = [];
  acc.serverContent = undefined;
  acc.sawStepComplete = true;
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
      acc.parts = appendTextPart(acc.parts, (payload.delta as string) || '');
      return true;
    case 'reasoning.delta':
      acc.parts = appendReasoningPart(acc.parts, (payload.text as string) || '');
      return true;
    case 'reasoning.available': {
      // 🔴 2026-08-08 对齐 Hermes：available = 推理块完成后的摘要（带 text），
      // replace 语义（对齐 Hermes appendReasoningDelta(text, true)）：
      // 移除全部未冻结 reasoning 块 → 追加冻结摘要块（done=true 保持多块边界，
      // 下一个 reasoning.delta 经 appendReasoningPart 自然新开块）。
      // 🔴 2026-08-08 21:10 BUG 修复（对齐 Hermes text 守卫）：消息已有正文文本时跳过——
      // 思考块已通过 reasoning.delta 流式展示在 text 之前，replace 会把思考块
      // 挪到消息末尾（思考气泡与回复气泡上下颠倒）。Hermes 基线：
      // appendReasoningDelta(text, true) 内 `chatMessageText(message).trim()` 非空 → 不动。
      const text = (payload.text as string) || '';
      const hasText = acc.parts.some((p) => p.type === 'text' && p.text.trim());
      if (hasText) {
        return true;
      }
      const filtered = acc.parts.filter((p) => !(p.type === 'reasoning' && !p.done));
      acc.parts = [...filtered, { ...reasoningPart(text), done: true }];
      return true;
    }
    // 🔴 reasoning.end 已删除（2026-08-08 对齐 Hermes：Hermes 无此事件，
    // 块冻结由 reasoning.available 完成态 replace 承担）
    case 'moa.reference': {
      // MoA 参考模型输出（对齐 Hermes use-message-stream gateway-event.ts moa.reference）
      // 作为带标签的推理块展示（◇ Reference idx/cnt — label），复用推理展示区，零平行 UI。
      // 首个参考（idx<=1）替换/清除上一轮残留推理（对齐 Hermes appendReasoningDelta replace=true），
      // 后续参考累积（#64658 防互相覆盖）。ELEVE 无 moa.progress/moa.phase —— MoaReference 带
      // index/count 语义等价覆盖 fan-out 进度展示。
      const label = (payload.label as string) || 'reference';
      const idx = typeof payload.index === 'number' ? payload.index : undefined;
      const cnt = typeof payload.count === 'number' ? payload.count : undefined;
      const header =
        idx !== undefined && cnt !== undefined
          ? `◇ Reference ${idx}/${cnt} — ${label}`
          : `◇ Reference — ${label}`;
      const body = (payload.text as string) || '';
      const block = `${header}\n${body}\n\n`;
      if (idx === undefined || idx <= 1) {
        acc.parts = appendReasoningPart(acc.parts.filter((p) => p.type !== 'reasoning'), block);
      } else {
        acc.parts = appendReasoningPart(acc.parts, block);
      }
      return true;
    }
    case 'moa.aggregating': {
      // 聚合器开始工作（对齐 Hermes moa.phase phase="aggregator" 的一行标记）
      acc.parts = appendReasoningPart(acc.parts, '◇ MoA aggregating…\n');
      return true;
    }
    case 'tool.start':
      acc.parts = upsertToolPart(acc.parts, toolPayloadFromEvent(eventName, payload), 'running');
      return true;
    // 🔴 2026-08-11 对齐 Hermes gateway-event.ts:830（重复调用显示层根因）：
    // tool.generating 是「状态」不是工具行——模型还在流式生成调用 JSON，只有
    // name 没有 id/args。渲染成行会在 tool.start 到达前残留无参数幽灵卡
    // （live-tool:xxx，永远 pending），且 tool.start 的 preview=工具名导致
    // matchValues 永不与幽灵卡重叠 → 每个工具双卡。Hermes 只
    // setSessionDraftingTool + pet activity；ELEVE 由 useSSE 回调
    // onToolGenerating 显示状态文本（statusText），此处不建行。
    // case 'tool.generating': 已移除（原 upsertToolPart 调用）
    case 'tool.complete':
      acc.parts = upsertToolPart(acc.parts, toolPayloadFromEvent(eventName, payload), 'complete');
      return true;
    default:
      return false;
  }
}

/**
 * 将累加器转为最终消息 parts。
 * 🔴 按到达序输出（与流式骨架同构 — 完成替换点无结构跳变）。
 * serverContent 兜底仅限“本轮无 step.complete 边界且累加文本为空”（丢 delta/重连场景）；
 * 有 step 边界的轮次禁止兜底（serverContent 是整轮终稿，步骤重置后兜底会重复前文，审查 P1-8）。
 * 累加文本非空时保留累加结果（含 runtime footer，后端 content 不含 footer，覆盖会丢）。
 *
 * 🔴 2026-08-02 修复（qwen 重复回复 BUG #3）：后端权威终稿去重。
 * 流式 delta 可能被 conversation_loop 重试流污染——同一次提问触发多次 LLM 调用，
 * 每次调用的完整回复都被实时推送，累加器把多条流拼接成重复文本。
 * 无 step 边界且拼接文本远长于后端终稿（>2 倍，重复流特征）时，
 * 用后端 message.complete 的权威 content（已剥离 think 块、最终成功响应的唯一文本）
 * 替换全部文本 parts。正常场景（拼接 ≈ 终稿 + footer）比值 < 2 不触发，零回归。
 */
export function finalizeAccumulator(acc: StreamAccumulator): ChatMessagePart[] {
  // 丢弃空 reasoning 占位（reasoning.available 种占但无后续 delta）
  const parts = acc.parts.filter((p) => !(p.type === 'reasoning' && !p.text));
  const textParts = parts.filter((p) => p.type === 'text' && p.text);
  const fullText = textParts.map((p) => (p as { text?: string }).text ?? '').join('');
  const hasText = fullText.trim().length > 0;

  // 🔴 重复流去重：终稿非空、无 step 边界、拼接文本远长于终稿 → 替换
  if (acc.serverContent && !acc.sawStepComplete && hasText) {
    const serverLen = acc.serverContent.trim().length;
    if (serverLen > 0 && fullText.trim().length > serverLen * 2) {
      const nonTextParts = parts.filter((p) => p.type !== 'text');
      return [...nonTextParts, textPart(acc.serverContent)];
    }
  }

  if (!hasText && acc.serverContent && !acc.sawStepComplete) {
    return [...parts, textPart(acc.serverContent)];
  }
  return parts;
}

// ── pending_prompts 归一化（session.info 交互重建）──

/** 归一化的 pending 交互对象（两视图共用） */
export interface PendingInteractions {
  approval?: { command: string; description: string; pattern: string; choices: string[]; run_id: string };
  clarify?: { clarify_id: string; question: string; choices: string[]; multi_select?: boolean };
  /** 🔴 2026-08-23：批量澄清表单（questions 存在时走 clarify_batch，刷新恢复用） */
  clarify_batch?: {
    clarify_id: string;
    title?: string | null;
    questions: Array<{ qid: string; id?: string | null; question: string; choices?: string[] | null; multi_select?: boolean }>;
  };
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
      run_id: fallbackRunId || (pp.approval.request_id as string) || '',
    };
    hasAny = true;
  }
  if (pp.clarify) {
    // 🔴 2026-08-23：批量表单（questions 存在）走 clarify_batch——刷新恢复时
    // 前端重渲染 ClarifyBatchCard；单题走 clarify（含 multi_select 透传）
    const questions = pp.clarify.questions as
      | Array<{ qid: string; id?: string | null; question: string; choices?: string[] | null; multi_select?: boolean }>
      | undefined;
    if (questions && questions.length > 0) {
      result.clarify_batch = {
        clarify_id: (pp.clarify.clarify_id as string) || '',
        title: (pp.clarify.title as string | null) || null,
        questions,
      };
    } else {
      result.clarify = {
        clarify_id: (pp.clarify.clarify_id as string) || '',
        question: (pp.clarify.question as string) || '',
        choices: (pp.clarify.choices as string[]) || [],
        multi_select: !!pp.clarify.multi_select,
      };
    }
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
