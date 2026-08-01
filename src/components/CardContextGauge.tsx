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
  /** 轮询间隔 ms（默认 5000） */
  intervalMs?: number;
}

export const CardContextGauge = memo(function CardContextGauge({ sessionId, intervalMs = 5000 }: CardContextGaugeProps) {
  const [ctx, setCtx] = useState<{ total_tokens?: number; context_limit?: number; percentage?: number } | null>(null);

  // 每 intervalMs 轮询上下文；sessionId 变化/卸载自动重启/停止
  useEffect(() => {
    if (!sessionId) { setCtx(null); return; }
    let cancelled = false;
    const poll = () => {
      fetchSessionContext(sessionId).then((data: Record<string, unknown>) => {
        if (!cancelled && data) setCtx(data as { total_tokens?: number; context_limit?: number; percentage?: number });
      }).catch(() => {});
    };
    poll();
    const i = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(i); };
  }, [sessionId, intervalMs]);

  // 未建会话：占位，不轮询
  if (!sessionId) {
    return <span className="text-[10px] text-muted-foreground/50 px-1 shrink-0">–</span>;
  }

  const total = ctx?.total_tokens ?? 0;
  const limit = ctx?.context_limit || 0;
  const pct = Math.min(ctx?.percentage ?? 0, 100);
  const hasData = limit > 0;

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
