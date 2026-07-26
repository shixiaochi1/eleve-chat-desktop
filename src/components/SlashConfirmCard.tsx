import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { getWsClient } from '../services/ws-client';

/**
 * SlashConfirmCard — 破坏性斜杠命令确认卡片
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
  onDone?: (choice: string, result?: any) => void;
}

export default function SlashConfirmCard({
  confirmId,
  command,
  description,
  sessionId,
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
      });
      setSubmitted(choice);
      onDone?.(choice, result);
    } catch (err: unknown) {
      setError((err as Error).message || '网络错误');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, submitted, confirmId, command, sessionId, onDone]);

  if (submitted) {
    const label = submitted === 'cancel' ? '已取消' : submitted === 'always' ? '已始终允许' : '已确认执行';
    return (
      <div className="mx-4 my-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        ⚠️ /{command} — {label}
      </div>
    );
  }

  return (
    <div className="mx-4 my-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span className="text-base leading-none mt-0.5">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground mb-0.5">
            确认执行 /{command}？
          </p>
          <p className="text-xs text-muted-foreground mb-3">{description}</p>

          {error && (
            <p className="text-xs text-red-500 mb-2">{error}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              disabled={submitting}
              onClick={() => void handleChoice('once')}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                submitting && 'opacity-50 cursor-not-allowed',
              )}
            >
              {submitting ? '处理中…' : '确认执行'}
            </button>
            <button
              disabled={submitting}
              onClick={() => void handleChoice('always')}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                'border border-border text-muted-foreground hover:bg-muted/50',
                submitting && 'opacity-50 cursor-not-allowed',
              )}
            >
              始终允许
            </button>
            <button
              disabled={submitting}
              onClick={() => void handleChoice('cancel')}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                'border border-border text-muted-foreground hover:bg-muted/50',
                submitting && 'opacity-50 cursor-not-allowed',
              )}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
