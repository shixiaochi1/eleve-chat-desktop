/**
 * useAgentPanelData — Agent 面板的**数据编排单一入口**。
 *
 * 🔴 2026-09-16 round-116（Agent 面板整合 P1）：群聊 + 私聊并入 Agent 侧边页，
 * 面板版式（自上而下）= ①Agent 卡片区 ②项目区 ③群聊 + 私聊区。
 *
 * 本模块只负责**第 ③ 段的「私聊分组」编排**（卡片区/项目区数据仍由
 * ProfilePanel / ProjectTreePanel 各自持有，语义未变）：
 *   - 数据源 = union roster（`bots.roster` 本机 + 全部远端连接；plugins/bots/state 单一权威）
 *   - 判据全部来自 `lib/roster-filter.ts` / `lib/bot-activity.ts`——**不在这里重写任何判据**
 *   - 编排顺序逐字对齐 `components/BotsPane.tsx:342-358` 的 Agent 行管线
 *     （pin → 活动度 → 搜索 → 连接 → 活跃度 → 隐藏展开），
 *     保证迁移期新旧两处对同一份花名册给出**同一个顺序**。
 *
 * ⚠️ 迁移期说明：`BotsPane` 是旧面板（P5 退役删除），本模块与它**短暂并存**。
 * 判据本身单份（都在 lib/），此处只是编排重复；P5 删除 BotsPane 后收敛为唯一实现。
 *
 * 分工（D5，抑制"卡片 vs 私聊行"观感重复）：
 *   - 卡片 = 身份档案（model / provider / 技能数）——**不含运行态**
 *   - 私聊行 = 聊天入口（活跃 / 未读 / attention）
 *   故本模块只产出**行数据**；未读与 attention 由行组件按行订阅
 *   （`useBotUnread` / `useBotAttention` 是 hook，不能进 map —— 与 `BotRosterRow` 同款用法）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  activeFilterCount,
  botActivityMs,
  botMatchesQuery,
  filterHiddenBots,
  filterHiddenRooms,
  gatewayOptions,
  isBotPinned,
  kindAllowsBots,
  kindAllowsRooms,
  matchesActivityFilter,
  roomActivityMs,
  roomMatchesFilters,
  sortByPinThenActivity,
  type RosterActivityFilter,
  type RosterKindFilter,
  type RosterRowMeta,
} from '../lib/roster-filter';
import { ACTIVE_WINDOW_S, isBotActive, isBotWorkerActive, isGatewayBusy } from '../lib/bot-activity';
import { findMemberRoutingRow } from '../lib/bot-members';
import { sortRosterRooms } from '../lib/group-order';
import {
  getUnionRoster,
  isRoomsLoaded,
  useRooms,
  useUnionRoster,
  type UnionRosterRow,
} from '../plugins/bots/state';
import type { BotRoom } from '../utils/api';

/** 私聊分组的筛选态（与 BotsPane 的工具条四件套同名同义）。 */
export interface AgentPanelFilterState {
  query: string;
  kindFilter: RosterKindFilter;
  activityFilter: RosterActivityFilter;
  gatewayFilter: string;
  /** 「显示已隐藏」（session-only，对齐 Hermes `$showHiddenBots`） */
  showHidden: boolean;
}

export interface PrivateChatRows {
  /** 已排序 + 已过滤的私聊行（含"显示已隐藏"展开判定） */
  rows: UnionRosterRow[];
  /** 原始 union 花名册（供连接选项 / 计数） */
  all: UnionRosterRow[];
  /** 是否存在筛选约束（有约束时强制展开隐藏项，对齐 Hermes `showHiddenRows`） */
  hasConstraint: boolean;
  /** 已隐藏的 Agent 行数（服务端 `pinned/hidden` 偏好） */
  hiddenCount: number;
  /** roster 是否尚未首次就绪（首帧空态与"真的没有 Agent"要区分） */
  loading: boolean;
  /** 连接过滤选项 */
  gatewayChoices: Array<{ id: string; label: string }>;
}

/** Agent 行的过滤元数据（活跃度 = max(创建, 最近活动)；`active` = chat/worker/gateway 三路之一）。
 *  与 `BotsPane.tsx:299-307` 的 `botRowMeta` 同款——判据在 lib，此处只是取值。 */
export function botRowMeta(row: UnionRosterRow): RosterRowMeta {
  return {
    active:
      isBotActive(row.entry.last_active) ||
      isBotWorkerActive(row.entry.worker_session) ||
      isGatewayBusy(row.entry.busy),
    activity: botActivityMs(row.entry),
  };
}

/**
 * 私聊分组的纯编排（无 hook，可单测）。
 *
 * 顺序与 `BotsPane` 的 Agent 行管线逐字一致：
 *   `sortByPinThenActivity(搜索通过项, pin, 活动度)` → 连接过滤 → 活跃度过滤 → 隐藏展开。
 */
export function derivePrivateChatRows(
  bots: UnionRosterRow[],
  opts: AgentPanelFilterState,
): { rows: UnionRosterRow[]; hasConstraint: boolean; hiddenCount: number } {
  const { query, kindFilter, activityFilter, gatewayFilter, showHidden } = opts;

  const hasConstraint =
    Boolean(query.trim()) || activeFilterCount(kindFilter, activityFilter, gatewayFilter) > 0;
  const hiddenCount = bots.filter((r) => r.entry.hidden).length;

  // 类型过滤不允许 Agent（「只看群聊」）→ 本分组为空
  if (!kindAllowsBots(kindFilter)) {
    return { rows: [], hasConstraint, hiddenCount };
  }

  const filtered = sortByPinThenActivity(
    bots.filter((r) => botMatchesQuery(r.entry, r.connectionLabel, query)),
    (r) => isBotPinned(r.entry),
    (r) => botActivityMs(r.entry),
  )
    .filter((r) => gatewayFilter === 'all' || r.connectionId === gatewayFilter)
    .filter((r) => matchesActivityFilter(botRowMeta(r), activityFilter));

  return {
    rows: filterHiddenBots(filtered, showHidden || hasConstraint),
    hasConstraint,
    hiddenCount,
  };
}

/** 私聊分组的 hook 包装（订阅 union roster store；roster 是单一权威，组件不再各自拉取）。 */
export function usePrivateChatRows(opts: AgentPanelFilterState): PrivateChatRows {
  const bots = useUnionRoster();

  // 首帧与"真的没有 Agent"要区分：store 有过内容即视为已就绪（不清空，单调）
  const [ready, setReady] = useState(() => getUnionRoster().length > 0);
  useEffect(() => {
    if (!ready && bots.length > 0) setReady(true);
  }, [bots.length, ready]);

  const derived = useMemo(() => derivePrivateChatRows(bots, opts), [
    bots,
    opts.query,
    opts.kindFilter,
    opts.activityFilter,
    opts.gatewayFilter,
    opts.showHidden,
  ]);

  const gatewayChoices = useMemo(() => gatewayOptions(bots), [bots]);

  return {
    rows: derived.rows,
    all: bots,
    hasConstraint: derived.hasConstraint,
    hiddenCount: derived.hiddenCount,
    loading: !ready,
    gatewayChoices,
  };
}

/** Agent 面板的筛选态容器（私聊 + 群聊**共用一套**；父组件持有 state）。
 *  🔴 返回值用 useMemo 固定引用——消费者（如面板的 `filtersPatch`）依赖它做 memo，
 *  每次渲染新建对象会让那些 memo 全部失效。 */
export function useAgentPanelFilters() {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<RosterKindFilter>('all');
  const [activityFilter, setActivityFilter] = useState<RosterActivityFilter>('all');
  const [gatewayFilter, setGatewayFilter] = useState('all');
  const [showHidden, setShowHidden] = useState(false);

  const reset = useCallback(() => {
    setQuery('');
    setKindFilter('all');
    setActivityFilter('all');
    setGatewayFilter('all');
  }, []);

  /** 收敛补丁入口：面板只需一个稳定函数把 patch 打到对应 setter（避免回调里重复分派） */
  const patch = useCallback((p: Partial<AgentPanelFilterState>) => {
    if (p.query !== undefined) setQuery(p.query);
    if (p.kindFilter !== undefined) setKindFilter(p.kindFilter);
    if (p.activityFilter !== undefined) setActivityFilter(p.activityFilter);
    if (p.gatewayFilter !== undefined) setGatewayFilter(p.gatewayFilter);
    if (p.showHidden !== undefined) setShowHidden(p.showHidden);
  }, []);

  return useMemo(
    () => ({
      state: { query, kindFilter, activityFilter, gatewayFilter, showHidden } as AgentPanelFilterState,
      patch,
      reset,
      setQuery,
      setKindFilter,
      setActivityFilter,
      setGatewayFilter,
      setShowHidden,
    }),
    [query, kindFilter, activityFilter, gatewayFilter, showHidden, patch, reset],
  );
}

// ══════════════════════════════════════════════════════════════════════
// 群聊分组（Agent 面板第③段的另一半）
// ══════════════════════════════════════════════════════════════════════


export interface RoomRows {
  /** 展示序（pin band → roster_order → 活动度）——**未过滤**，供上/下移的邻居判定 */
  ordered: BotRoom[];
  /** 已过滤 + 隐藏展开后的可见行 */
  rows: BotRoom[];
  /** 可见行 id（上/下移的"邻居范围"，对齐 Hermes `reorderGroupRows(..., visible)`） */
  visibleIds: string[];
  hasConstraint: boolean;
  hiddenCount: number;
  /** 房间列表是否完成首拉（rooms store 的 loaded 标志） */
  loaded: boolean;
}

/** 房间行的过滤元数据：`active` = 最近消息落在 90s 窗内 **或** 任一成员正活跃
 *  （对齐 Hermes groupRows；成员活跃走共享真值 `findMemberRoutingRow`——显式优先本机行）。 */
export function roomRowMetaFor(room: BotRoom, bots: readonly UnionRosterRow[]): RosterRowMeta {
  const activity = roomActivityMs(room);
  const recentMsg = activity > 0 && Date.now() - activity <= ACTIVE_WINDOW_S * 1000;
  const memberActive = room.members.some((m) => {
    const row = findMemberRoutingRow(bots, m);
    return row
      ? isBotActive(row.entry.last_active) ||
          isBotWorkerActive(row.entry.worker_session) ||
          isGatewayBusy(row.entry.busy)
      : false;
  });
  return { active: recentMsg || memberActive, activity };
}

/** 群聊分组的纯编排（无 hook，可单测）。顺序与旧 BotsPane:336-369 逐字一致：
 *  展示序 → 搜索/连接 → 活跃度 → 隐藏展开（`showHidden || hasConstraint`）。 */
export function deriveRoomRows(
  rooms: BotRoom[],
  bots: readonly UnionRosterRow[],
  opts: AgentPanelFilterState,
): { rows: BotRoom[]; ordered: BotRoom[]; visibleIds: string[]; hasConstraint: boolean; hiddenCount: number } {
  const { query, kindFilter, activityFilter, gatewayFilter, showHidden } = opts;

  const hasConstraint =
    Boolean(query.trim()) || activeFilterCount(kindFilter, activityFilter, gatewayFilter) > 0;
  const hiddenCount = rooms.filter((r) => r.hidden).length;

  // 🔴 展示序基于**全部**房间（不过滤）——隐藏/被筛掉的房间保留槽位，
  //    这是"上/下移时邻居判定"能成立的前提（对齐 round-111）。
  const ordered = sortRosterRooms(rooms, roomActivityMs);

  const visible = kindAllowsRooms(kindFilter)
    ? ordered
        .filter((r) => roomMatchesFilters(r, bots, query, gatewayFilter))
        .filter((r) => matchesActivityFilter(roomRowMetaFor(r, bots), activityFilter))
    : [];

  const rows = filterHiddenRooms(visible, showHidden || hasConstraint);

  return { rows, ordered, visibleIds: rows.map((r) => r.room_id), hasConstraint, hiddenCount };
}

/** 群聊分组 hook（订阅 rooms store；房间数据归插件域单一权威）。 */
export function useRoomRows(opts: AgentPanelFilterState): RoomRows {
  const rooms = useRooms();
  const bots = useUnionRoster();

  const derived = useMemo(() => deriveRoomRows(rooms, bots, opts), [
    rooms,
    bots,
    opts.query,
    opts.kindFilter,
    opts.activityFilter,
    opts.gatewayFilter,
    opts.showHidden,
  ]);

  return {
    ordered: derived.ordered,
    rows: derived.rows,
    visibleIds: derived.visibleIds,
    hasConstraint: derived.hasConstraint,
    hiddenCount: derived.hiddenCount,
    loaded: isRoomsLoaded(),
  };
}
