/**
 * CardContextGauge — 宫格卡片上下文占用指示（工具状态栏 · 模型选择右侧）
 *
 * 每卡片独立轮询 fetchSessionContext（per-agent sessionId），
 * 环形（ContextRing）+ 当前/上限 + 占比%。
 * 轮询默认 5s：宫格 N 卡片并发轮询，3s 会放大请求风暴。
 */
import { memo, useState, useEffect } from 'react';
import { fetchSessionContext } from '../utils/api';
import { ContextRing, ringColor } from './ContextRing';

/** 格式化数字（如 134800 → "134.8k"） */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

interface CardContextGaugeProps {
  /** 本卡片 Agent 的会话 id（null = 未建会话，显示占位） */
  sessionId?: string | null;
  /** 卡片是否聚焦（仅聚焦卡片轮询，避免宫格 N 卡片并发 RPC 堵 WS 串行循环） */
  active?: boolean;
  /** 轮询间隔 ms（默认 3000 — 与单视图 ContextBar 持平；active 门控后仅聚焦卡片轮询） */
  intervalMs?: number;
}

export const CardContextGauge = memo(function CardContextGauge({ sessionId, active = true, intervalMs = 3000 }: CardContextGaugeProps) {
  const [ctx, setCtx] = useState<{ total_tokens?: number; context_limit?: number; percentage?: number } | null>(null);

  // 每 intervalMs 轮询上下文；sessionId/active 变化或卸载自动重启/停止
  // 🔴 响应序号守卫：并发请求乱序时只接受最新请求的响应（旧响应覆盖新值 = 竞态）
  useEffect(() => {
    if (!sessionId || !active) return;
    let cancelled = false;
    let seq = 0;
    const poll = async () => {
      const mySeq = ++seq;
      try {
        const data = await fetchSessionContext(sessionId);
        if (!cancelled && mySeq === seq && data) {
          setCtx(data as { total_tokens?: number; context_limit?: number; percentage?: number });
        }
      } catch { /* 静默 */ }
    };
    poll();
    const i = setInterval(poll, intervalMs);
    return () => { cancelled = true; seq++; clearInterval(i); };
  }, [sessionId, active, intervalMs]);

  // 未建会话：显示空环 + 占位（环始终可见，会话建立后自动填充）
  if (!sessionId) {
    return (
      <span
        className="flex items-center gap-1 px-1 shrink-0"
        title="尚未建立会话"
      >
        <ContextRing pct={0} />
        <span className="text-[10px] text-muted-foreground/40">--</span>
      </span>
    );
  }

  const total = ctx?.total_tokens ?? 0;
  const limit = ctx?.context_limit || 0;
  const pct = Math.min(ctx?.percentage ?? 0, 100);
  // 🔴 后端 P3-1 token 统计未接线：total_tokens 恒 0（session_input_tokens 等全仓无更新点）。
  // 有数据才算数，避免把“0/128k 0.0%”当真实数据展示
  const hasData = limit > 0 && total > 0;

  return (
    <span
      className="flex items-center gap-1 px-1 text-[10px] tabular-nums whitespace-nowrap shrink-0"
      title={hasData ? `上下文: ${total.toLocaleString()} / ${limit.toLocaleString()} tokens (${pct.toFixed(1)}%)` : '上下文数据不可用'}
    >
      <ContextRing pct={hasData ? pct : 0} />
      {hasData ? (
        <>
          <span className="text-muted-foreground/70">{fmtNum(total)}/{fmtNum(limit)}</span>
          <span className="font-medium" style={{ color: ringColor(pct) }}>{pct.toFixed(1)}%</span>
        </>
      ) : (
        <span className="text-muted-foreground/40">--</span>
      )}
    </span>
  );
});

export default CardContextGauge;
