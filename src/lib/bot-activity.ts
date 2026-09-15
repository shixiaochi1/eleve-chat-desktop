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
 * ## 两路输入的 ELEVE 现状（round-106 → 2026-09-15）
 * - **worker 心跳**：✅ 已可得 —— 后端 roster 透出 `worker_session`
 *   （对齐 Hermes `profiles.list` 的 `worker_session`；
 *   `methods_profiles.py:206 _latest_profile_session_rows` 取"最新一条 worker
 *   来源会话"）。取的是 `last_active`（epoch 秒），本模块套 150s 窗。
 * - **gateway busy（本机 profile 正在跑一轮）**：✅ **已可得**（2026-09-15 补上）
 *   —— 后端 roster 透出 `busy`（`crates/eleve-app/src/bot_chat.rs::RosterGatewayActivity`，
 *   数据源 = gateway `GatewayRunnerHandle::snapshot_running_agents`，
 *   session key `agent:<profile>:…` 归属 profile）。同批还透出
 *   `stalled_secs`（Hermes `gateway/session_stall.py` 的卡死空闲秒数，
 *   **判据在后端** stall watcher：有排队用户消息 + 距上次进展超
 *   `agent.session_stall_timeout_secs`）。
 *
 * 🔴 round-105 → round-106 的修正：round-105 曾把"两路输入都不可得"写成结论，
 * 实测**不成立**——worker 路只需后端把已有的会话行带出来（见上）。
 * 🔴 2026-09-15：gateway-busy 那一路也已补齐（`busy`）——原记录"❌ 仍不可得"作废。
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

/**
 * 本机 gateway 是否有该 profile 的会话**正在跑一轮**（`BotRosterEntry.busy`）。
 *
 * 语义与 worker 心跳不同：worker 是"在跑 kanban/tool 任务"，busy 是"有会话正在跑一轮"
 * （对齐 Hermes `botMood = workerActive || (本机 && gateway busy)` 的后半）。
 * 这一路此前**不可得**（见文件头记录），2026-09-15 由后端补上。
 *
 * 严格 `=== true`：缺省（旧后端 / 远端行）一律 false——宁可不亮，也不把未知当忙碌。
 */
export function isGatewayBusy(busy: boolean | null | undefined): boolean {
  return busy === true;
}

/**
 * 该 bot 本机是否有会话**卡死**——返回卡死会话的**最大空闲秒数**（`null` = 未卡死）。
 *
 * 🔴 2026-09-15（对齐 Hermes `gateway/session_stall.py`）：判据是「**有排队等着的用户消息** +
 * 距上次进展超 `agent.session_stall_timeout_secs`」，**判据在后端** stall watcher——
 * 前端不重复实现阈值，只呈现结果（避免两处漂移）。
 *
 * 缺失 / 0 / 非有限值一律 `null`（宁可不显示，也不把未知当卡死）。
 */
export function botStalledSecs(stalled: number | null | undefined): number | null {
  const value = Number(stalled);
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}
