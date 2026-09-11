/**
 * Bot roster 行的**活跃判定**（对齐 Hermes `row-helpers.ts`）。
 *
 * Hermes 的两个窗口：
 * | 常量 | 值 | 用途 |
 * |---|---|---|
 * | `ACTIVE_WINDOW_S` | 90 | 最后一条消息落在此窗内 = 「活跃」（`activeBots`） |
 * | `WORKER_ACTIVE_WINDOW_S` | 150 | kanban/tool worker 心跳（每 60s 一次，窗口放宽以桥接一次漏跳） |
 *
 * Hermes 的 roster 行状态点（`botMood`）取 **`workerActive || (本机 && gateway busy)`**，
 * 即「**正在干活**」而非「最近聊过天」。
 *
 * 🔴 round-105 的现实约束（**有意偏差，非等价**）：
 * ELEVE 的 `BotRosterEntry` **没有 `worker_session`**（kanban/tool worker 心跳），
 * 也没有 gateway busy 的逐 bot 投影 ⇒ Hermes 的 `mood` 两路输入都不可得。
 * 本轮用**已有的 `last_active`（canonical Bot Chat 最近活动，epoch 秒）** + 90s 窗口
 * 做近似指示：语义是「**刚刚有活动**」，比 Hermes 的「正在干活」更弱但更保守
 * （不会把空闲 bot 误标成工作中）。
 * ⚠️ 补齐真正的 `mood` 需要后端在 roster 里透出 worker 心跳 + busy 状态，记为待办。
 */
export const ACTIVE_WINDOW_S = 90;

/**
 * 该 bot 是否「刚刚有活动」（`last_active` 落在 90s 窗内）。
 *
 * `last_active` 是 **epoch 秒**（后端 `BotRosterEntry.last_active`），与 `nowMs`
 * 的毫秒要换算——入口统一用 `nowMs`，避免调用方各写一遍 `/1000`。
 * 缺失/0/非法一律 false（宁可不显示活跃点，也不能把未知当活跃）。
 */
export function isBotActive(
  lastActive: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const ts = Number(lastActive);
  if (!ts || !Number.isFinite(ts)) return false;
  return nowMs / 1000 - ts < ACTIVE_WINDOW_S;
}
