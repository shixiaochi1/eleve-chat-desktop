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
}

interface AnalyticsUsageResponse {
  daily?: DailyEntry[];
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
 */
function computeSummaryFromDaily(daily: DailyEntry[]): SessionSummary {
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let sessionCount = 0;
  for (const d of daily || []) {
    totalTokensIn += d.tokens_in || 0;
    totalTokensOut += d.tokens_out || 0;
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
        if (data && (data.daily || data.total_tokens_in !== undefined)) {
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
        if (data && (data.daily || data.total_tokens_in !== undefined)) {
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

  const summary: SessionSummary = serverAvailable && serverSummary
    ? (serverSummary.daily
        ? computeSummaryFromDaily(serverSummary.daily)
        : {
            totalTokensIn: serverSummary.total_tokens_in || 0,
            totalTokensOut: serverSummary.total_tokens_out || 0,
            sessionCount: serverSummary.total_sessions || 0,
            avgTokensPerSession: 0,
          })
    : computedLocalSummary;

  // 如果后端有 total_sessions，计算平均
  if (serverAvailable && serverSummary) {
    if (!serverSummary.daily && summary.sessionCount > 0) {
      summary.avgTokensPerSession = Math.round(
        (summary.totalTokensIn + summary.totalTokensOut) / summary.sessionCount
      );
    }
  }

  // Build per-session breakdown list (sorted by most recent first)
  const sessionUsage: SessionUsageItem[] = sessionIds
    .map((id) => {
      const s = bySession[id];
      const sess = sessions.find((x: { id?: string } & Record<string, unknown>) => (x.id || x) === id);
      const title = sessionTitles[id] || (sess && sess.title) || id?.slice(0, 8) || '—';
      const updatedAt = s.updatedAt || 0;
      return {
        sessionId: id,
        title,
        model: s.model || '—',
        tokensIn: s.tokensIn || 0,
        tokensOut: s.tokensOut || 0,
        date: new Date(updatedAt),
      };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  // Build model distribution
  const modelDistribution: ModelDistribution = {};
  for (const id of sessionIds) {
    const model = bySession[id].model || 'unknown';
    if (!modelDistribution[model]) {
      modelDistribution[model] = 0;
    }
    modelDistribution[model]++;
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
