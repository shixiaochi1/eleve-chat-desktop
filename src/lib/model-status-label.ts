/**
 * 模型胶囊状态标签 — 对齐 Hermes `app/desktop/src/lib/model-status-label.ts`
 * 的 `formatModelStatusLabel`：
 *
 *   `<模型名> · Fast Med`
 *
 * - Fast 只在快速模式开启（或模型是 `-fast` 变体）时出现；
 * - 档位**恒显示**，让当前推理强度一眼可见（Hermes 原话：
 *   "Always surface the effort so the current reasoning level is visible at a glance"）。
 */
import { DEFAULT_REASONING_EFFORT, reasoningEffortLabel } from './reasoning-efforts';

/** 是否 `-fast` 变体模型（对齐 Hermes `/-fast$/i.test(modelBaseId(model))`） */
export function isFastVariantModel(model: string): boolean {
  const base = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  return /-fast$/i.test(base.trim());
}

/** 状态后缀：`快速 中` / `高`（空档位 → 只留 Fast / 空串） */
export function effortStatusSuffix(opts: {
  fast?: boolean;
  effort?: string;
  model?: string;
}): string {
  const parts: string[] = [];
  if (opts.fast || (opts.model ? isFastVariantModel(opts.model) : false)) parts.push('快速');
  const label = reasoningEffortLabel(opts.effort || DEFAULT_REASONING_EFFORT);
  if (label) parts.push(label);
  return parts.join(' ');
}

/** 模型胶囊完整标签：`模型名 · 快速 中` */
export function formatModelStatusLabel(
  modelName: string,
  opts: { fast?: boolean; effort?: string; model?: string } = {},
): string {
  const name = modelName.trim();
  if (!name) return '';
  const suffix = effortStatusSuffix(opts);
  return suffix ? `${name} · ${suffix}` : name;
}
