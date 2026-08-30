/**
 * UsagePanel — Usage analytics panel v2 (2026-08-20)
 *
 * 🔴 v2 重构（对齐后端 usage_analytics v2 + 用户核心诉求"主会话/子Agent分开"）：
 * - 主会话组 / 子 Agent 组 / 全部 三组统计卡（输入/输出/缓存读/缓存写/命中率/费用）
 * - 命中率公式（对齐 DSH）：hit = cacheRead / (input + cacheRead + cacheWrite)
 * - 明细表按父会话分组折叠：主会话为一级行，其派生子 Agent 缩进折叠
 * - 类型筛选（全部 | 主会话 | 子 Agent）
 * - 子 Agent 按父会话归组小表（by_parent）
 * - 按日趋势（daily：输入 + 缓存读 叠柱）
 * - 模型分布升级（token 维度 + 命中率）
 */
import { useMemo, useState } from 'react';
import { useUsage, type KindSummaryItem, type DailyTrendPoint, type SessionUsageItem } from '../hooks/useUsage';
import { useMonitorTokens, useMonitorModelName } from '../store/debug';
import {
  BarChart3, TrendingUp, Cpu, Zap, ArrowUpDown, ChevronDown, ChevronRight, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  if (!n || n <= 0) return '$0';
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(2);
}

function fmtDate(d: Date): string {
  if (!d || isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}小时前`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}天前`;
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  return `${mm}月${dd}日`;
}

/** 命中率徽标（对齐 CardContextGauge 色彩约定：>=80 primary / >=40 默认 / 低 muted） */
function HitBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) {
    return <span className="text-muted-foreground/40">—</span>;
  }
  return (
    <span className={cn(
      'tabular-nums font-medium',
      pct >= 80 ? 'text-primary' : pct >= 40 ? 'text-foreground' : 'text-muted-foreground',
    )}>
      {pct}%
    </span>
  );
}

interface UsagePanelProps {
  sessionId?: string;
  sessions?: Array<{ id?: string; title?: string | null; last_active?: number }>;
  sessionTitles?: Record<string, string>;
}

/** 一组统计卡（6 指标格） */
function StatGroup({ title, icon, color, data, badge }: {
  title: string;
  icon: React.ReactNode;
  color: string;
  data: KindSummaryItem;
  badge?: React.ReactNode;
}) {
  const cells = [
    { label: '输入', value: fmtNum(data.input), color: 'var(--accent)' },
    { label: '输出', value: fmtNum(data.output), color: 'var(--ui-purple)' },
    { label: '缓存读', value: fmtNum(data.cacheRead), color: 'var(--success)' },
    { label: '缓存写', value: fmtNum(data.cacheWrite), color: 'var(--ui-yellow)' },
    { label: '命中率', value: data.hitPercent === null ? '—' : `${data.hitPercent}%`, color: 'var(--primary)' },
    { label: '费用', value: fmtCost(data.cost), color: 'var(--destructive)' },
  ];
  return (
    <div className="rounded border border-[var(--ui-stroke-tertiary)] bg-card p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground" style={{ color }}>
          {icon} {title}
        </span>
        {badge}
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1">
        {cells.map((c) => (
          <div key={c.label} className="flex flex-col min-w-0">
            <span className="text-[10px] text-muted-foreground/60">{c.label}</span>
            <span className="text-xs font-semibold tabular-nums truncate" style={{ color: c.color }}>{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UsagePanel({
  sessionId,
  sessions,
  sessionTitles,
}: UsagePanelProps) {
  // 🔴 2026-08-10 修复：App 层不传 tokensIn/tokensOut/monitorState（props 恒 0 →
  // 本地会话明细缓存全写 0）。改用 debug store 的 useMonitorTokens/useMonitorModelName
  // （useMessageStream 每轮 SSE usage 累计，同一数据源）。
  const { tokensIn, tokensOut } = useMonitorTokens();
  const modelName = useMonitorModelName();
  const {
    kindSummary,
    byParent,
    sessionUsage,
    modelDistribution,
    dailyTrend,
    loading,
    error,
    refresh,
    dataSource,
  } = useUsage({
    sessions: (sessions || []) as Array<{ id?: string; title?: string | null; last_active?: number }>,
    sessionId,
    tokensIn: tokensIn || 0,
    tokensOut: tokensOut || 0,
    modelName: modelName || null,
    sessionTitles: sessionTitles || {},
  });

  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [kindFilter, setKindFilter] = useState<'all' | 'main' | 'subagent'>('all');
  // 🔴 v2：明细按父会话折叠——默认展开所有主会话行
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // ── 明细树：主会话为父行，子 Agent 按 parentSessionId 归组 ──
  const tree = useMemo(() => {
    const mains = sessionUsage.filter((s) => s.kind === 'main');
    const subs = sessionUsage.filter((s) => s.kind === 'subagent');
    const childrenOf = (id: string) => subs.filter((s) => s.parentSessionId === id);
    const parentIds = new Set(mains.map((m) => m.sessionId));
    const orphanSubs = subs.filter((s) => !s.parentSessionId || !parentIds.has(s.parentSessionId));
    const rows = [
      ...mains.map((m) => ({ ...m, children: childrenOf(m.sessionId) })),
      ...orphanSubs.map((s) => ({ ...s, children: [] as typeof subs })),
    ];
    // 排序（父行按其主键；子行跟随父行不参与全局排序）
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.getTime() - b.date.getTime();
      else if (sortField === 'tokensIn') cmp = a.tokensIn - b.tokensIn;
      else if (sortField === 'tokensOut') cmp = a.tokensOut - b.tokensOut;
      else if (sortField === 'hitPercent') cmp = (a.hitPercent ?? -1) - (b.hitPercent ?? -1);
      else if (sortField === 'title') cmp = a.title.localeCompare(b.title);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return rows;
  }, [sessionUsage, sortField, sortDir]);

  const filteredTree = useMemo(() => {
    if (kindFilter === 'main') return tree.filter((t) => t.kind === 'main');
    if (kindFilter === 'subagent') return tree.filter((t) => t.kind === 'subagent');
    return tree;
  }, [tree, kindFilter]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(tree.filter((t) => t.kind === 'main').map((t) => t.sessionId)));
  const collapseAll = () => setExpanded(new Set());

  const modelNames = Object.keys(modelDistribution);
  const maxModelTokens = Math.max(...modelNames.map((m) => modelDistribution[m].input + modelDistribution[m].output), 1);

  const SortIcon = ({ field }: { field: string }) => (
    sortField === field ? <ArrowUpDown size={10} className="inline-block text-muted-foreground" /> : null
  );

  // Loading state — skeleton cards
  if (loading && !sessionUsage.length) {
    return (
      <div className="flex flex-col h-full p-3 gap-3">
        <div className="flex items-center justify-between">
          <div />
          <span className="text-xs text-muted-foreground/60">用量数据</span>
          <span className="px-1 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">加载中…</span>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="skeleton-card w-full" />
          ))}
        </div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="flex-1 w-full rounded-lg" />
      </div>
    );
  }

  // Empty state
  if (!sessionUsage.length && !loading) {
    return (
      <div className="flex flex-col h-full p-3 gap-3">
        <div className="flex items-center justify-between">
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={refresh}>
            <Zap size={12} /> 刷新
          </button>
          <span className="text-xs text-muted-foreground/60">用量数据</span>
          <span className={cn(
            'px-1 py-0.5 text-[10px] rounded',
            dataSource === 'server' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
          )}>
            {dataSource === 'server' ? '服务端统计' : '本地统计'}
          </span>
        </div>
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <BarChart3 size={24} strokeWidth={1} className="text-muted-foreground/30" />
          <span className="text-xs">暂无用量数据</span>
          <span className="text-[10px] text-muted-foreground/50">开始对话后自动统计</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 gap-3 overflow-y-auto">
      {/* Top bar: refresh */}
      <div className="flex items-center justify-between shrink-0">
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={refresh} disabled={loading}>
          <Zap size={12} />
          {loading ? '刷新中…' : '刷新'}
        </button>
        <span className="text-xs text-muted-foreground/60">用量数据 · 近30天</span>
        <span className={cn(
          'px-1 py-0.5 text-[10px] rounded',
          dataSource === 'server' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
        )}>
          {dataSource === 'server' ? '服务端统计' : '本地统计'}
        </span>
      </div>

      {error && (
        <div className="px-2 py-1 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">{error}</div>
      )}

      {/* ── 主会话 / 子Agent / 全部 三组统计卡 ── */}
      <div className="grid grid-cols-1 gap-2 shrink-0">
        <StatGroup
          title="主会话"
          icon={<Layers size={12} />}
          color="var(--accent)"
          data={kindSummary.main}
          badge={
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">{kindSummary.main.sessions} 个会话</span>
          }
        />
        <StatGroup
          title="子 Agent"
          icon={<TrendingUp size={12} />}
          color="var(--ui-purple)"
          data={kindSummary.subagent}
          badge={
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">{kindSummary.subagent.sessions} 个会话</span>
          }
        />
        <StatGroup
          title="全部合计"
          icon={<BarChart3 size={12} />}
          color="var(--foreground)"
          data={kindSummary.total}
          badge={
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">{kindSummary.total.sessions} 个会话</span>
          }
        />
      </div>

      {/* ── 子 Agent 按父会话归组（by_parent）── */}
      {byParent.length > 0 && (
        <div className="space-y-1 shrink-0">
          <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <TrendingUp size={13} /> 子 Agent 按主会话归组
          </h3>
          <div className="overflow-auto border border-[var(--ui-stroke-tertiary)] rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--ui-stroke-tertiary)] bg-muted/30">
                  <th className="px-1.5 py-1 text-left font-medium text-muted-foreground">父会话</th>
                  <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">子会话</th>
                  <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">输入</th>
                  <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">缓存读</th>
                  <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">命中率</th>
                  <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">费用</th>
                </tr>
              </thead>
              <tbody>
                {byParent.map((g) => (
                  <tr key={g.parentId} className="border-b border-[var(--ui-stroke-tertiary)] last:border-0 hover:bg-accent/5">
                    <td className="px-1.5 py-1 max-w-28 truncate" title={g.parentTitle}>{g.parentTitle}</td>
                    <td className="px-1.5 py-1 text-right text-muted-foreground">{g.childSessions}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(g.input)}</td>
                    <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(g.cacheRead)}</td>
                    <td className="px-1.5 py-1 text-right"><HitBadge pct={g.hitPercent} /></td>
                    <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtCost(g.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 按日趋势（输入 + 缓存读 叠柱）── */}
      {dailyTrend.length > 0 && (
        <div className="space-y-1 shrink-0">
          <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <BarChart3 size={13} /> 按日趋势
            <span className="ml-auto flex items-center gap-2 text-[10px] font-normal">
              <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-sm bg-primary/70" />输入</span>
              <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-sm bg-success/70" />缓存读</span>
            </span>
          </h3>
          <TrendChart data={dailyTrend} />
        </div>
      )}

      {/* ── 模型分布（token 维度 + 命中率）── */}
      {modelNames.length > 0 && (
        <div className="space-y-1 shrink-0">
          <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Cpu size={13} /> 模型分布
          </h3>
          <div className="space-y-1">
            {modelNames.map((model) => {
              const m = modelDistribution[model];
              const tokens = m.input + m.output;
              const pct = tokens > 0 ? (tokens / maxModelTokens) * 100 : 0;
              return (
                <div key={model} className="flex items-center gap-2 text-xs">
                  <span className="w-20 truncate text-muted-foreground shrink-0" title={model}>{model}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 w-14 text-right shrink-0 tabular-nums">
                    {fmtNum(tokens)} tok
                  </span>
                  <span className="w-12 text-right shrink-0"><HitBadge pct={m.hitPercent} /></span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 会话用量明细（按父会话折叠）── */}
      <div className="space-y-1 flex-1 min-h-0">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground shrink-0">
          <BarChart3 size={13} /> 会话用量明细
          <span className="ml-auto flex items-center gap-1 text-[10px] font-normal">
            {/* 类型筛选 */}
            <div className="flex items-center rounded border border-[var(--ui-stroke-tertiary)] overflow-hidden">
              {(['all', 'main', 'subagent'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={cn(
                    'px-1.5 py-0.5 text-[10px] transition-colors',
                    kindFilter === k ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {k === 'all' ? '全部' : k === 'main' ? '主会话' : '子Agent'}
                </button>
              ))}
            </div>
            <button type="button" onClick={expandAll} className="text-muted-foreground hover:text-foreground px-1">展开</button>
            <button type="button" onClick={collapseAll} className="text-muted-foreground hover:text-foreground px-1">收起</button>
          </span>
        </div>
        <div className="overflow-auto border border-[var(--ui-stroke-tertiary)] rounded max-h-72">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-[var(--ui-stroke-tertiary)] bg-muted/30">
                <th className="px-1.5 py-1 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => handleSort('title')}>
                  会话 <SortIcon field="title" />
                </th>
                <th className="px-1.5 py-1 text-left font-medium text-muted-foreground">模型</th>
                <th onClick={() => handleSort('tokensIn')} className="px-1.5 py-1 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  输入 <SortIcon field="tokensIn" />
                </th>
                <th onClick={() => handleSort('tokensOut')} className="px-1.5 py-1 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  输出 <SortIcon field="tokensOut" />
                </th>
                <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">缓存读</th>
                <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">缓存写</th>
                <th onClick={() => handleSort('hitPercent')} className="px-1.5 py-1 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  命中率 <SortIcon field="hitPercent" />
                </th>
                <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">费用</th>
                <th onClick={() => handleSort('date')} className="px-1.5 py-1 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  时间 <SortIcon field="date" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTree.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-1.5 py-3 text-center text-muted-foreground/50">暂无数据</td>
                </tr>
              ) : (
                filteredTree.map((row) => {
                  const isParent = row.kind === 'main';
                  const hasChildren = isParent && row.children.length > 0;
                  const isOpen = expanded.has(row.sessionId);
                  return (
                    <SessionRowGroup
                      key={row.sessionId}
                      row={row}
                      isOpen={isOpen}
                      onToggle={() => toggleExpand(row.sessionId)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <div className="w-5 h-5 border-2 border-[var(--ui-stroke-tertiary)] border-t-primary rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

/** 明细行 + 其折叠子行（子 Agent 缩进） */
function SessionRowGroup({ row, isOpen, onToggle }: {
  row: SessionUsageItem & { children: SessionUsageItem[] };
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isParent = row.kind === 'main';
  const hasChildren = isParent && row.children.length > 0;
  return (
    <>
      <tr className="border-b border-[var(--ui-stroke-tertiary)] last:border-0 hover:bg-accent/5">
        <td className="px-1.5 py-1">
          <span className="flex items-center gap-1 max-w-28">
            {isParent ? (
              <button
                type="button"
                onClick={onToggle}
                className="shrink-0 text-muted-foreground/60 hover:text-foreground cursor-pointer"
              >
                {hasChildren ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3 inline-block" />}
              </button>
            ) : (
              <span className="w-3 shrink-0 inline-block" />
            )}
            <span className={cn('truncate', row.kind === 'subagent' && 'text-muted-foreground')} title={row.title}>
              {row.title}
            </span>
          </span>
        </td>
        <td className="px-1.5 py-1">
          <span className="flex items-center gap-1">
            <span className={cn(
              'px-1 py-px text-[9px] rounded shrink-0',
              row.kind === 'main' ? 'bg-accent/10 text-accent' : 'bg-accent-purple/10 text-accent-purple',
            )}>
              {row.kind === 'main' ? '主' : '子'}
            </span>
            <span className="text-muted-foreground truncate">{row.model}</span>
          </span>
        </td>
        <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(row.tokensIn)}</td>
        <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(row.tokensOut)}</td>
        <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(row.cacheRead)}</td>
        <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(row.cacheWrite)}</td>
        <td className="px-1.5 py-1 text-right"><HitBadge pct={row.hitPercent} /></td>
        <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtCost(row.cost)}</td>
        <td className="px-1.5 py-1 text-right text-muted-foreground/50 whitespace-nowrap">{fmtDate(row.date)}</td>
      </tr>
      {isParent && hasChildren && isOpen && row.children.map((child) => (
        <tr key={child.sessionId} className="border-b border-[var(--ui-stroke-tertiary)] last:border-0 bg-muted/10">
          <td className="px-1.5 py-1 pl-6">
            <span className="flex items-center gap-1 max-w-24">
              <span className="w-3 shrink-0 inline-block" />
              <span className="truncate text-muted-foreground" title={child.title}>↳ {child.title}</span>
            </span>
          </td>
          <td className="px-1.5 py-1">
            <span className="flex items-center gap-1">
              <span className="px-1 py-px text-[9px] rounded bg-accent-purple/10 text-accent-purple shrink-0">子</span>
              <span className="text-muted-foreground truncate">{child.model}</span>
            </span>
          </td>
          <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(child.tokensIn)}</td>
          <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(child.tokensOut)}</td>
          <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(child.cacheRead)}</td>
          <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtNum(child.cacheWrite)}</td>
          <td className="px-1.5 py-1 text-right"><HitBadge pct={child.hitPercent} /></td>
          <td className="px-1.5 py-1 text-right tabular-nums text-muted-foreground">{fmtCost(child.cost)}</td>
          <td className="px-1.5 py-1 text-right text-muted-foreground/50 whitespace-nowrap">{fmtDate(child.date)}</td>
        </tr>
      ))}
    </>
  );
}

/** 按日趋势叠柱（输入 + 缓存读） */
function TrendChart({ data }: { data: DailyTrendPoint[] }) {
  const max = Math.max(...data.map((d) => d.input + d.cacheRead), 1);
  return (
    <div className="flex items-end gap-[2px] h-16 overflow-x-auto pb-1">
      {data.map((d) => {
        const hInput = Math.max((d.input / max) * 56, d.input > 0 ? 2 : 0);
        const hCache = Math.max((d.cacheRead / max) * 56, d.cacheRead > 0 ? 2 : 0);
        return (
          <div
            key={d.day}
            className="flex flex-col justify-end min-w-[14px] flex-1 group relative cursor-default"
            title={`${d.day}\n输入 ${fmtNum(d.input)} · 输出 ${fmtNum(d.output)}\n缓存读 ${fmtNum(d.cacheRead)} · 写 ${fmtNum(d.cacheWrite)}\n命中率 ${d.hitPercent === null ? '—' : d.hitPercent + '%'} · 费用 ${fmtCost(d.cost)}`}
          >
            <div className="flex flex-col-reverse gap-px w-full">
              <div style={{ height: hCache }} className="w-full rounded-sm bg-success/70" />
              <div style={{ height: hInput }} className="w-full rounded-sm bg-primary/70" />
            </div>
            <span className="text-[8px] text-muted-foreground/40 text-center leading-none mt-0.5 select-none">
              {d.day.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
