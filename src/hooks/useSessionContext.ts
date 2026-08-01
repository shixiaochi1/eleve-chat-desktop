/**
 * useSessionContext — 会话上下文轮询（统一数据源逻辑）
 *
 * 消灭 ContextBar（单视图）与 CardContextGauge（宫格）两份重复轮询。
 * 统一能力：
 * - 响应序号守卫：并发请求乱序时只接受最新请求的响应（旧覆盖新 = 竞态）
 * - cancelled 守卫：sessionId/active 变化或卸载时丢弃在途响应
 * - 链式 setTimeout（响应回来后间隔固定时长再发下一次）——防 setInterval
 *   在响应慢于间隔时请求堆积
 * - active 降频：宫格仅聚焦卡片高频轮询，非聚焦降频慢轮询（不冻结数据）
 *
 * @param sessionId 会话 id（null/空 → 不轮询，返回 null）
 * @param opts.active 是否活跃轮询（默认 true）
 * @param opts.activeIntervalMs 活跃间隔 ms（默认 3000，对齐 ContextBar）
 * @param opts.idleIntervalMs 非活跃间隔 ms（默认 15000）
 */
import { useState, useEffect } from 'react';
import { fetchSessionContext } from '../utils/api';

export interface SessionContextData {
  total_tokens?: number;
  context_limit?: number;
  percentage?: number;
  [key: string]: unknown;
}

interface UseSessionContextOptions {
  active?: boolean;
  activeIntervalMs?: number;
  idleIntervalMs?: number;
}

export function useSessionContext(
  sessionId: string | null | undefined,
  opts: UseSessionContextOptions = {},
): SessionContextData | null {
  const { active = true, activeIntervalMs = 3000, idleIntervalMs = 15000 } = opts;
  const [ctx, setCtx] = useState<SessionContextData | null>(null);

  useEffect(() => {
    if (!sessionId) { setCtx(null); return; }
    let cancelled = false;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const mySeq = ++seq;
      try {
        const data = await fetchSessionContext(sessionId);
        if (!cancelled && mySeq === seq && data) {
          setCtx(data as SessionContextData);
        }
      } catch { /* 静默：会话可能不存在 */ }
      if (cancelled) return;
      timer = setTimeout(poll, active ? activeIntervalMs : idleIntervalMs);
    };

    poll();
    return () => {
      cancelled = true;
      seq++;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, active, activeIntervalMs, idleIntervalMs]);

  return ctx;
}

export default useSessionContext;
