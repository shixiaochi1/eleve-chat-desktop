/**
 * Bot roster 行的**活跃判定**（对齐 Hermes `row-helpers.ts`）。
 *
 * Hermes 的两个窗口：
 * | 常量 | 值 | 用途 |
 * |---|---|---|
 * | `ACTIVE_WINDOW_S` | 90 | 最后一条消息落在此窗内 = 「活跃」（`activeBots`） |
 * | `WORKER_ACTIVE_WINDOW_S` | 150 | kanban/tool worker 心跳（每 60s 一次，窗口放宽以桥接一次漏跳） |
 *
 * Hermes 的 roster 行状态（`botMood`）= `workerActive || (本机 && gateway busy)`
 * → `BotFace` 头像的 `work|idle`。即「**正在干活**」而非「最近聊过天」。
 *
 * ## 两路输入的 ELEVE 现状（round-106）
 * - **worker 心跳**：✅ 已可得 —— 后端 roster 透出 `worker_session`
 *   （对齐 Hermes `profiles.list` 的 `worker_session`；
 *   `methods_profiles.py:206 _latest_profile_session_rows` 取"最新一条 worker
 *   来源会话"）。取的是 `last_active`（epoch 秒），本模块套 150s 窗。
 * - **gateway busy（本机 profile 正在跑一轮）**：❌ 仍不可得 —— ELEVE 没有逐
 *   profile 的 busy 投影（`_running_agents` 按 session_key 键，且不对外暴露）。
 *   chat 侧的 `last_active` 已是保守近似（回合内 flush 会刷新 `updated_at`）。
 *
 * 🔴 round-105 → round-106 的修正：round-105 曾把"两路输入都不可得"写成结论，
 * 实测**不成立**——worker 路只需后端把已有的会话行带出来（见上）。当前的偏差
 * 只剩 gateway-busy 一路，比原记录窄得多。
 */

/** 最后一条消息落在此窗内 = 「活跃」（对齐 Hermes `ACTIVE_WINDOW_S`）。 */
export const ACTIVE_WINDOW_S = 90;

/** kanban/tool worker 心跳窗口（对齐 Hermes `WORKER_ACTIVE_WINDOW_S`：worker
 *  至少每 60s 心跳一次，窗口放宽以桥接一次漏跳）。 */
export const WORKER_ACTIVE_WINDOW_S = 150;

/** `worker_session` 的最小形状（后端 roster 透出的 `WorkerSessionRow`）。 */
export interface WorkerSessionLike {
  id?: string;
  source?: string;
  title?: string;
  last_active?: number | null;
}

/**
 * 时间戳是否落在窗口内。
 *
 * `ts` 是 **epoch 秒**（后端 `last_active`），`nowMs` 是毫秒——入口统一换算，
 * 避免调用方各写一遍 `/1000`。缺失/0/非法一律 false（宁可不显示活跃点，
 * 也不能把未知当活跃）。
 */
function withinWindow(
  ts: number | null | undefined,
  windowS: number,
  nowMs: number,
): boolean {
  const value = Number(ts);
  if (!value || !Number.isFinite(value)) return false;
  return nowMs / 1000 - value < windowS;
}

/**
 * 该 bot 是否「刚刚有活动」（chat `last_active` 落在 90s 窗内）。
 *
 * `last_active` 是 **epoch 秒**（后端 `BotRosterEntry.last_active`）。
 */
export function isBotActive(
  lastActive: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return withinWindow(lastActive, ACTIVE_WINDOW_S, nowMs);
}

/**
 * 该 bot 是否有**活着的 kanban/tool worker**（Hermes `workerActiveAt`）。
 *
 * 语义是「**正在干活**」：worker 会话不进会话列表，所以没有这一路信号时，
 * 一个跑了 30 分钟 kanban 任务的 profile 会全程显示空闲
 * （Hermes #90268 的原症状）。
 */
export function isBotWorkerActive(
  workerSession: WorkerSessionLike | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return withinWindow(workerSession?.last_active, WORKER_ACTIVE_WINDOW_S, nowMs);
}
