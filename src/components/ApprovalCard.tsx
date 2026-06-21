import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';

/**
 * ApprovalCard — 危险操作审批卡片
 *
 * 对齐 Eleve approval_blocking: 当终端等工具执行危险命令时，
 * 前端显示此卡片让用户选择审批级别。
 * Choices: "once" | "session" | "always" | "deny"
 */
interface ApprovalCardProps {
  command?: string;
  description?: string;
  pattern?: string;
  choices?: string[];
  session_id?: string;
  onDone?: (choice: string) => void;
}

export default function ApprovalCard({ command, description, pattern, choices, session_id, onDone }: ApprovalCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choiceLabels: Record<string, string> = {
    once: '批准本次',
    session: '批准此会话',
    always: '始终批准',
    deny: '拒绝',
  };

  const handleChoice = useCallback(async (choice: string) => {
    if (submitting || submitted) return;
    setSubmitting(true);
    setSelected(choice);
    setError(null);
    try {
      const result = await call(
        choice === 'deny' ? 'deny' : 'approve',
        { session_id, choice, resolve_all: false }
      );
      if (result.resolved !== undefined && result.resolved > 0) {
        setSubmitted(true);
        onDone?.(choice);
      } else {
        setError(result.error || '操作失败');
      }
    } catch (err: unknown) {
      setError((err as Error).message || '网络错误');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, submitted, onDone, session_id]);

  if (submitted) {
    return (
      <div className={cn(
        'rounded-lg border bg-card px-4 py-3 shadow-sm',
        'opacity-60'
      )}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>已{selected === 'deny' ? '拒绝' : '批准'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-lg border bg-card px-4 py-3 shadow-sm'
    )}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span>需要审批</span>
        {pattern && (
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {pattern}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {description && (
          <div className="text-sm text-muted-foreground">{description}</div>
        )}
        <div className={cn(
          'rounded-md bg-muted p-2',
          'font-mono text-xs leading-relaxed text-foreground'
        )}>
          <code>{command}</code>
        </div>
      </div>

      {error && (
        <div className="mt-2 text-sm text-destructive">{error}</div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {(choices || ['once', 'session', 'always', 'deny']).map((choice) => (
          <button
            key={choice}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              'disabled:pointer-events-none disabled:opacity-50',
              choice === 'deny'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
              selected === choice && !submitting && 'ring-2 ring-ring ring-offset-1 ring-offset-card'
            )}
            onClick={() => handleChoice(choice)}
            disabled={submitting}
          >
            {submitting && selected === choice ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : null}
            {choiceLabels[choice] || choice}
          </button>
        ))}
      </div>
    </div>
  );
}
