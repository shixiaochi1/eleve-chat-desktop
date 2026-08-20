/**
 * useUsage — Aggregate token usage & cache-hit & cost from session data
 *
 * 优先从后端 GET /api/analytics/usage 获取统计数据，
 * 失败时回退到 localStorage 本地统计。
 *
 * 🔴 2026-08-20 用量分析 v2（对齐后端 usage_analytics v2）：
 * - by_kind：主会话（parent IS NULL）与子 Agent（parent IS NOT NULL）分开聚合
 * - 缓存命中完整字段：cache_read / cache_write / cache_hit_percent
 *   （命中率公式对齐 DSH：hit = cacheRead / (input + cacheRead + cacheWrite)）
 * - by_parent：子 Agent 按父会话归组
 * - daily：按日趋势（输入/输出/缓存读/写/命中率/费用）
 * - 每会话明细：kind / parent_session_id / 缓存细账 / 估算费用
 *
 * Returns:
 *   summary: { totalTokensIn, totalTokensOut, sessionCount, avgTokensPerSession, totalCost, cacheHitPercent }
 *   kindSummary: { main, subagent } — 主/子两组 { input, output, cacheRead, cacheWrite, hitPercent, cost, sessions }
 *   byParent: 子 Agent 按父会话归组
 *   sessionUsage: per-session breakdown（含 kind/parent/缓存/费用）
 *   modelDistribution: { model -> { sessions, input, output, hitPercent } }
 *   dailyTrend: 按日趋势
 *   loading, error, refresh, dataSource
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import * as storage from '../utils/storage';
import { fetchAnalyticsUsage } from '../utils/api';

const USAGE_CACHE_KEY = 'usage_stats';

interface DailyEntry {
  tokens_in?: number;
  tokens_out?: number;
  sessions?: number;
  // 🔴 2026-08-10 适配后端真实字段（usage_analytics：daily[].input_tokens/output_tokens）
  input_tokens?: number;
  output_tokens?: number;
  /** 🔴 2026-08-20 v2：缓存细账 + 费用 */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cache_hit_percent?: number;
  estimated_cost?: number;
}

interface AnalyticsTotals {
  total_input?: number;
  total_output?: number;
  total_sessions?: number;
  total_cache_read?: number;
  total_cache_write?: number;
  cache_hit_percent?: number;
  total_estimated_cost?: number;
  // 兼容旧字段（早期本地版契约）
  total_tokens_in?: number;
  total_tokens_out?: number;
}

/** 🔴 2026-08-20 v2：主/子分组聚合项 */
interface KindStat {
  kind?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cache_hit_percent?: number;
  estimated_cost?: number;
  sessions?: number;
}

/** 🔴 2026-08-20 v2：子 Agent 按父会话归组项 */
interface ParentGroupRow {
  parent_session_id?: string;
  parent_title?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cache_hit_percent?: number;
  estimated_cost?: number;
  child_sessions?: number;
}

interface AnalyticsUsageResponse {
  daily?: DailyEntry[];
  totals?: AnalyticsTotals;
  /** 模型维度聚合（{model, sessions, input_tokens, output_tokens, cache_*}） */
  by_model?: Array<Record<string, unknown>>;
  /** 🔴 2026-08-20 v2：主/子分组聚合 */
  by_kind?: KindStat[];
  /** 🔴 2026-08-20 v2：子 Agent 按父会话归组 */
  by_parent?: ParentGroupRow[];
  /** 每会话用量明细（后端 usage_analytics 新增；服务端单一真相源） */
  by_session?: Array<{
    session_id?: string;
    title?: string | null;
    model?: string | null;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cache_hit_percent?: number;
    estimated_cost?: number;
    parent_session_id?: string | null;
    kind?: string | null;
    started_at?: number;
    last_active?: number;
  }>;
  total_tokens_in?: number;
  total_tokens_out?: number;
  total_sessions?: number;
}

interface SessionUsageEntry {
  tokensIn: number;
  tokensOut: number;
  model: string | null;
  updatedAt: number;
}

interface UsageCache {
  bySession: Record<string, SessionUsageEntry>;
}

interface SessionSummary {
  totalTokensIn: number;
  totalTokensOut: number;
  sessionCount: number;
  avgTokensPerSession: number;
  totalCost: number;
  cacheHitPercent: number | null;
}

/** 🔴 2026-08-20 v2：主/子分组统计项 */
export interface KindSummaryItem {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  hitPercent: number | null;
  cost: number;
  sessions: number;
}

/** 🔴 2026-08-20 v2：子 Agent 按父会话归组 */
export interface ParentGroup {
  parentId: string;
  parentTitle: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  hitPercent: number | null;
  cost: number;
  childSessions: number;
}

interface SessionUsageItem {
  sessionId: string;
  title: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  hitPercent: number | null;
  cost: number;
  /** 'main' | 'subagent' */
  kind: 'main' | 'subagent';
  parentSessionId: string | null;
  date: Date;
}
export type { SessionUsageItem };

interface ModelDistribution {
  [modelName: string]: { sessions: number; input: number; output: number; hitPercent: number | null };
}

/** 🔴 2026-08-20 v2：按日趋势 */
export interface DailyTrendPoint {
  day: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  hitPercent: number | null;
  cost: number;
  sessions: number;
}

interface UseUsageOptions {
  sessions?: Array<{ id?: string; title?: string | null; last_active?: number }>;
  sessionId?: string;
  tokensIn?: number;
  tokensOut?: number;
  modelName?: string | null;
  sessionTitles?: Record<string, string>;
}

interface UseUsageReturn {
  summary: SessionSummary;
  kindSummary: { main: KindSummaryItem; subagent: KindSummaryItem; total: KindSummaryItem };
  byParent: ParentGroup[];
  sessionUsage: SessionUsageItem[];
  modelDistribution: ModelDistribution;
  dailyTrend: DailyTrendPoint[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  dataSource: 'server' | 'local';
}

/** 命中率（对齐 DSH）：hit = cacheRead / (input + cacheRead + cacheWrite)；0 分母 → null（无调用） */
function calcHitPercent(input: number, cacheRead: number, cacheWrite: number): number | null {
  const denom = input + cacheRead + cacheWrite;
  if (denom <= 0) return null;
  return Math.round((cacheRead / denom) * 10000) / 100;
}

function emptyKind(): KindSummaryItem {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, hitPercent: null, cost: 0, sessions: 0 };
}

function sumKind(rows: KindStat[] | undefined, kind: string): KindSummaryItem {
  const rowsForKind = (rows || []).filter((r) => r.kind === kind);
  const agg = emptyKind();
  for (const r of rowsForKind) {
    agg.input += r.input_tokens || 0;
    agg.output += r.output_tokens || 0;
    agg.cacheRead += r.cache_read_tokens || 0;
    agg.cacheWrite += r.cache_write_tokens || 0;
    agg.cost += r.estimated_cost || 0;
    agg.sessions += r.sessions || 0;
  }
  agg.hitPercent = calcHitPercent(agg.input, agg.cacheRead, agg.cacheWrite);
  return agg;
}

/**
 * 从后端每日聚合数据计算 summary
 * 🔴 2026-08-10 对齐后端真实字段：usage_analytics 返回 input_tokens/output_tokens
 * （旧 tokens_in/tokens_out 兼容保留）——此前字段名不匹配导致 summary 恒 0
 * 🔴 2026-08-20 v2：补缓存命中率 + 费用
 */
function computeSummaryFromDaily(daily: DailyEntry[]): SessionSummary {
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let sessionCount = 0;
  let totalCost = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  for (const d of daily || []) {
    totalTokensIn += d.tokens_in ?? d.input_tokens ?? 0;
    totalTokensOut += d.tokens_out ?? d.output_tokens ?? 0;
    sessionCount += d.sessions || 0;
    totalCost += d.estimated_cost || 0;
    totalCacheRead += d.cache_read_tokens || 0;
    totalCacheWrite += d.cache_write_tokens || 0;
  }
  return {
    totalTokensIn,
    totalTokensOut,
    sessionCount,
    avgTokensPerSession: sessionCount > 0
      ? Math.round((totalTokensIn + totalTokensOut) / sessionCount)
      : 0,
    totalCost,
    cacheHitPercent: calcHitPercent(totalTokensIn, totalCacheRead, totalCacheWrite),
  };
}

/** 从后端 totals 计算 summary（daily 为空/缺省时兜底） */
function computeSummaryFromTotals(totals: AnalyticsTotals | undefined): SessionSummary | null {
  if (!totals) return null;
  const totalTokensIn = totals.total_input ?? totals.total_tokens_in ?? 0;
  const totalTokensOut = totals.total_output ?? totals.total_tokens_out ?? 0;
  const sessionCount = totals.total_sessions ?? 0;
  const totalCost = totals.total_estimated_cost ?? 0;
  const totalCacheRead = totals.total_cache_read ?? 0;
  const totalCacheWrite = totals.total_cache_write ?? 0;
  return {
    totalTokensIn,
    totalTokensOut,
    sessionCount,
    avgTokensPerSession: sessionCount > 0
      ? Math.round((totalTokensIn + totalTokensOut) / sessionCount)
      : 0,
    totalCost,
    cacheHitPercent: calcHitPercent(totalTokensIn, totalCacheRead, totalCacheWrite),
  };
}

export function useUsage({
  sessions = [],
  sessionId,
  tokensIn = 0,
  tokensOut = 0,
  modelName = null,
  sessionTitles = {},
}: UseUsageOptions = {}): UseUsageReturn {
  const [usage, setUsage] = useState<UsageCache>(() => loadCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverSummary, setServerSummary] = useState<AnalyticsUsageResponse | null>(null);
  const [serverAvailable, setServerAvailable] = useState(false);
  const prevTokensRef = useRef({ tokensIn: 0, tokensOut: 0 });

  // 启动时尝试从后端获取用量统计
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const data = await fetchAnalyticsUsage(30);
        if (cancelled) return;
        // 🔴 2026-08-10：后端真实 shape = {daily, by_model, totals}；旧顶层字段兼容保留
        if (data && (data.daily || data.totals || data.total_tokens_in !== undefined)) {
          setServerSummary(data);
          setServerAvailable(true);
          setError(null);
        } else {
          // 后端返回了但数据格式不对，不标记为可用
          setServerAvailable(false);
        }
      } catch (err: unknown) {
        // 后端不可用，静默回退到本地
        if (!cancelled) {
          console.warn('[useUsage] Backend analytics unavailable, using local data:', (err as Error).message);
          setServerAvailable(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Persist current-session tokens whenever they change
  useEffect(() => {
    if (!sessionId) return;
    const prev = prevTokensRef.current;
    // Only update if tokens actually changed to avoid thrashing
    if (tokensIn === prev.tokensIn && tokensOut === prev.tokensOut) return;
    prevTokensRef.current = { tokensIn, tokensOut };

    setUsage((prevUsage) => {
      const bySession = { ...(prevUsage.bySession || {}) };
      const existing = bySession[sessionId] || { tokensIn: 0, tokensOut: 0, model: null, updatedAt: Date.now() };
      bySession[sessionId] = {
        ...existing,
        tokensIn: Math.max(existing.tokensIn, tokensIn),
        tokensOut: Math.max(existing.tokensOut, tokensOut),
        model: modelName || existing.model || null,
        updatedAt: Date.now(),
      };
      const next: UsageCache = { ...prevUsage, bySession };
      saveCache(next);
      return next;
    });
  }, [sessionId, tokensIn, tokensOut, modelName]);

  // Sync session metadata (titles, timestamps) from the sessions list
  useEffect(() => {
    if (!sessions.length) return;
    setUsage((prevUsage) => {
      const bySession = { ...(prevUsage.bySession || {}) };
      let changed = false;
      for (const s of sessions) {
        const id = s.id || '';
        if (!id) continue;
        const existing = bySession[id];
        if (!existing) continue;
        if (s.last_active && (!existing.updatedAt || s.last_active * 1000 > existing.updatedAt)) {
          bySession[id] = { ...existing, updatedAt: s.last_active * 1000 };
          changed = true;
        }
      }
      if (!changed) return prevUsage;
      const next: UsageCache = { ...prevUsage, bySession };
      saveCache(next);
      return next;
    });
  }, [sessions]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    // 刷新时同时尝试后端和本地
    (async () => {
      try {
        const data = await fetchAnalyticsUsage(30);
        if (data && (data.daily || data.totals || data.total_tokens_in !== undefined)) {
          setServerSummary(data);
          setServerAvailable(true);
          setError(null);
        } else {
          setServerAvailable(false);
        }
      } catch (err: unknown) {
        setServerAvailable(false);
      }
      // 始终从 localStorage 加载最新本地数据
      const cached = loadCache();
      setUsage(cached);
      setLoading(false);
    })();
  }, []);

  // 决定当前 summary 数据源
  // 后端可用时使用后端统计，否则用 localStorage 本地统计
  const bySession = usage.bySession || {};
  const sessionIds = Object.keys(bySession);

  // 计算本地 summary（仅在需要时）
  const computedLocalSummary: SessionSummary = {
    totalTokensIn: 0,
    totalTokensOut: 0,
    sessionCount: sessionIds.length,
    avgTokensPerSession: 0,
    totalCost: 0,
    cacheHitPercent: null,
  };
  for (const id of sessionIds) {
    const s = bySession[id];
    computedLocalSummary.totalTokensIn += s.tokensIn || 0;
    computedLocalSummary.totalTokensOut += s.tokensOut || 0;
  }
  if (computedLocalSummary.sessionCount > 0) {
    computedLocalSummary.avgTokensPerSession = Math.round(
      (computedLocalSummary.totalTokensIn + computedLocalSummary.totalTokensOut) / computedLocalSummary.sessionCount
    );
  }

  // 🔴 2026-08-10：后端可用时 summary 优先后端（daily → totals 兜底），否则本地
  const serverSummaryFromBackend = serverAvailable && serverSummary
    ? (serverSummary.daily?.length
        ? computeSummaryFromDaily(serverSummary.daily)
        : computeSummaryFromTotals(serverSummary.totals))
    : null;

  const summary: SessionSummary = serverSummaryFromBackend ?? computedLocalSummary;

  // 后端 totals 兜底：无 daily 时用 totals 算平均
  if (serverSummaryFromBackend && summary.sessionCount > 0 && summary.avgTokensPerSession === 0 && serverSummary?.totals) {
    summary.avgTokensPerSession = Math.round(
      (summary.totalTokensIn + summary.totalTokensOut) / summary.sessionCount
    );
  }

  // 🔴 2026-08-20 v2：主/子分组统计（后端 by_kind 优先；后端不可用时本地仅主会话）
  const kindSummary = (() => {
    if (serverAvailable && serverSummary?.by_kind?.length) {
      return {
        main: sumKind(serverSummary.by_kind, 'main'),
        subagent: sumKind(serverSummary.by_kind, 'subagent'),
        total: emptyKind(),
      };
    }
    // 本地回退：无 kind 信息，全部归 main；subagent 空
    return {
      main: {
        input: computedLocalSummary.totalTokensIn,
        output: computedLocalSummary.totalTokensOut,
        cacheRead: 0,
        cacheWrite: 0,
        hitPercent: null,
        cost: 0,
        sessions: sessionIds.length,
      },
      subagent: emptyKind(),
      total: emptyKind(),
    };
  })();
  kindSummary.total = {
    input: kindSummary.main.input + kindSummary.subagent.input,
    output: kindSummary.main.output + kindSummary.subagent.output,
    cacheRead: kindSummary.main.cacheRead + kindSummary.subagent.cacheRead,
    cacheWrite: kindSummary.main.cacheWrite + kindSummary.subagent.cacheWrite,
    cost: kindSummary.main.cost + kindSummary.subagent.cost,
    sessions: kindSummary.main.sessions + kindSummary.subagent.sessions,
    hitPercent: calcHitPercent(
      kindSummary.main.input + kindSummary.subagent.input,
      kindSummary.main.cacheRead + kindSummary.subagent.cacheRead,
      kindSummary.main.cacheWrite + kindSummary.subagent.cacheWrite,
    ),
  };

  // 🔴 2026-08-20 v2：子 Agent 按父会话归组
  const byParent: ParentGroup[] = serverAvailable && serverSummary?.by_parent?.length
    ? serverSummary.by_parent.map((r) => ({
        parentId: r.parent_session_id || '',
        parentTitle: r.parent_title || r.parent_session_id || '—',
        input: r.input_tokens || 0,
        output: r.output_tokens || 0,
        cacheRead: r.cache_read_tokens || 0,
        cacheWrite: r.cache_write_tokens || 0,
        hitPercent: calcHitPercent(r.input_tokens || 0, r.cache_read_tokens || 0, r.cache_write_tokens || 0),
        cost: r.estimated_cost || 0,
        childSessions: r.child_sessions || 0,
      }))
    : [];

  // 🔴 2026-08-20 v2：按日趋势
  const dailyTrend: DailyTrendPoint[] = serverAvailable && serverSummary?.daily?.length
    ? serverSummary.daily.map((d) => {
        const input = d.input_tokens ?? d.tokens_in ?? 0;
        const cacheRead = d.cache_read_tokens || 0;
        const cacheWrite = d.cache_write_tokens || 0;
        return {
          day: String(d.day || ''),
          input,
          output: d.output_tokens ?? d.tokens_out ?? 0,
          cacheRead,
          cacheWrite,
          hitPercent: input + cacheRead + cacheWrite > 0
            ? (d.cache_hit_percent ?? calcHitPercent(input, cacheRead, cacheWrite))
            : null,
          cost: d.estimated_cost || 0,
          sessions: d.sessions || 0,
        };
      })
    : [];

  // Build per-session breakdown list (sorted by most recent first)
  // 🔴 2026-08-18 断线修复：明细表改服务端 by_session 优先（对齐 Hermes 服务端
  // 单一真相源——旧实现只有本地 localStorage 会话碎片，历史会话明细恒空），
  // 本地缓存仅作缺口补丁（服务端未覆盖的会话）+ token 新鲜值覆盖。
  // 🔴 2026-08-20 v2：明细补 kind/parent/缓存细账/费用。
  const serverRows = serverAvailable && serverSummary?.by_session?.length
    ? serverSummary.by_session
    : [];
  const merged = new Map<string, SessionUsageItem>();
  for (const r of serverRows) {
    const id = r.session_id || '';
    if (!id) continue;
    const sess = sessions.find((x: { id?: string } & Record<string, unknown>) => (x.id || x) === id);
    merged.set(id, {
      sessionId: id,
      title: r.title || sessionTitles[id] || (sess && sess.title) || id?.slice(0, 8) || '—',
      model: r.model || '—',
      tokensIn: r.input_tokens || 0,
      tokensOut: r.output_tokens || 0,
      cacheRead: r.cache_read_tokens || 0,
      cacheWrite: r.cache_write_tokens || 0,
      hitPercent: (r.input_tokens || 0) + (r.cache_read_tokens || 0) + (r.cache_write_tokens || 0) > 0
        ? (r.cache_hit_percent ?? calcHitPercent(r.input_tokens || 0, r.cache_read_tokens || 0, r.cache_write_tokens || 0))
        : null,
      cost: r.estimated_cost || 0,
      kind: r.kind === 'subagent' ? 'subagent' : 'main',
      parentSessionId: r.parent_session_id || null,
      date: new Date((r.last_active || r.started_at || 0) * 1000),
    });
  }
  for (const id of sessionIds) {
    const s = bySession[id];
    const sess = sessions.find((x: { id?: string } & Record<string, unknown>) => (x.id || x) === id);
    const item: SessionUsageItem = {
      sessionId: id,
      title: sessionTitles[id] || (sess && sess.title) || id?.slice(0, 8) || '—',
      model: s.model || '—',
      tokensIn: s.tokensIn || 0,
      tokensOut: s.tokensOut || 0,
      cacheRead: 0,
      cacheWrite: 0,
      hitPercent: null,
      cost: 0,
      kind: 'main',
      parentSessionId: null,
      date: new Date(s.updatedAt || 0),
    };
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, item);
    } else {
      merged.set(id, {
        ...existing,
        tokensIn: Math.max(existing.tokensIn, item.tokensIn),
        tokensOut: Math.max(existing.tokensOut, item.tokensOut),
        // 时间取较新者（本地 updatedAt 可能领先服务端）
        date: existing.date.getTime() >= item.date.getTime() ? existing.date : item.date,
      });
    }
  }
  const sessionUsage: SessionUsageItem[] = [...merged.values()]
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  // Build model distribution
  // 🔴 2026-08-20 v2：token 维度 + 缓存命中率（对齐 Hermes by_model token 聚合）
  const modelDistribution: ModelDistribution = {};
  if (serverSummaryFromBackend && serverSummary?.by_model?.length) {
    for (const m of serverSummary.by_model) {
      const name = (m.model as string) || 'unknown';
      const input = (m.input_tokens as number) || 0;
      const output = (m.output_tokens as number) || 0;
      const cacheRead = (m.cache_read_tokens as number) || 0;
      const cacheWrite = (m.cache_write_tokens as number) || 0;
      modelDistribution[name] = {
        sessions: (m.sessions as number) || 0,
        input,
        output,
        hitPercent: calcHitPercent(input, cacheRead, cacheWrite),
      };
    }
  } else {
    for (const id of sessionIds) {
      const model = bySession[id].model || 'unknown';
      if (!modelDistribution[model]) {
        modelDistribution[model] = { sessions: 0, input: 0, output: 0, hitPercent: null };
      }
      modelDistribution[model].sessions++;
      modelDistribution[model].input += bySession[id].tokensIn || 0;
      modelDistribution[model].output += bySession[id].tokensOut || 0;
    }
  }

  const dataSource: 'server' | 'local' = serverAvailable ? 'server' : 'local';

  return {
    summary,
    kindSummary,
    byParent,
    sessionUsage,
    modelDistribution,
    dailyTrend,
    loading,
    error,
    refresh,
    dataSource,
  };
}

function loadCache(): UsageCache {
  try {
    return (storage.load(USAGE_CACHE_KEY) as UsageCache | null) || { bySession: {} };
  } catch {
    return { bySession: {} };
  }
}

function saveCache(data: UsageCache): void {
  try {
    storage.save(USAGE_CACHE_KEY, data);
  } catch { /* ignore */ }
}
