/**
 * useUsage — Aggregate token usage & model distribution from session data
 *
 * 优先从后端 GET /api/analytics/usage 获取统计数据，
 * 失败时回退到 localStorage 本地统计。
 *
 * Returns:
 *   summary: { totalTokensIn, totalTokensOut, sessionCount, avgTokensPerSession }
 *   sessionUsage: per-session breakdown
 *   modelDistribution: { modelName -> sessionCount }
 *   loading, error, refresh
 *   dataSource: 'server' | 'local' — 当前数据来源
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
}

interface AnalyticsTotals {
  total_input?: number;
  total_output?: number;
  total_sessions?: number;
  // 兼容旧字段（早期本地版契约）
  total_tokens_in?: number;
  total_tokens_out?: number;
}

interface AnalyticsUsageResponse {
  daily?: DailyEntry[];
  totals?: AnalyticsTotals;
  /** 模型维度聚合（{model, sessions, input_tokens, output_tokens}） */
  by_model?: Array<{ model?: string | null; sessions?: number }>;
  /** 🔴 2026-08-18 每会话用量明细（后端 usage_analytics 新增；服务端单一真相源） */
  by_session?: Array<{
    session_id?: string;
    title?: string | null;
    model?: string | null;
    input_tokens?: number;
    output_tokens?: number;
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
}

interface SessionUsageItem {
  sessionId: string;
  title: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  date: Date;
}

interface ModelDistribution {
  [modelName: string]: number;
}

interface UseUsageOptions {
  sessions?: Array<{ id?: string; title?: string; last_active?: number }>;
  sessionId?: string;
  tokensIn?: number;
  tokensOut?: number;
  modelName?: string | null;
  sessionTitles?: Record<string, string>;
}

interface UseUsageReturn {
  summary: SessionSummary;
  sessionUsage: SessionUsageItem[];
  modelDistribution: ModelDistribution;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  dataSource: 'server' | 'local';
}

/**
 * 从后端每日聚合数据计算 summary
 * 🔴 2026-08-10 对齐后端真实字段：usage_analytics 返回 input_tokens/output_tokens
 * （旧 tokens_in/tokens_out 兼容保留）——此前字段名不匹配导致 summary 恒 0
 */
function computeSummaryFromDaily(daily: DailyEntry[]): SessionSummary {
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let sessionCount = 0;
  for (const d of daily || []) {
    totalTokensIn += d.tokens_in ?? d.input_tokens ?? 0;
    totalTokensOut += d.tokens_out ?? d.output_tokens ?? 0;
    sessionCount += d.sessions || 0;
  }
  return {
    totalTokensIn,
    totalTokensOut,
    sessionCount,
    avgTokensPerSession: sessionCount > 0
      ? Math.round((totalTokensIn + totalTokensOut) / sessionCount)
      : 0,
  };
}

/** 从后端 totals 计算 summary（daily 为空/缺省时兜底） */
function computeSummaryFromTotals(totals: AnalyticsTotals | undefined): SessionSummary | null {
  if (!totals) return null;
  const totalTokensIn = totals.total_input ?? totals.total_tokens_in ?? 0;
  const totalTokensOut = totals.total_output ?? totals.total_tokens_out ?? 0;
  const sessionCount = totals.total_sessions ?? 0;
  return {
    totalTokensIn,
    totalTokensOut,
    sessionCount,
    avgTokensPerSession: sessionCount > 0
      ? Math.round((totalTokensIn + totalTokensOut) / sessionCount)
      : 0,
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

  // Build per-session breakdown list (sorted by most recent first)
  // 🔴 2026-08-18 断线修复：明细表改服务端 by_session 优先（对齐 Hermes 服务端
  // 单一真相源——旧实现只有本地 localStorage 会话碎片，历史会话明细恒空），
  // 本地缓存仅作缺口补丁（服务端未覆盖的会话）+ token 新鲜值覆盖。
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
  // 🔴 2026-08-10：后端可用时用 by_model（服务端全量会话统计，含历史会话），
  // 否则本地 bySession 计数（只有本机本次前端使用期间的会话）
  const modelDistribution: ModelDistribution = {};
  if (serverSummaryFromBackend && serverSummary?.by_model?.length) {
    for (const m of serverSummary.by_model) {
      const name = m.model || 'unknown';
      modelDistribution[name] = (modelDistribution[name] || 0) + (m.sessions ?? 0);
    }
  } else {
    for (const id of sessionIds) {
      const model = bySession[id].model || 'unknown';
      if (!modelDistribution[model]) {
        modelDistribution[model] = 0;
      }
      modelDistribution[model]++;
    }
  }

  const dataSource: 'server' | 'local' = serverAvailable ? 'server' : 'local';

  return {
    summary,
    sessionUsage,
    modelDistribution,
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
