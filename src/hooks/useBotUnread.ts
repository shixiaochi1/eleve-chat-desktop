/**
 * useBotUnread — Bot 花名册未读信号（对齐 Hermes hermes-bots/roster-actions.ts
 * trackInboundActivity + bot-state.ts 水位线语义，2026-09-04）
 *
 * 为什么不用 session-status.ts 的 unread：那边是订阅制——"仅已 attach 的会话
 * 能收到事件"，而 bot 会话从不 attach 且被主列表 exclude，bot 私信到达时任何
 * 事件都到不了前端。Hermes 同因改用 roster 轮询水位线："This poll is the ONLY
 * unread signal a canonical Bot Chat can have"。
 *
 * 语义（逐条对齐 Hermes）：
 * - 活动权威 = canonical Bot Chat 的 last_active（bots.roster 透传，后端只读查询，
 *   对齐 botActivitySession："the dot and the click can never describe different
 *   conversations"——状态锚定的就是行点击打开的那个会话）
 * - 首次拉取只播种水位线，不把历史标未读（"seeded on first poll so a fresh
 *   mount doesn't mark ancient history unread"）
 * - last_active 越过水位线且该会话不在屏上 → unread
 * - "不在屏上"判定 = canonical session id ≠ 当前活动会话（session-status.ts
 *   activeSessionId 同构：宫格焦点 override ?? 全局指针 storage.session_id）
 * - 打开 bot 私聊 → markBotRead（Hermes openBotCanonicalChat 的 ack 同义）
 *
 * 轮询常驻（模块加载即启动，session-status.ts ensureBackgroundPolling 同款先例）：
 * BotsView 卸载后（切回单视图/宫格）信号必须继续——这正是它存在的意义。
 */
import { useSyncExternalStore } from 'react';
import { fetchBotsRoster, type BotRosterEntry } from '../utils/api';
import { fetchUnionRoster } from '../services/bot-relay';
import { getWsClient } from '../services/ws-client';
import * as storage from '../utils/storage';

/** 轮询间隔（对齐 Hermes useRoster ≤5s stale） */
const ROSTER_POLL_MS = 5 * 1000;

// ── 内部状态 ──

let seeded = false;
/**
 * 水位线/未读表。🔴 2026-09-05 round-54：键从 profile 改为
 * **canonical_session_id ?? profile**——union 花名册含远端连接行，两台机器
 * 的同名 profile（各自的 default）共用 profile 键会互相覆盖水位线；
 * canonical session id 全局唯一（对齐 Hermes botActivitySession 锚定
 * canonical_session 的语义），无 canonical 会话的行回退 profile 键
 * （无会话 = 无活动 = 永不置未读）。
 */
const watermarks = new Map<string, number>();
/** 未读标志（键同上） */
const unread = new Map<string, boolean>();

/** 未读键：canonical session id 优先（跨连接唯一），回退 profile */
function unreadKey(bot: BotRosterEntry): string {
  return bot.canonical_session_id || bot.profile;
}

let polling = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 当前活动会话（session-status.ts activeSessionId 同构） */
function activeSessionId(): string | null {
  return storage.load('session_id', null) as string | null;
}

/**
 * 喂一帧 roster（BotsView 的 loadList 与本模块轮询共用单一入口，逻辑不重复）。
 * 首帧只播种；后续帧 last_active 越过水位线且会话不在屏上 → 置未读，并推进
 * 水位线（防同一活动重复触发）。
 */
export function ingestBotRoster(bots: BotRosterEntry[]): void {
  let changed = false;
  for (const bot of bots) {
    const key = unreadKey(bot);
    const la = bot.last_active || 0;

    const wm = watermarks.get(key) ?? 0;
    if (!seeded || la > wm) watermarks.set(key, la);

    // 不在屏上 = 该 canonical 会话不是当前活动会话（键即 sid；远端会话
    // 永不可能是本地活动会话 → 远端活动正确置未读）。后端契约：
    // last_active 有值必有 canonical_session_id（同源返回），无 sid 的行
    // la=0 走不到此分支。
    if (seeded && la > wm && key !== activeSessionId()) {
      if (!unread.get(key)) {
        unread.set(key, true);
        changed = true;
      }
      watermarks.set(key, la);
    }
  }
  seeded = true;
  if (changed) emit();
}

/** 打开某 bot 的私聊后调用：水位线推进到当前 + 清未读（Hermes ack 同义）。
 *  参数 = 未读键（canonical_session_id ?? profile，与 ingestBotRoster 同一公式）。 */
export function markBotRead(key: string): void {
  const wm = watermarks.get(key) ?? 0;
  const la = latestByKey.get(key) ?? wm;
  watermarks.set(key, Math.max(wm, la));
  if (unread.get(key)) {
    unread.set(key, false);
    emit();
  }
}

/** 轮询期间的最新 last_active（markBotRead 用，比水位线更新） */
const latestByKey = new Map<string, number>();

let tick = 0;
let unionBusy = false;

/**
 * 🔴 2026-09-05 round-54：远端 union 帧降频拉取（每第 4 tick ≈ 20s）——
 * 此前 ingest 只喂本地行（BotsPane 挂载时），远端 bot 被跨网关 DM 后桌面
 * 无任何未读指示（Hermes trackInboundActivity 消费 union roster 含远端）。
 * 拉取失败静默（远端行由 fetchUnionRoster 的 last-good ghost 兜底）。
 */
async function pollUnionOnce(): Promise<void> {
  if (unionBusy) return;
  unionBusy = true;
  try {
    ingestBotRoster((await fetchUnionRoster()).map(r => r.entry));
  } catch {
    // 本地连接不可用等——下轮重试
  } finally {
    unionBusy = false;
  }
}

async function pollOnce(): Promise<void> {
  try {
    const bots = await fetchBotsRoster();
    for (const bot of bots) {
      const la = bot.last_active || 0;
      const key = unreadKey(bot);
      const prev = latestByKey.get(key) ?? 0;
      if (la > prev) latestByKey.set(key, la);
    }
    ingestBotRoster(bots);
  } catch {
    // WS 未连接/暂不可用：下轮重试（session-status.ts 同款容错）
  }
  // 远端帧：降频（本地 5s 一次，union 每 4 tick 一次）
  tick += 1;
  if (tick % 4 === 0) void pollUnionOnce();
}

function ensurePolling(): void {
  if (polling) return;
  polling = true;
  void pollOnce();
  setInterval(() => void pollOnce(), ROSTER_POLL_MS);
  // WS 重连后立即对账一次（断线期间的 DM 不能等 5s）
  getWsClient().onStateChange((s) => {
    if (s === 'connected') void pollOnce();
  });
}
ensurePolling();

// ── 订阅 hook ──

/** 订阅单个 bot 的未读标志（参数 = 未读键，与 ingestBotRoster 同一公式；
 *  快照值稳定，无变化不重渲染） */
export function useBotUnread(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unread.get(key) ?? false,
    () => false,
  );
}
