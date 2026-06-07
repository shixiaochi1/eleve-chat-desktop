import { useState, useEffect, useRef } from 'react';
import { Plus, MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchSessionContext } from '../utils/api';

/**
 * 格式化数字（如 134800 → "134.8k"）
 */
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

interface ContextData {
  model?: string;
  total_tokens?: number;
  context_limit?: number;
  percentage?: number;
}

interface ContextBarProps {
  sessionId?: string | null;
  sessionStartedAt?: number | null;
  onNewSession?: () => void;
  onBtw?: () => void;
}

/**
 * 会话上下文指示条 — 每 3s 轮询 /api/sessions/:id/context
 *
 * 布局：[+ 新建会话] [💬 临时提问]  ···  [模型名 | 已用 token / 上限 | 百分比 | 进度条]
 */
export default function ContextBar({ sessionId, sessionStartedAt, onNewSession, onBtw }: ContextBarProps) {
  const [ctx, setCtx] = useState<ContextData | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 每 3s 轮询上下文
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      if (!sessionId) return;
      fetchSessionContext(sessionId).then((data: Record<string, unknown>) => {
        if (!cancelled && data) setCtx(data as ContextData);
      }).catch((err: unknown) => { console.warn('[ContextBar] poll failed:', err instanceof Error ? err.message : String(err)); });
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { clearInterval(interval); cancelled = true; };
  }, [sessionId]);

  // 每秒更新 elapsed
  useEffect(() => {
    if (!sessionStartedAt) return;
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartedAt!) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sessionStartedAt]);

  // debug: 标记组件已加载
  console.log('[ContextBar] rendered, sessionId=', sessionId, 'ctx=', ctx);

  const model = ctx?.model || '—';
  const total_tokens = ctx?.total_tokens ?? 0;
  const context_limit = ctx?.context_limit || 0;
  const percentage = ctx?.percentage ?? 0;
  const pct = Math.min(percentage, 100);
  const over80 = pct >= 80;
  const over95 = pct >= 95;
  const barColor = over95 ? 'color-mix(in srgb, var(--ui-red) 70%, white)' : over80 ? 'color-mix(in srgb, var(--ui-yellow) 70%, white)' : 'color-mix(in srgb, var(--ui-green) 70%, white)';

  function fmtAgo(s: number): string {
    if (s < 60) return `${s}秒前`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}分钟前`;
    const h = Math.floor(m / 60);
    return `${h}小时${m % 60}分钟前`;
  }

  return (
    <div>
      {/* 信息行：按钮左 + 监控数据右 */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-accent/50 rounded transition-colors"
            title="新建会话 (Ctrl+N)"
            onClick={onNewSession}
          >
            <Plus size={14} strokeWidth={1.5} />
            <span>新建会话</span>
          </button>
          <button
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-accent/50 rounded transition-colors'
            )}
            title="临时提问 (/btw — 不污染上下文)"
            onClick={onBtw}
          >
            <MessageSquareText size={14} strokeWidth={1.5} />
            <span>临时提问</span>
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
          <span className="text-muted-foreground/80" title="当前模型">{model}</span>
          <span>
            {fmtNum(total_tokens)} / {fmtNum(context_limit)} tokens
          </span>
          <span className="font-medium" style={{ color: barColor }}>{pct.toFixed(1)}%</span>
          {sessionStartedAt && (
            <span className="text-muted-foreground/50">开始: {fmtAgo(elapsed)}</span>
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
}
