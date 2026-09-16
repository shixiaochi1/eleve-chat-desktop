/**
 * AgentPanelToolbar — Agent 面板「③群聊 + 私聊区」的统一工具栏。
 *
 * 🔴 2026-09-16 round-116 P4（Agent 面板整合）：旧 `BotsPane` 的工具条
 * （搜索 + 类型/活跃度/连接三组筛选）迁入 Agent 面板，**一份作用于两个分组**
 * （群聊 + 私聊），因为两个分组共用同一套筛选态（`AgentPanelFilterState`）。
 *
 * 选项文案与旧面板逐字一致（避免两套说法）；筛选分组控件复用旧面板的
 * `FilterGroup`（`components/BotsPane.tsx` 仅加 `export`，逻辑零改动）。
 */
import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { FilterGroup } from '../BotsPane';
import {
  activeFilterCount,
  type RosterActivityFilter,
  type RosterKindFilter,
} from '../../lib/roster-filter';
import type { AgentPanelFilterState } from '../../hooks/useAgentPanelData';

export interface AgentPanelToolbarProps {
  filters: AgentPanelFilterState;
  gatewayChoices: Array<{ id: string; label: string }>;
  /** 条目总数（用于"是否值得显示工具栏"的阈值判定，对齐 Hermes `showRosterTools`） */
  itemCount: number;
  thresholds?: number;
  onPatch: (patch: Partial<AgentPanelFilterState>) => void;
  onReset: () => void;
}

export default function AgentPanelToolbar({
  filters,
  gatewayChoices,
  itemCount,
  thresholds = 8,
  onPatch,
  onReset,
}: AgentPanelToolbarProps) {
  const [open, setOpen] = useState(false);

  const filterCount = activeFilterCount(
    filters.kindFilter,
    filters.activityFilter,
    filters.gatewayFilter,
  );
  const hasConstraint = Boolean(filters.query.trim()) || filterCount > 0;
  // 单连接 + 条目少 + 无约束 → 不占地方（对齐 Hermes `showRosterTools`）
  const show = gatewayChoices.length > 1 || itemCount >= thresholds || hasConstraint;

  if (!show) return null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-1 border-b border-[var(--ui-stroke-tertiary)] shrink-0">
      <div className="relative flex-1 min-w-0">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filters.query}
          onChange={(e) => onPatch({ query: e.target.value })}
          placeholder={filters.kindFilter === 'groups' ? '搜索群聊…' : '搜索 Agent 或群聊…'}
          className="w-full h-[24px] pl-[22px] pr-2 rounded-md bg-accent/30 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[11px] transition-colors',
            filterCount > 0
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
          title="筛选"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <SlidersHorizontal size={12} />
          筛选
          {filterCount > 0 && (
            <span className="ml-0.5 rounded-full bg-primary/25 px-1 tabular-nums">{filterCount}</span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-[26px] z-30 w-44 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-popover text-popover-foreground py-1 shadow-xl">
            <FilterGroup
              label="类型"
              options={[['all', '全部'], ['bots', '只看 Agent'], ['groups', '只看群聊']]}
              value={filters.kindFilter}
              onSelect={(v) => onPatch({ kindFilter: v as RosterKindFilter })}
            />
            <FilterGroup
              label="活跃度"
              options={[['all', '全部'], ['active', '活跃中'], ['recent', '最近 7 天'], ['older', '更早']]}
              value={filters.activityFilter}
              onSelect={(v) => onPatch({ activityFilter: v as RosterActivityFilter })}
            />
            {gatewayChoices.length > 1 && (
              <FilterGroup
                label="连接"
                options={[['all', '全部连接'], ...gatewayChoices.map((g) => [g.id, g.label] as [string, string])]}
                value={filters.gatewayFilter}
                onSelect={(v) => onPatch({ gatewayFilter: v })}
              />
            )}
            {hasConstraint && (
              <button
                type="button"
                className="w-full mt-0.5 border-t border-[var(--ui-stroke-tertiary)] px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground text-left"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                清除全部筛选
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
