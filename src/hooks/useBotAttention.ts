/**
 * useBotAttention — Bot 行的 needs-attention 徽标信号
 * （对齐 Hermes hermes-bots `data.ts:57-157` 的 `$botAttention`）。
 *
 * Hermes 语义：
 * - 只承载**需要用户介入**的失败类别 —— `{agent_blocked,
 *   provider_auth_or_access, provider_quota_limit, missing_config}`
 *   （`BOT_ATTENTION_CLASSES`）；transient（429/5xx/timeout/offline）
 *   **永不**徽标——它们会自愈，标了就是噪音。
 * - 触发面 = **Desktop 中继投递的结果**（Hermes `relay.ts:394-423`）：
 *   前端是跨机投递的发起者，只有它拿到 typed reason。
 * - 一次成功交互即清除。
 *
 * 为什么独立成模块（而不是放进 `plugins/bots/state.ts`）：
 * `state.ts` 已 `import { fetchUnionRoster } from '../services/bot-relay'`，
 * 而写入方 `services/bot-relay.ts` 需要本模块 → 放一起会形成**循环依赖**。
 * 本模块零依赖（只依赖 react），两边都单向引用它。
 */
import { useSyncExternalStore } from 'react';

export interface BotAttention {
  /** 结构化 reason（与后端 `BotFailureReason::as_str` 同词表） */
  reason: string;
  /** 记录时刻（epoch ms） */
  at: number;
  /** 原始失败文本（tooltip 里附在提示后） */
  message: string;
}

/** 需要行级告警的类别 → 展示提示（对齐 Hermes `BOT_ATTENTION_CLASSES` +
 *  `BOT_ATTENTION_HINTS`）。**不在表内的 reason 一律不入册**。 */
const BOT_ATTENTION_HINTS: Record<string, string> = {
  agent_blocked: '该 Agent 被门控拒绝——检查它的会话是否为 Bot Chat',
  provider_auth_or_access: '该 Agent 的模型凭证无效或无权限',
  provider_quota_limit: '该 Agent 的模型额度已用尽',
  missing_config: '该 Agent 缺少必要配置（模型/凭证）',
};

/** attention 键 = `${connectionId}::${profile}`
 *  （对齐 Hermes `${target.id}::${target_profile}`）。 */
export function attentionKey(connectionId: string, profile: string): string {
  return `${connectionId}::${profile}`;
}

let attentionSnapshot: ReadonlyMap<string, BotAttention> = new Map();
const attentionListeners = new Set<() => void>();

function emitAttention() {
  for (const fn of attentionListeners) fn();
}

/**
 * 记录一次投递失败。**只有需要用户介入的类别才置位**（transient 静默忽略，
 * 对齐 Hermes 的类别白名单）。
 * @returns 是否置位（false = 类别不入册）
 */
export function noteBotAttention(key: string, reason: string, message: string): boolean {
  if (!(reason in BOT_ATTENTION_HINTS)) return false;
  const next = new Map(attentionSnapshot);
  next.set(key, { reason, at: Date.now(), message });
  attentionSnapshot = next;
  emitAttention();
  return true;
}

/** 一次成功交互清除该行的 attention（对齐 Hermes `clearBotAttention`）。 */
export function clearBotAttention(key: string): void {
  if (!attentionSnapshot.has(key)) return;
  const next = new Map(attentionSnapshot);
  next.delete(key);
  attentionSnapshot = next;
  emitAttention();
}

/** tooltip 文案：类别提示 + 原始失败文本。 */
export function attentionHint(a: BotAttention): string {
  const hint = BOT_ATTENTION_HINTS[a.reason];
  return hint ? `${hint}\n${a.message}` : a.message;
}

export function useBotAttention(key: string): BotAttention | null {
  return useSyncExternalStore(
    (fn) => {
      attentionListeners.add(fn);
      return () => attentionListeners.delete(fn);
    },
    () => attentionSnapshot.get(key) ?? null,
    () => null,
  );
}
