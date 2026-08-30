import { memo, useEffect, useRef, useCallback } from 'react';
import { Plus, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import ModeSwitchButton from './ModeSwitchButton';
import MoaToggleButton from './MoaToggleButton';
import { useSessionContext } from '../hooks/useSessionContext';

/**
 * 格式化数字（如 134800 → "134.8k"）
 */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

interface ContextData {
  total_tokens?: number;
  context_limit?: number;
  percentage?: number;
  /** 🔴 2026-08-20 缓存命中链路：对齐 SessionContextData 字段（后端 context_breakdown 透出） */
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cache_hit_percent?: number;
}
interface ContextBarProps {
  sessionId?: string | null;
  sessionStartedAt?: number | null;
  onNewSession?: () => void;
  /** 多 Agent 视图模式（single=单视图, grid=宫格） */
  viewMode?: 'single' | 'grid';
  /** 切换视图模式 */
  onToggleViewMode?: () => void;
  /** Agent 数量（< 2 时宫格按钮禁用） */
  agentCount?: number;
  /** DeepSeek 嵌入 WebView 显隐 */
  deepseekVisible?: boolean;
  onToggleDeepSeek?: () => void;
}

/**
 * 会话上下文指示条 — 每 3s 轮询 context 数据
 *
 * 🔴 2026-08-10 对齐 Hermes：数据源 = WS session.context_breakdown（context_used =
 * 实测 last_prompt_tokens 优先，无实测回退估算，永不为 0；context_max = 模型解析链）。
 * 旧 session.context.get 是累计 input+output 语义，导致显示 0 / 虚高。
 *
 * 布局：[+ 新建会话]  ···  [模型名 | 已用 token / 上限 | 百分比 | 进度条]
 *
 * IMPORTANT: This component uses direct DOM writes for the elapsed timer
 * to avoid triggering React re-renders every second. This prevents layout
 * thrashing that destabilizes the virtualizer's scroll position.
 */
const ContextBar = memo(function ContextBar({ sessionId, sessionStartedAt, onNewSession, viewMode = 'single', onToggleViewMode, agentCount = 1, deepseekVisible, onToggleDeepSeek }: ContextBarProps) {
  const elapsedRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 统一轮询：useSessionContext（响应序号守卫 + 链式 setTimeout，防旧响应覆盖新值）
  // 🔴 2026-08-11 降频（工具卡住根因修复）：3s → 15s。高频轮询 context_breakdown
  // （后端实算 0.3-3s/次）占满 WS 主循环 → 流式事件积压 → “卡住→一股脑”。
  // 上下文条是信息性展示，15s 刷新足够（Hermes 同量级）。
  const ctx = useSessionContext(sessionId, { activeIntervalMs: 15000, idleIntervalMs: 30000 }) as ContextData | null;

  // 每秒更新 elapsed — direct DOM write, NO React re-render
  useEffect(() => {
    if (!sessionStartedAt) return;

    const fmtAgo = (s: number): string => {
      if (s < 60) return `${s}秒前`;
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}分钟前`;
      const h = Math.floor(m / 60);
      return `${h}小时${m % 60}分钟前`;
    };

    const update = () => {
      const s = Math.floor((Date.now() - sessionStartedAt!) / 1000);
      if (elapsedRef.current) {
        elapsedRef.current.textContent = fmtAgo(s);
      }
    };
    update();
    timerRef.current = setInterval(update, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionStartedAt]);

  const total_tokens = ctx?.total_tokens ?? 0;
  // 🔴 2026-08-02 热更新修复：无会话（sessionId 为空 → 不轮询 → ctx=null）时用后端默认上限
  // 256k 占位显示 “0 / 256k 0.0%”，不显示 0/0；发消息建立会话后由后端返回真实值覆盖。
  const context_limit = ctx?.context_limit || (sessionId ? 0 : 256_000);
  const percentage = ctx?.percentage ?? 0;
  const pct = Math.min(percentage, 100);
  const over80 = pct >= 80;
  const over95 = pct >= 95;
  const barColor = over95 ? 'color-mix(in srgb, var(--ui-red) 70%, white)' : over80 ? 'color-mix(in srgb, var(--ui-yellow) 70%, white)' : 'color-mix(in srgb, var(--ui-green) 70%, white)';

  // 🔴 2026-08-20 缓存命中率（对齐 DSH StatsLine cacheHitPercent）：
  // billedInput = input + cacheRead + cacheWrite > 0 才展示真实命中率（后端已算）；
  // 无任何 API 调用（billed=0）→ 不显示（0% 会误导"没数据"为"真 0%"）。
  const billedInput = (ctx?.input_tokens ?? 0) + (ctx?.cache_read_tokens ?? 0) + (ctx?.cache_write_tokens ?? 0);
  const hasCacheData = billedInput > 0;
  const cacheHit = hasCacheData ? (ctx?.cache_hit_percent ?? 0) : null;

  return (
    <div>
      {/* 信息行：按钮左 + 监控数据右
          🔴 2026-08-02 老大需求：双击空白处 → 切宫格模式（排除按钮，按钮有自己的点击语义）*/}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        title="双击空白处切换宫格模式"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          onToggleViewMode?.();
        }}
      >
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground border border-[var(--ui-stroke-quaternary)] bg-card hover:bg-accent/50 rounded-md shadow-sm transition-colors"
            title="新建会话 (Ctrl+N)"
            // 🔴 2026-08-05 修复：必须包箭头函数——onClick 直绑会把 MouseEvent 当参数传入
            // handleNewSession(title)，title?.trim 抛错但 sessionId 已被清空 → 下次发送传 null
            // → 后端自动新建会话（"执行工具后自动新建"根因）
            onClick={() => onNewSession?.()}
          >
            <Plus size={14} strokeWidth={1.5} />
            <span>新建会话</span>
          </button>
          {onToggleViewMode && (
            <ModeSwitchButton mode={viewMode} onToggle={onToggleViewMode} agentCount={agentCount} />
          )}
          {onToggleDeepSeek && (
            <button
              className={cn(
                'flex items-center gap-1 h-7 px-2.5 text-xs rounded-md transition-colors border bg-card shadow-sm',
                deepseekVisible
                  ? 'border-primary/40 text-primary bg-primary/5'
                  : 'border-[var(--ui-stroke-quaternary)] text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
              title="DeepSeek 嵌入"
              onClick={onToggleDeepSeek}
            >
              <Bot size={14} strokeWidth={1.5} />
              <span>DeepSeek</span>
            </button>
          )}
          {/* MoA 开关 — 滑块样式，config.set 点路径读写 moa.presets.default.enabled */}
          <MoaToggleButton />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
          <span>
            {fmtNum(total_tokens)} / {fmtNum(context_limit)} tokens
          </span>
          <span className="font-medium" style={{ color: barColor }}>{pct.toFixed(1)}%</span>
          {/* 缓存命中率（对齐 DSH stats.cacheHit「缓存命中 {percent}%」；有真实调用才显示） */}
          {cacheHit !== null && (
            <span
              className={`px-1.5 py-0.5 rounded-md font-medium ${cacheHit >= 80 ? 'bg-primary/10 text-primary' : cacheHit >= 40 ? 'bg-muted text-foreground' : 'bg-muted/60 text-muted-foreground'}`}
              title={`缓存命中 ${cacheHit}% — 读 ${(ctx?.cache_read_tokens ?? 0).toLocaleString()} · 写 ${(ctx?.cache_write_tokens ?? 0).toLocaleString()} · 纯输入 ${(ctx?.input_tokens ?? 0).toLocaleString()}`}
            >
              缓存命中 {cacheHit}%
            </span>
          )}
          {sessionStartedAt && (
            <span ref={elapsedRef} className="text-muted-foreground/50">开始: 0秒前</span>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1 bg-muted/50 rounded-full overflow-hidden relative mx-3 mt-0.5">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: barColor }}
        />
        <div className="absolute top-0 w-0.5 h-full bg-muted-foreground/20" style={{ left: '80%' }} />
      </div>
    </div>
  );
});

export default ContextBar;
