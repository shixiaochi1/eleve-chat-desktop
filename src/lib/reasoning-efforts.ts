/**
 * 思考深度档位 — 单一权威源（严格对齐 Hermes `lib/reasoning-effort.ts`）
 *
 * 🔴 2026-10-31 对照 Hermes：**`none` 不是档位**，而是「思考关闭」，
 *   由独立的 Thinking 开关持有（Hermes 原话："`none` is not a level: it's
 *   thinking disabled, owned by the Thinking toggle rather than the scale"）。
 *   推理阶梯是 7 档：minimal → ultra（Hermes REASONING_EFFORTS / 后端
 *   hermes_constants.py VALID_REASONING_EFFORTS）。
 *
 * 消费方：
 * - 输入框思考深度按钮（ThinkingButton）：REASONING_EFFORTS + 思考开关
 * - Auxiliary / Fallback 任务下拉（ModelSettings）：REASONING_EFFORT_OPTIONS
 *
 * value 为写入后端配置的值（agent.reasoning_effort / auxiliary.<task>.reasoning_effort）。
 */

/** 推理阶梯（升序）——不含 none，见文件头注 */
export const REASONING_EFFORTS = [
  { value: 'minimal', label: '最小', desc: '最少推理，响应最快' },
  { value: 'low', label: '低', desc: '轻量推理，快速回答' },
  { value: 'medium', label: '中', desc: '均衡推理，适合多数提示' },
  { value: 'high', label: '高', desc: '深度推理，适合复杂任务' },
  { value: 'xhigh', label: '极高', desc: '强化推理（模型支持时）' },
  { value: 'max', label: '最高', desc: '最大推理深度（模型支持时）' },
  { value: 'ultra', label: '超高', desc: '极限推理（模型支持时）' },
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]['value'];

/** 完整可选值 = 阶梯 + 关闭（设置页下拉需要「关闭」作为可选项） */
export const REASONING_EFFORT_OPTIONS = [
  { value: 'none', label: '关闭', desc: '关闭推理，模型不产生思考过程' },
  ...REASONING_EFFORTS,
] as const;

export type ReasoningEffortValue = (typeof REASONING_EFFORT_OPTIONS)[number]['value'];

/** 未配置/未知档位时的后端默认（Hermes DEFAULT_REASONING_EFFORT） */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

const norm = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/** 是否为推理阶梯成员（不含 none） */
export function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.some((e) => e.value === norm(value));
}

/** 是否允许写入（阶梯 或 none） */
export function isReasoningEffortValue(value: string): value is ReasoningEffortValue {
  return norm(value) === 'none' || isReasoningEffort(value);
}

/**
 * 思考是否开启（对齐 Hermes isThinkingEnabled）：空值继承 fallback，
 * 只有显式 none 才关。
 */
export function isThinkingEnabled(
  effort: string | null | undefined,
  fallback: string = DEFAULT_REASONING_EFFORT,
): boolean {
  return norm(effort || fallback) !== 'none';
}

/**
 * 「思考开关」应显示的档位（对齐 Hermes resolveReasoningEffort）：
 * - none（思考关闭）→ ''（阶梯无选中项）
 * - 空/未知 → fallback（默认 medium）
 */
export function resolveReasoningEffort(
  effort: string | null | undefined,
  fallback: string = DEFAULT_REASONING_EFFORT,
): string {
  const value = norm(effort || fallback);
  if (value === 'none') return '';
  return isReasoningEffort(value) ? value : fallback;
}

/** 档位中文名（关闭 → 关闭；未知 → 原值） */
export function reasoningEffortLabel(effort: string | null | undefined): string {
  const value = norm(effort);
  if (!value) return '';
  const found = REASONING_EFFORT_OPTIONS.find((e) => e.value === value);
  return found?.label ?? (effort || '');
}
