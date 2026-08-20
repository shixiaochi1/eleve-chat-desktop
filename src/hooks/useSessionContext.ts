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
    // 🔴 2026-08-20：切换会话立即清空旧数据——否则新会话数据回来前
    // 一直显示旧会话的上下文（用户实测：切 AGENT/项目后数据不跟着变）。
    setCtx(null);
    let cancelled = false;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const mySeq = ++seq;
      try {
        const data = await fetchSessionContext(sessionId);
        if (cancelled || mySeq !== seq) return;
        // 后端无数据 → 清空（显示"不可用"），不保留过期值
        setCtx((data ? data : null) as SessionContextData | null);
      } catch {
        // 🔴 2026-08-20：轮询失败（WS 断线/会话不可达）→ 清空而非冻结旧值——
        // 原实现静默保留旧 ctx，长时间运行后断线窗口内数据永久显示旧会话旧值。
        if (!cancelled && mySeq === seq) setCtx(null);
      }
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
