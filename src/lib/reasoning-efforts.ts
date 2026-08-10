/**
 * 思考深度档位 — 单一权威源（对齐 Hermes REASONING LEVEL 六档）
 *
 * 消费方：输入框思考深度按钮（ThinkingButton）、Auxiliary 任务卡片（ModelSettings）。
 * value 为写入后端配置的值（agent.reasoning_effort / auxiliary.<task>.reasoning_effort）：
 *   none/minimal/low/medium/high/xhigh（Hermes 同款六档）；
 *   空/未知值读回 → medium（Hermes normalizeEffort: empty → medium）
 */

export const REASONING_EFFORTS = [
  { value: 'none', label: '关闭', desc: '关闭推理，模型不产生思考过程' },
  { value: 'minimal', label: '极速', desc: '最少推理，响应最快' },
  { value: 'low', label: '低', desc: '轻量推理，快速回答' },
  { value: 'medium', label: '标准', desc: '均衡推理，适合多数提示' },
  { value: 'high', label: '高', desc: '深度推理，适合复杂任务' },
  { value: 'xhigh', label: '极致', desc: '最大推理深度（模型支持时）' },
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]['value'];
