/**
 * 花名册**工具条**（搜索 / 类型 / 活跃度 / 连接 过滤 + 排序）——对齐 Hermes
 * `roster-pane.tsx` + `row-helpers.ts` + `roster-sections.tsx`。
 *
 * Hermes 的四件套（`roster-pane.tsx:278-281`）：
 * | 状态 | 取值 | 判据来源 |
 * |---|---|---|
 * | `query` | 文本 | `filterBots`（data.ts:1371） |
 * | `rowKindFilter` | `'all' \| 'bots' \| 'groups'` | `RosterKindFilter`（types.ts:303） |
 * | `activityFilter` | `'all' \| 'active' \| 'recent' \| 'older'` | `rosterActivityMatches`（row-helpers.ts:115） |
 * | `gatewayFilter` | `'all' \| connectionId` | `filterBotsByGateway` |
 *
 * 排序（`sortRosterRows`，roster-pane.tsx:418）：**置顶优先，其次活动度降序**。
 * 活动度（`activityOf`，roster-pane.tsx:311）= `max(created, 最后消息时间)`——
 * 注释原文：*"Messaging-app order: most recent activity first… A freshly created
 * bot tops the list until another bot gets a message."*
 */

import type { BotRoom, BotRosterEntry } from '../utils/api';
// 🔴 round-111b：成员行的**路由真值解析**（显式优先本机行）——见该函数注释
import { findMemberRoutingRow } from './bot-members';

/** 最近活跃窗口 = 7 天（对齐 Hermes `RECENT_ACTIVITY_WINDOW_S`）。 */
export const RECENT_ACTIVITY_WINDOW_S = 7 * 24 * 60 * 60;

/** 工具条显示阈值（对齐 Hermes `BOT_ROSTER_SEARCH_THRESHOLD = 8`）：
 *  条目少且无搜索词、单连接时，搜索框与过滤器不占地方。 */
export const ROSTER_TOOLS_THRESHOLD = 8;

/** 类型过滤（对齐 Hermes `RosterKindFilter`）。 */
export type RosterKindFilter = 'all' | 'bots' | 'groups';

/** 活跃度过滤（对齐 Hermes `RosterActivityFilter`）。 */
export type RosterActivityFilter = 'all' | 'active' | 'recent' | 'older';

/** 一行在过滤/排序里用到的两个量。 */
export interface RosterRowMeta {
  /** 「现在活跃」（chat 或 worker 心跳），供 `'active'` 档使用 */
  active: boolean;
  /** 活动度（**毫秒**），供 `'recent'`/`'older'` 与排序使用 */
  activity: number;
}

/**
 * Agent 的活动度（毫秒）。对齐 Hermes `activityOf`：
 * `max(created, 该 bot 会话的 last_active)`。
 *
 * `created_at` 是加数而非可选项——新建的 Agent 还没有消息，只算 `last_active`
 * 会让它**沉到列表最底**并被打成"很久没活动"（Hermes 明确要"新建的置顶"）。
 */
export function botActivityMs(entry: BotRosterEntry): number {
  const created = Number(entry.created_at) || 0;
  const lastActive = Number(entry.last_active) || 0;
  return Math.max(created, lastActive) * 1000;
}

/**
 * 房间的活动度（毫秒）。对齐 Hermes `groupLastActivity`（`group-membership.ts:199`）：
 * **最后一条日志的时间**，无消息 = 0。
 *
 * 🔴 刻意**不**加 `room.created_at`——Hermes 对房间也不加（只有 bot 那一侧取
 * `max(created, …)`）。所以一个刚建、还没人说话的房间在 'recent' 档里不算活跃，
 * 这是对齐后的实际行为，不是漏项。
 */
export function roomActivityMs(room: BotRoom): number {
  return (Number(room.last_message?.created_at) || 0) * 1000;
}

/**
 * 活跃度过滤。逐条对齐 Hermes `rosterActivityMatches`：
 * - `all` → 全通过
 * - `active` → 只看 `row.active`（**不**看活动度）
 * - `recent` → 活动度落在 7 天窗内
 * - `older` → 其余（含活动度 = 0 的"从无消息"行）
 */
export function matchesActivityFilter(
  row: RosterRowMeta,
  filter: RosterActivityFilter,
  nowMs: number = Date.now(),
): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'active') return Boolean(row.active);
  const recent = Boolean(row.activity) && nowMs - row.activity <= RECENT_ACTIVITY_WINDOW_S * 1000;
  return filter === 'recent' ? recent : !recent;
}

/** 归一化搜索词：去首尾空白、去前导 `@`、转小写（对齐 Hermes `filterBots`）。 */
export function normalizeQuery(query: string): string {
  return String(query ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
}

/**
 * Agent 是否命中搜索。对齐 Hermes `filterBots` 的匹配面：
 * 显示名 / profile 名 / handle / **连接展示名**（"homelab 能找到该连接上所有 bot"）
 * / 角色描述。
 *
 * ⚠️ 有意少一项：Hermes 还匹配 `botActivitySession.preview`（最后一条消息预览）。
 * ELEVE 的 Agent 行**不显示消息预览**（副行是角色描述，round-78d 的有意设计），
 * 没有这份数据可匹配——记在此处，不假装已覆盖。
 */
export function botMatchesQuery(
  entry: BotRosterEntry,
  connectionLabel: string,
  query: string,
): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  const haystack = [
    entry.display_name ?? '',
    entry.profile ?? '',
    entry.handle ?? '',
    connectionLabel ?? '',
    entry.description ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

/** 按连接过滤（对齐 Hermes `filterBotsByGateway`）。`'all'` 不过滤。 */
export function filterByGateway<T extends { connectionId: string }>(
  rows: readonly T[],
  gatewayFilter: string,
): T[] {
  if (!gatewayFilter || gatewayFilter === 'all') return [...rows];
  return rows.filter((r) => r.connectionId === gatewayFilter);
}

/**
 * 房间是否通过「搜索 + 连接」过滤。对齐 Hermes `groupMatchesRosterFilters`
 * （`roster-sections.tsx:39`）：
 * - **连接**：`gatewayFilter !== 'all'` 时，房间必须**有成员在那个连接上**
 *   （ELEVE 的房间是本地实体，成员可能是远端 profile ⇒ 用联合花名册解析成员的
 *   连接归属；解析不到（ghost 行）视为不匹配）。
 * - **搜索**：房间名命中，**或**任一（在该连接上的）成员命中 Agent 搜索。
 */
export function roomMatchesFilters(
  room: BotRoom,
  roster: readonly {
    entry: BotRosterEntry;
    connectionId: string;
    connectionLabel: string;
    /** 🔴 round-111b：可缺省（测试夹具）；缺省按"本机"处理。见 `findMemberRoutingRow`。 */
    isRemote?: boolean;
  }[],
  query: string,
  gatewayFilter: string,
): boolean {
  // 房间成员 → 联合花名册行（成员可能是远端 profile；解析不到的行忽略，
  // 对齐 Hermes：`row.members` 就是成员行的 roster rows）
  // 🔴 round-111b：解析走共享真值（**显式优先本机行**）——此前是本文件里
  // `roster.find(handle||profile)` 的隐式顺序依赖。
  const memberRows = room.members
    .map((m) => findMemberRoutingRow(roster, m))
    .filter((r): r is (typeof roster)[number] => Boolean(r));

  // 🔴 连接过滤作用在**成员**上（不是全局花名册）：房间在那个连接上没有任何成员
  // ⇒ 整个房间被过滤掉（对齐 Hermes `filterBotsByGateway(members, connectionId)`
  // 的 `inGateway.length === 0 → false`）
  const membersOnGateway = filterByGateway(memberRows, gatewayFilter);
  if (gatewayFilter && gatewayFilter !== 'all' && membersOnGateway.length === 0) {
    return false;
  }

  const needle = normalizeQuery(query);
  if (!needle) return true;

  if (String(room.name ?? '').toLowerCase().includes(needle)) return true;

  // 成员命中（限定在所筛连接上的成员，对齐 Hermes `filterBots(inGateway, …)`）
  return membersOnGateway.some((r) => botMatchesQuery(r.entry, r.connectionLabel, needle));
}

/** 类型过滤：`'bots'` 隐藏房间、`'groups'` 隐藏 Agent（对齐 `rowKindFilter`）。 */
export function kindAllowsBots(kind: RosterKindFilter): boolean {
  return kind !== 'groups';
}

/** 🔴 round-109：该 Agent 是否被隐藏（1:1 对齐 Hermes `hidden-bots.ts:isBotHidden`）。
 *  🔴 隐藏是**纯展示**——它照常工作、照常可被 @、照常留在群里。 */
export function isBotHidden(entry: BotRosterEntry): boolean {
  return Boolean(entry.hidden);
}

/** 🔴 round-109：该 Agent 是否置顶（1:1 对齐 Hermes `hidden-bots.ts:isBotPinned`）。 */
export function isBotPinned(entry: BotRosterEntry): boolean {
  return Boolean(entry.pinned);
}

/**
 * 隐藏项过滤（对齐 Hermes `showHiddenRows = hiddenExpanded || hasRosterConstraint`）。
 *
 * `revealHidden` 由调用方算好：用户的"显示已隐藏"开关 **或** 当前有筛选约束
 * ——有约束时隐藏项必须露出来，否则"搜不到明明存在的 Agent"。
 */
export function filterHiddenBots<T extends { entry: BotRosterEntry }>(
  rows: readonly T[],
  revealHidden: boolean,
): T[] {
  return revealHidden ? [...rows] : rows.filter((r) => !isBotHidden(r.entry));
}

/** 🔴 round-110：房间的隐藏过滤——与 [`filterHiddenBots`] 同一口径。
 *
 *  房间的隐藏来自**服务端字段**（`BotRoom.hidden`；round-110 起从 localStorage
 *  迁到 `bot_rooms` 表，与房间记录同源），语义与 Agent 端完全一致：纯展示。 */
export function filterHiddenRooms<T extends { hidden?: boolean }>(
  rows: readonly T[],
  revealHidden: boolean,
): T[] {
  return revealHidden ? [...rows] : rows.filter((r) => !r.hidden);
}

/** 类型过滤：房间一侧（见 `kindAllowsBots`）。 */
export function kindAllowsRooms(kind: RosterKindFilter): boolean {
  return kind !== 'bots';
}

/** 置顶优先，其次活动度降序（对齐 Hermes `sortRosterRows`）。稳定排序。 */
export function sortByPinThenActivity<T>(
  rows: readonly T[],
  isPinned: (row: T) => boolean,
  activityOf: (row: T) => number,
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pa = isPinned(a.row) ? 1 : 0;
      const pb = isPinned(b.row) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const diff = activityOf(b.row) - activityOf(a.row);
      // 活动度相同时保持原序（稳定），避免每次轮询都抖动
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((x) => x.row);
}

/** 生效中的过滤条数（过滤按钮徽标，对齐 Hermes `activeFilterCount`）。 */
export function activeFilterCount(
  kind: RosterKindFilter,
  activity: RosterActivityFilter,
  gateway: string,
): number {
  return (kind !== 'all' ? 1 : 0) + (activity !== 'all' ? 1 : 0) + (gateway !== 'all' ? 1 : 0);
}

/** 生成「连接」过滤的可选项（联合花名册里出现过的连接）。
 *
 *  刻意**保持联合花名册的插入序**（不额外排序）：`fetchUnionRoster` 先 push 本机
 *  行，所以"本机"天然在首位。这样本模块不必 import `services/bot-relay` 的
 *  `LOCAL_CONNECTION_ID`（那会把网络/存储层拖进纯函数库与测试）。 */
export function gatewayOptions(
  roster: readonly { connectionId: string; connectionLabel: string }[],
): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of roster) {
    if (!seen.has(r.connectionId)) seen.set(r.connectionId, r.connectionLabel);
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}
