/**
 * roster 展示偏好：`pinned`（置顶）+ `hidden`（隐藏）。
 *
 * 对齐 Hermes `plugins/hermes-bots/hidden-bots.ts`：
 * - `isBotPinned(bot, meta)` —— 排序优先（`roster-pane.tsx:417 sortRosterRows`：
 *   pinned 先，同档内保持原序）
 * - 隐藏的语义（原文 `hidden-bots.ts:21-23`）：
 *   *"Hiding is a ROSTER-DISPLAY concern only: a hidden bot keeps working,
 *   remains mentionable, keeps group membership, and any open chat stays open."*
 *   —— **只影响展示**，不是移除成员、不是停止讨论
 * - `$showHiddenBots` 是 **session-only**（原文："Session-only view toggle:
 *   reveal hidden bots (dimmed) in the roster"）—— 不持久化
 *
 * 存储：前端本地偏好（`utils/storage`，与会话置顶/归档同一模式 —— SessionsPanel
 * 的 loadSet/saveSet）。Hermes 存 plugin storage 的 botMeta 快照，语义等价。
 *
 * 🔴 round-104 说明：ELEVE 的房间行此前**无排序**（顺序 = 后端 `created_at ASC`），
 * 也无展示偏好。这是对视 Hermes roster 功能面时确认的**唯一剩余缺失**。
 */
import * as storage from '../utils/storage';

const PINNED_KEY = 'bots.roster.pinned.v1';
const HIDDEN_KEY = 'bots.roster.hidden.v1';

/** 任何持久偏好都必须能容忍读失败/脏数据（宁可当空，也不能让面板崩）。 */
function loadSet(key: string): Set<string> {
  try {
    const v = storage.load(key);
    const arr = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: ReadonlySet<string>): void {
  try {
    storage.save(key, JSON.stringify([...set]));
  } catch {
    /* 持久化失败不影响本次会话的展示 */
  }
}

export const loadPinnedRooms = (): Set<string> => loadSet(PINNED_KEY);
export const savePinnedRooms = (s: ReadonlySet<string>): void => saveSet(PINNED_KEY, s);
export const loadHiddenRooms = (): Set<string> => loadSet(HIDDEN_KEY);
export const saveHiddenRooms = (s: ReadonlySet<string>): void => saveSet(HIDDEN_KEY, s);

/** 切换集合成员（返回**新** Set —— 原地 mutate 会被 `Object.is` 判为未变）。 */
export function toggleMember(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * 排序：**置顶优先**，同档内保持传入顺序（稳定排序）。
 *
 * 对齐 Hermes `sortRosterRows`：它按 `pinned` 分档、同档按 activity（最近活跃）。
 * ELEVE 的传入顺序 = 后端 `ORDER BY created_at ASC`（建房时间升序）——
 * 与「同栏会话行」的相对时间语义同向，故同档内**保持原序**即可，不另算 activity。
 */
export function sortRoomsByPin<T extends { room_id: string }>(
  rooms: readonly T[],
  pinned: ReadonlySet<string>,
): T[] {
  return rooms
    .map((room, i) => ({ room, i }))
    .sort((a, b) => {
      const pa = pinned.has(a.room.room_id) ? 1 : 0;
      const pb = pinned.has(b.room.room_id) ? 1 : 0;
      return pb - pa || a.i - b.i;
    })
    .map((x) => x.room);
}

/**
 * 可见性过滤：隐藏项**只在** `showHidden` 打开时出现（对齐 Hermes
 * `$showHiddenBots` 语义）。隐藏不改变任何数据，仅是从列表里收起。
 */
export function filterVisibleRooms<T extends { room_id: string }>(
  rooms: readonly T[],
  hidden: ReadonlySet<string>,
  showHidden: boolean,
): T[] {
  return showHidden ? [...rooms] : rooms.filter((r) => !hidden.has(r.room_id));
}
