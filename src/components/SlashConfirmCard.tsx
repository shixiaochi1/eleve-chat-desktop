import { useState, useCallback } from 'react';
import { AlertTriangle, Terminal, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWsClient } from '../services/ws-client';

/**
 * SlashConfirmCard — 破坏性斜杠命令确认卡片（中断型交互卡片家族 · danger 变体）
 *
 * 对齐 Hermes destructive_slash_confirm：/new, /undo, /reset 执行前的二次确认。
 * Choices: "once"（执行一次）| "always"（始终允许并持久化）| "cancel"（取消）
 *
 * 回传走 WS JSON-RPC slash_confirm.respond。
 */
interface SlashConfirmCardProps {
  confirmId: string;
  command: string;
  description: string;
  sessionId?: string;
  /** 🔴 卡片归属 profile（宫格模式显式传入）；undefined 时 sendRpc 自动盖章（单视图正确） */
  profile?: string;
  onDone?: (choice: string, result?: any) => void;
}

export default function SlashConfirmCard({
  confirmId,
  command,
  description,
  sessionId,
  profile,
  onDone,
}: SlashConfirmCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChoice = useCallback(async (choice: string) => {
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(null);
    try {
      const ws = getWsClient();
      const result = await ws.sendRpc('slash_confirm.respond', {
        confirm_id: confirmId,
        choice,
        session_id: sessionId || '',
        command,
        profile, // 显式归属 profile（undefined → sendRpc 自动盖章）
      });
      setSubmitted(choice);
      onDone?.(choice, result);
    } catch (err: unknown) {
      setError((err as Error).message || '网络错误');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, submitted, confirmId, command, sessionId, profile, onDone]);

  // ── 已完成折叠态 ──
  if (submitted) {
    const label = submitted === 'cancel' ? '已取消' : submitted === 'always' ? '已始终允许' : '已确认执行';
    return (
      <div className="icard icard--done">
        <div className="icard-head">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="icard-check">
              <Check size={11} strokeWidth={3} />
            </span>
            <span className="font-mono">/{command}</span>
            <span>{label}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="icard icard--danger">
      {/* 头部 */}
      <div className="icard-head">
        <div className="icard-icon">
          <AlertTriangle size={14} strokeWidth={2} />
        </div>
        <span className="icard-title">破坏性操作确认</span>
        <span className="icard-badge">不可撤销</span>
      </div>

      <div className="icard-body">
        {/* 斜杠命令徽章 */}
        <div className="icard-slash mb-2.5">
          <Terminal size={12} strokeWidth={2.5} />
          /{command}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>

        {error && (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        )}

        {/* 按钮层级：取消(幽灵) ← 间隔 → 执行一次(次级) → 始终允许(危险主操作) */}
        <div className="flex items-center gap-2 mt-3.5">
          <button
            disabled={submitting}
            onClick={() => void handleChoice('cancel')}
            className={cn(
              'inline-flex items-center justify-center rounded-lg border border-[var(--ui-stroke-tertiary)] px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all',
              'hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              'disabled:pointer-events-none disabled:opacity-50',
              'active:scale-95'
            )}
          >
            取消
          </button>
          <span className="flex-1" />
          <button
            disabled={submitting}
            onClick={() => void handleChoice('once')}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all',
              'hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40',
              'disabled:pointer-events-none disabled:opacity-50',
              'active:scale-95'
            )}
          >
            {submitting ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : null}
            执行一次
          </button>
          <button
            disabled={submitting}
            onClick={() => void handleChoice('always')}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground shadow-sm transition-all',
              'hover:brightness-110 hover:-translate-y-px',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40',
              'disabled:pointer-events-none disabled:opacity-50',
              'active:scale-95'
            )}
          >
            始终允许
          </button>
        </div>
      </div>
    </div>
  );
}
