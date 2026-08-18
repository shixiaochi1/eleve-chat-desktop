/**
 * 思考文本显示层清洗 — 对齐 Hermes desktop coerceThinkingText（lib/chat-runtime.ts）
 *
 * Hermes 语义：显示边界清理思考流的状态噪音，不动落库数据（reasoning 字段
 * 原样保存，供 API 回放/needs_thinking_reasoning_pad 使用）。
 *
 * ELEVE 扩展（Hermes 未遇到的 provider 怪癖，DB 实证；对齐 Hermes
 * coerceThinkingText 的显示边界定位——清理思考流噪音、不动落库数据）：
 * 1. qwen 概率性把 think 族标签混进 reasoning_content 流 → 显示层剥标签
 * 2. qwen 工具轮后偶发纯垃圾推理流（仅 "..." / ":"）→ 无信息量视为空，隐藏气泡
 * 3. qwen3.7-plus 回显 STEER_CHANNEL_NOTE 的 OOB 标记模板（伪造的
 *    "[OUT-OF-BAND USER MESSAGE …] No response from the user. [/…]"）→
 *    显示层整块剥除（真实 steer 标记只由后端注入 tool result，任何出现在
 *    reasoning 里的都是仿冒；后端存储边界另有剥离，此处兜底历史数据与
 *    流式展示期间的瞬时内容）
 */

// 对齐 Hermes THINKING_STATUS_PREFIX_RE：开头 "<动词>..." 状态前缀（processing.../thinking... 等）
const THINKING_STATUS_PREFIX_RE =
  /^\s*(?:(?:[^\s.]{1,16})\s+)?(?:processing|thinking|reasoning|analyzing|pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|computing|synthesizing|formulating|brainstorming)\.\.\.\s*/i;

// 对齐 Hermes EMPTY_THINKING_PLACEHOLDER_RE：空思考改写占位文本
const EMPTY_THINKING_PLACEHOLDER_RE =
  /\b(?:current rewritten thinking|next thinking to process|provide the thinking content|don't see any .*thinking)\b/i;

// ELEVE 扩展：混入 reasoning 流的 think 族标签（对齐后端 strip_think_blocks 标签名单）
const THINKING_TAG_RE = /<\/?(?:think|thinking|reasoning|thought|REASONING_SCRATCHPAD)>/gi;

// ELEVE 扩展：模型回显的 OOB 标记块（伪造用户消息，2026-08-18 DB 实证）
// 完整块 [OUT-OF-BAND USER MESSAGE …] … [/OUT-OF-BAND USER MESSAGE] 整块剥除；
// 未闭合开口（流中断/截断残留）从开口处剥到末尾。
const OOB_MARKER_BLOCK_RE = /\[OUT-OF-BAND USER MESSAGE[\s\S]*?\[\/OUT-OF-BAND USER MESSAGE\]/g;
const OOB_MARKER_OPEN_TAIL_RE = /\[OUT-OF-BAND USER MESSAGE[\s\S]*$/;

// ELEVE 扩展：纯垃圾推理（仅省略号/冒号/空白）→ 无信息量
const JUNK_ONLY_RE = /^[.…。\s:：]*$/;

export function cleanThinkingText(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(THINKING_TAG_RE, '');
  text = text.replace(OOB_MARKER_BLOCK_RE, '');
  text = text.replace(OOB_MARKER_OPEN_TAIL_RE, '');
  text = text.replace(THINKING_STATUS_PREFIX_RE, '');
  if (EMPTY_THINKING_PLACEHOLDER_RE.test(text)) return '';
  if (JUNK_ONLY_RE.test(text)) return '';
  return text;
}
