/**
 * UsagePanel — Usage analytics panel
 *
 * Summary cards, per-session breakdown table, model distribution bar chart.
 * Uses useUsage hook internally — expects sessionId, sessions, sessionTitles,
 * tokensIn, tokensOut, monitorState from parent.
 */
import { useState } from 'react';
import { useUsage } from '../hooks/useUsage';
import {
  BarChart3, TrendingUp, Cpu, Zap, ArrowUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
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

interface UsagePanelProps {
  sessionId?: string;
  sessions?: Array<{ id?: string; title?: string | null; last_active?: number }>;
  sessionTitles?: Record<string, string>;
  tokensIn?: number;
  tokensOut?: number;
  monitorState?: { modelName?: string };
}

export default function UsagePanel({
  sessionId,
  sessions,
  sessionTitles,
  tokensIn,
  tokensOut,
  monitorState,
}: UsagePanelProps) {
  const {
    summary,
    sessionUsage,
    modelDistribution,
    loading,
    error,
    refresh,
    dataSource,
  } = useUsage({
    sessions: (sessions || []) as Array<{ id?: string; title?: string; last_active?: number }>,
    sessionId,
    tokensIn: tokensIn || 0,
    tokensOut: tokensOut || 0,
    modelName: monitorState?.modelName || null,
    sessionTitles: sessionTitles || {},
  });

  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedUsage = [...sessionUsage].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'date') cmp = a.date.getTime() - b.date.getTime();
    else if (sortField === 'tokensIn') cmp = a.tokensIn - b.tokensIn;
    else if (sortField === 'tokensOut') cmp = a.tokensOut - b.tokensOut;
    else if (sortField === 'title') cmp = a.title.localeCompare(b.title);
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const modelNames = Object.keys(modelDistribution);
  const totalSessions = modelNames.reduce((sum, m) => sum + modelDistribution[m], 0);
  const maxModelCount = Math.max(...modelNames.map((m) => modelDistribution[m]), 1);

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
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
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
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Top bar: refresh */}
      <div className="flex items-center justify-between">
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={refresh} disabled={loading}>
          <Zap size={12} />
          {loading ? '刷新中…' : '刷新'}
        </button>
        <span className="text-xs text-muted-foreground/60">用量数据</span>
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 p-2 rounded border border-border bg-card">
          <div className="shrink-0" style={{ color: 'var(--accent)' }}>
            <TrendingUp size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground">{fmtNum(summary.totalTokensIn)}</span>
            <span className="text-[10px] text-muted-foreground">输入 Tokens</span>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 rounded border border-border bg-card">
          <div className="shrink-0" style={{ color: 'var(--ui-purple)' }}>
            <Cpu size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground">{fmtNum(summary.totalTokensOut)}</span>
            <span className="text-[10px] text-muted-foreground">输出 Tokens</span>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 rounded border border-border bg-card">
          <div className="shrink-0" style={{ color: 'var(--success)' }}>
            <BarChart3 size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground">{summary.sessionCount}</span>
            <span className="text-[10px] text-muted-foreground">总会话数</span>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 rounded border border-border bg-card">
          <div className="shrink-0" style={{ color: 'var(--ui-yellow)' }}>
            <TrendingUp size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground">{fmtNum(summary.avgTokensPerSession)}</span>
            <span className="text-[10px] text-muted-foreground">平均 Tokens/会话</span>
          </div>
        </div>
      </div>

      {/* Model Distribution */}
      {modelNames.length > 0 && (
        <div className="space-y-1">
          <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Cpu size={13} /> 模型分布
          </h3>
          <div className="space-y-1">
            {modelNames.map((model) => {
              const count = modelDistribution[model];
              const pct = totalSessions > 0 ? (count / totalSessions) * 100 : 0;
              return (
                <div key={model} className="flex items-center gap-2 text-xs">
                  <span className="w-16 truncate text-muted-foreground shrink-0" title={model}>{model}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 w-10 text-right shrink-0">{count} 会话</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-Session Breakdown */}
      <div className="space-y-1 flex-1 min-h-0">
        <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <BarChart3 size={13} /> 会话用量明细
        </h3>
        <div className="overflow-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th onClick={() => handleSort('title')} className="px-1.5 py-1 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  会话 <SortIcon field="title" />
                </th>
                <th className="px-1.5 py-1 text-left font-medium text-muted-foreground">模型</th>
                <th onClick={() => handleSort('tokensIn')} className="px-1.5 py-1 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  输入 <SortIcon field="tokensIn" />
                </th>
                <th onClick={() => handleSort('tokensOut')} className="px-1.5 py-1 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  输出 <SortIcon field="tokensOut" />
                </th>
                <th onClick={() => handleSort('date')} className="px-1.5 py-1 text-right font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                  时间 <SortIcon field="date" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedUsage.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-1.5 py-3 text-center text-muted-foreground/50">暂无数据</td>
                </tr>
              ) : (
                sortedUsage.map((s) => (
                  <tr key={s.sessionId} className="border-b border-border/50 last:border-0 hover:bg-accent/5">
                    <td className="px-1.5 py-1 max-w-24 truncate text-foreground" title={s.title}>{s.title}</td>
                    <td className="px-1.5 py-1 text-muted-foreground">{s.model}</td>
                    <td className="px-1.5 py-1 text-right text-muted-foreground">{fmtNum(s.tokensIn)}</td>
                    <td className="px-1.5 py-1 text-right text-muted-foreground">{fmtNum(s.tokensOut)}</td>
                    <td className="px-1.5 py-1 text-right text-muted-foreground/50">{fmtDate(s.date)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
