/**
 * CardContextGauge — 宫格卡片上下文占用指示（工具状态栏 · 模型选择右侧）
 *
 * 环形（ContextRing）+ 当前/上限 + 占比%。
 * 数据源统一走 useSessionContext（与单视图 ContextBar 共享轮询逻辑）：
 * - 聚焦卡片活跃轮询 3s，非聚焦降频 15s（不冻结，控并发）
 * - 响应序号守卫（旧响应不覆盖新值）
 */
import { memo } from 'react';
import { ContextRing, ringColor } from './ContextRing';
import { useSessionContext } from '../hooks/useSessionContext';

/** 格式化数字（如 134800 → "134.8k"） */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

interface CardContextGaugeProps {
  /** 本卡片 Agent 的会话 id（null = 未建会话，显示占位） */
  sessionId?: string | null;
  /** 卡片是否聚焦（聚焦 3s 高频轮询，非聚焦 15s 降频） */
  active?: boolean;
}

export const CardContextGauge = memo(function CardContextGauge({ sessionId, active = true }: CardContextGaugeProps) {
  const ctx = useSessionContext(sessionId, { active });

  // 未建会话：显示空环 + 0/默认上限占位（环始终可见，会话建立后自动填充）
  // 🔴 2026-08-02 热更新修复：与 ContextBar 一致用后端默认上限 256k，不显示 --
  if (!sessionId) {
    return (
      <span
        className="flex items-center gap-1 px-1 shrink-0"
        title="尚未建立会话 — 发送消息后自动创建"
      >
        <ContextRing pct={0} />
        <span className="text-[10px] text-muted-foreground/40">0/256k</span>
      </span>
    );
  }

  const total = ctx?.total_tokens ?? 0;
  const limit = ctx?.context_limit || 0;
  const pct = Math.min(ctx?.percentage ?? 0, 100);
  // 🔴 2026-08-02 热更新修复：只要 limit 有效就展示（0/128k 0.0%），
  // 不再要求 total>0 —— 新建 Agent 未发消息/新会话也显示占位，发消息后自动变真实值。
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
