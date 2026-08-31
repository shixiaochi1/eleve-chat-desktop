/**
 * CardContextGauge — 宫格卡片上下文占用指示（工具状态栏 · 模型选择右侧）
 *
 * 环形（ContextRing）+ 当前/上限 + 占比%。
 * 数据源统一走 useSessionContext（与单视图 ContextBar 共享轮询逻辑）：
 * - 聚焦卡片活跃轮询 3s，非聚焦降频 15s（不冻结，控并发）
 * - 响应序号守卫（旧响应不覆盖新值）
 *
 * 🔴 2026-08-20：圆环可点击 → 下拉菜单（对齐 DSH StatsLine）：
 * - 上下文：total / limit / 占比
 * - 缓存命中：命中率 % + 读/写/纯输入 细账（会话级累计真实 usage，
 *   后端 conversation_loop 逐次 API 响应累计；cache_hit_percent =
 *   cacheRead / (input + cacheRead + cacheWrite)，对齐 DSH cacheHitPercent）
 */
import { memo } from 'react';
import { ContextRing, ringColor } from './ContextRing';
import { useSessionContext } from '../hooks/useSessionContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
// 🔴 2026-09-01 收敛：fmtNum 局部复制版删除，统一 utils/format.formatCompactTokens
import { formatCompactTokens as fmtNum } from '@/utils/format';

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

  // 🔴 2026-08-20 缓存命中（对齐 DSH cacheHitPercent / billedInputTokens）：
  // billedInput = input + cacheRead + cacheWrite > 0 才展示命中率（真实调用才有数据，
  // 0 分母时后端返回 0——前端同样只在 billed>0 时展示，避免"没调用"误显示 0%）。
  const inputTokens = ctx?.input_tokens ?? 0;
  const cacheRead = ctx?.cache_read_tokens ?? 0;
  const cacheWrite = ctx?.cache_write_tokens ?? 0;
  const outputTokens = ctx?.output_tokens ?? 0;
  const billedInput = inputTokens + cacheRead + cacheWrite;
  const hasCacheData = billedInput > 0;
  const cacheHit = hasCacheData ? (ctx?.cache_hit_percent ?? 0) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-1 text-[10px] tabular-nums whitespace-nowrap shrink-0 cursor-pointer rounded-md hover:bg-accent/40 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title={
            hasData
              ? `上下文: ${total.toLocaleString()} / ${limit.toLocaleString()} tokens (${pct.toFixed(1)}%)${cacheHit !== null ? ` · 缓存命中 ${cacheHit}%` : ''} — 点击查看明细`
              : '上下文数据不可用'
          }
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
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        <DropdownMenuLabel>上下文监控</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* ── 上下文 ── */}
        <DropdownMenuItem disabled className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">上下文</span>
          <span className="tabular-nums">
            {hasData ? `${total.toLocaleString()} / ${limit.toLocaleString()} tokens` : '不可用'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">占用</span>
          <span className="font-medium" style={{ color: ringColor(pct) }}>{pct.toFixed(1)}%</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* ── 缓存命中（对齐 DSH stats.cacheHit「缓存命中 {percent}%」）── */}
        <DropdownMenuItem disabled className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">缓存命中</span>
          {cacheHit !== null ? (
            <span className={`font-medium tabular-nums ${cacheHit >= 80 ? 'text-primary' : cacheHit >= 40 ? 'text-foreground' : 'text-muted-foreground'}`}>
              {cacheHit}%
            </span>
          ) : (
            <span className="text-muted-foreground/50">暂无调用</span>
          )}
        </DropdownMenuItem>
        {hasCacheData && (
          <>
            <DropdownMenuItem disabled className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">缓存读</span>
              <span className="tabular-nums">{cacheRead.toLocaleString()}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">缓存写</span>
              <span className="tabular-nums">{cacheWrite.toLocaleString()}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">纯输入</span>
              <span className="tabular-nums">{inputTokens.toLocaleString()}</span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">输出</span>
              <span className="tabular-nums">{outputTokens.toLocaleString()}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default CardContextGauge;
