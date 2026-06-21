import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { submitClarifyResponse } from '../utils/api';

/**
 * ClarifyCard — 澄清问题交互卡片
 *
 * macOS Apple 风格：圆角卡片、多选/开放输入
 * 对齐 Eleve clarify_gateway 多平台 UI 逻辑
 */
interface ClarifyCardProps {
  clarifyId?: string;
  question?: string;
  choices?: string[];
  onDone?: (response: string) => void;
}

export default function ClarifyCard({ clarifyId, question, choices, onDone }: ClarifyCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [openInput, setOpenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChoices = Array.isArray(choices) && choices.length > 0;

  const handleSubmit = useCallback(async (response: string) => {
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitClarifyResponse(clarifyId ?? "", response ?? "");
      if (result.status === 'resolved') {
        setSubmitted(true);
        onDone?.(response);
      } else {
        setError(result.error || '提交失败');
      }
    } catch (err: unknown) {
      setError((err as Error).message || '网络错误');
    } finally {
      setSubmitting(false);
    }
  }, [clarifyId, submitting, submitted, onDone]);

  const handleChoice = useCallback((choice: string) => {
    setSelected(choice);
    handleSubmit(choice);
  }, [handleSubmit]);

  const handleOtherSubmit = useCallback(() => {
    const text = otherText.trim();
    if (!text) return;
    handleSubmit(text);
  }, [otherText, handleSubmit]);

  const handleOpenSubmit = useCallback(() => {
    const text = openInput.trim();
    if (!text) return;
    handleSubmit(text);
  }, [openInput, handleSubmit]);

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
          <span>已回答</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border bg-card px-4 py-3 shadow-sm')}>
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>需要澄清</span>
      </div>
      <div className="mt-2 text-sm text-foreground">{question}</div>

      {error && (
        <div className="mt-2 text-sm text-destructive">{error}</div>
      )}

      {hasChoices ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {choices!.map((choice, i) => (
            <button
              key={i}
              className={cn(
                'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                'disabled:pointer-events-none disabled:opacity-50',
                selected === choice
                  ? 'bg-primary text-primary-foreground ring-2 ring-ring ring-offset-1 ring-offset-card'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              )}
              onClick={() => handleChoice(choice)}
              disabled={submitting}
            >
              {choice}
            </button>
          ))}
          {/* 第 5 个"其他"选项 — 对齐 Eleve MAX_CHOICES = 4 后自动追加 */}
          {selected === '__other__' || (!selected && choices!.length <= 4) ? (
            <div className="mt-2 flex w-full gap-2">
              <input
                type="text"
                className={cn(
                  'desktop-input-chrome h-8 min-w-0 flex-1 rounded-md border px-2 py-1 text-sm outline-none',
                  'placeholder:text-muted-foreground',
                  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
                )}
                placeholder="其他（输入你的回答）"
                value={otherText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setOtherText(e.target.value);
                  setSelected('__other__');
                }}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') handleOtherSubmit();
                }}
                disabled={submitting}
              />
              <button
                className={cn(
                  'inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all',
                  'hover:bg-primary/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  'disabled:pointer-events-none disabled:opacity-50'
                )}
                onClick={handleOtherSubmit}
                disabled={submitting || !otherText.trim()}
              >
                {submitting ? (
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <textarea
            className={cn(
              'desktop-input-chrome w-full rounded-md border px-3 py-2 text-sm outline-none',
              'resize-none placeholder:text-muted-foreground',
              'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
            )}
            placeholder="输入你的回答..."
            rows={3}
            value={openInput}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setOpenInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleOpenSubmit();
              }
            }}
            disabled={submitting}
          />
          <button
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-all',
              'hover:bg-primary/90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              'disabled:pointer-events-none disabled:opacity-50'
            )}
            onClick={handleOpenSubmit}
            disabled={submitting || !openInput.trim()}
          >
            {submitting ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
            <span>发送</span>
          </button>
        </div>
      )}
    </div>
  );
}
