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
  gatewayOptions,
  isBotPinned,
  kindAllowsBots,
  matchesActivityFilter,
  sortByPinThenActivity,
  type RosterActivityFilter,
  type RosterKindFilter,
  type RosterRowMeta,
} from '../lib/roster-filter';
import { isBotActive, isBotWorkerActive, isGatewayBusy } from '../lib/bot-activity';
import { getUnionRoster, useUnionRoster, type UnionRosterRow } from '../plugins/bots/state';

/** 私聊分组的筛选态（与 BotsPane 的工具条四件套同名同义）。 */
export interface PrivateChatFilterState {
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
  opts: PrivateChatFilterState,
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
export function usePrivateChatRows(opts: PrivateChatFilterState): PrivateChatRows {
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

/** 私聊分组的筛选态容器（三个面板共用一套默认值；父组件持有 state）。 */
export function usePrivateChatFilters() {
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

  return {
    state: { query, kindFilter, activityFilter, gatewayFilter, showHidden } as PrivateChatFilterState,
    setQuery,
    setKindFilter,
    setActivityFilter,
    setGatewayFilter,
    setShowHidden,
    reset,
  };
}
