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
import { getWsClient } from '../services/ws-client';
import * as storage from '../utils/storage';

/** 轮询间隔（对齐 Hermes useRoster ≤5s stale） */
const ROSTER_POLL_MS = 5 * 1000;

// ── 内部状态 ──

let seeded = false;
/** 每 profile 水位线（epoch 秒）——只单调推进 */
const watermarks = new Map<string, number>();
/** 每 profile 未读标志 */
const unread = new Map<string, boolean>();
/** 每 profile canonical session id（on-screen 判定用，随 roster 刷新） */
const canonicalSids = new Map<string, string>();

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
    const profile = bot.profile;
    const sid = bot.canonical_session_id || null;
    const la = bot.last_active || 0;
    if (sid) canonicalSids.set(profile, sid);
    else canonicalSids.delete(profile);

    const wm = watermarks.get(profile) ?? 0;
    if (!seeded || la > wm) watermarks.set(profile, la);

    if (seeded && la > wm && sid && sid !== activeSessionId()) {
      if (!unread.get(profile)) {
        unread.set(profile, true);
        changed = true;
      }
      watermarks.set(profile, la);
    }
  }
  seeded = true;
  if (changed) emit();
}

/** 打开某 bot 的私聊后调用：水位线推进到当前 + 清未读（Hermes ack 同义） */
export function markBotRead(profile: string): void {
  const wm = watermarks.get(profile) ?? 0;
  const la = latestByProfile.get(profile) ?? wm;
  watermarks.set(profile, Math.max(wm, la));
  if (unread.get(profile)) {
    unread.set(profile, false);
    emit();
  }
}

/** 轮询期间的最新 last_active（markBotRead 用，比水位线更新） */
const latestByProfile = new Map<string, number>();

async function pollOnce(): Promise<void> {
  try {
    const bots = await fetchBotsRoster();
    for (const bot of bots) {
      const la = bot.last_active || 0;
      const prev = latestByProfile.get(bot.profile) ?? 0;
      if (la > prev) latestByProfile.set(bot.profile, la);
    }
    ingestBotRoster(bots);
  } catch {
    // WS 未连接/暂不可用：下轮重试（session-status.ts 同款容错）
  }
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

/** 订阅单个 bot 的未读标志（快照值稳定，无变化不重渲染） */
export function useBotUnread(profile: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => unread.get(profile) ?? false,
    () => false,
  );
}
