/**
 * PrivateChatSection — Agent 面板「③群聊 + 私聊区」的**私聊分组**。
 *
 * 🔴 2026-09-16 round-116 P2（Agent 面板整合）：群聊 + 私聊并入 Agent 侧边页。
 * 本分组 = 每个 Agent 一行，**单击打开它的常驻私聊**（不切身份——切身份仍归卡片区）。
 *
 * 语义依据（见 docs/hermes-parity-frontend-review-20260916.md 追加 6）：
 *   - 私聊 = per-Agent 一对一常驻通道（标题唯一 `"Bot Chat"`）⇒ 天然属于某个 Agent
 *   - 数据源 = union roster（本机 + 全部远端连接）⇒ 远端 Agent 的入口落在这里
 *     （卡片区保持本机 `profiles.list`，故远端不做卡片）
 *
 * 分工（抑制"卡片 vs 私聊行"观感重复）：
 *   - 卡片 = 身份档案（model / provider / 技能数，**不含运行态**）
 *   - 本分组行 = 聊天入口（活跃 / 未读 / attention / 连接标）
 *
 * 编排（过滤 + 排序）全部来自 `hooks/useAgentPanelData.ts`（判据在 lib/，单份）；
 * 本组件只管渲染与回调透出——筛选 state 由父组件持有（工具栏作用于群聊 + 私聊两组）。
 */
import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { PrivateChatRow } from './PrivateChatRow';
import {
  usePrivateChatRows,
  type PrivateChatFilterState,
} from '../../hooks/useAgentPanelData';
import { rosterRowKey } from '../../lib/bot-members';
import type { UnionRosterRow } from '../../plugins/bots/state';

export interface PrivateChatSectionProps {
  /** 筛选态（父组件持有；工具栏作用于两个分组） */
  filters: PrivateChatFilterState;
  /** 本机 Agent：打开它的常驻私聊（App.handleOpenBotChat） */
  onOpenBotChat: (profile: string) => void;
  /** 远端 Agent：就绪远端 Bot Chat（骑 owner 连接）+ 主区导航 */
  onOpenRemoteChat: (row: UnionRosterRow) => void;
  /** 右键菜单锚点（菜单由父组件渲染，含 编辑/复制/置顶/隐藏） */
  onRowMenu?: (row: UnionRosterRow, x: number, y: number) => void;
  /** 分组标题右侧的"显示已隐藏"开关（父组件统一持有 showHidden） */
  onToggleShowHidden?: () => void;
  /** 分区容器类（父组件控制高度/滚动） */
  className?: string;
}

export default function PrivateChatSection({
  filters,
  onOpenBotChat,
  onOpenRemoteChat,
  onRowMenu,
  onToggleShowHidden,
  className,
}: PrivateChatSectionProps) {
  const { rows, all, loading, hiddenCount } = usePrivateChatRows(filters);

  // 隐藏项：有筛选约束时强制展开（`usePrivateChatRows` 已按同一判据产出 rows），
  // 这里只判断"是否处于强制展开"，用于标题右侧提示（与旧面板文案一致）
  const hiddenExpanded = filters.showHidden || Boolean(filters.query.trim());

  const emptyText = useMemo(() => {
    if (loading) return '加载中…';
    if (all.length === 0) return '暂无已注册 Agent';
    return filters.query.trim() ? '没有匹配的私聊' : '全部 Agent 已隐藏';
  }, [loading, all.length, filters.query]);

  return (
    <section className={cn('flex flex-col min-h-0', className)} aria-label="私聊">
      {/* 分组头：标题 + 计数 + 隐藏项开关（对齐旧面板的 section 头 + round-109 的"已隐藏"入口） */}
      <div className="flex items-center gap-1.5 px-1 mb-1.5 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          私聊
        </span>
        {!loading && rows.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/50">{rows.length}</span>
        )}
        {hiddenCount > 0 && onToggleShowHidden && (
          <button
            type="button"
            onClick={onToggleShowHidden}
            className="ml-auto text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
            title={`已隐藏 ${hiddenCount} 个 Agent`}
          >
            {filters.showHidden ? '收起隐藏项' : `已隐藏 ${hiddenCount}`}
          </button>
        )}
      </div>

      {/* 行列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-1 space-y-1">
        {rows.map((row) => (
          <PrivateChatRow
            // 🔴 round-111：键 = 连接作用域（跨连接同名 profile 不共用槽位/未读水位）
            key={rosterRowKey(row)}
            row={row}
            // 已隐藏但在"显示已隐藏"下露出的行 → 淡化（与旧面板同款）
            dimmed={Boolean(row.entry.hidden) && hiddenExpanded}
            onOpen={() => (row.isRemote ? onOpenRemoteChat(row) : onOpenBotChat(row.entry.profile))}
            onRowMenu={(x, y) => onRowMenu?.(row, x, y)}
          />
        ))}

        {rows.length === 0 && (
          <div className="text-xs text-muted-foreground/70 px-2 py-1.5">{emptyText}</div>
        )}
      </div>
    </section>
  );
}
