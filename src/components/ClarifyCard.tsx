import { useState, useCallback } from 'react';
import { MessageCircleQuestion, Check, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { submitClarifyResponse } from '../utils/api';

/**
 * ClarifyCard — 澄清问题交互卡片（中断型交互卡片家族 · info 变体）
 *
 * 对齐 Eleve clarify_gateway 多平台 UI 逻辑
 * 选项 chips 带数字快捷键，"其他"输入行对齐 Eleve MAX_CHOICES = 4 后自动追加
 */
interface ClarifyCardProps {
  clarifyId?: string;
  question?: string;
  choices?: string[];
  /** 🔴 卡片归属 profile（宫格模式显式传入）；undefined 时自动盖当前活跃 profile（单视图正确） */
  profile?: string;
  onDone?: (response: string) => void;
}

export default function ClarifyCard({ clarifyId, question, choices, profile, onDone }: ClarifyCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [openInput, setOpenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** 🔴 2026-08-11 超时/中断后后端已清 pending → 提交必失败（no pending clarify request）
   *  旧实现只显示红字错误，卡片永不关闭 = 看起来"卡死"。失败即折叠为「已过期」态。 */
  const [expired, setExpired] = useState(false);

  const hasChoices = Array.isArray(choices) && choices.length > 0;

  const handleSubmit = useCallback(async (response: string) => {
    if (submitting || submitted || expired) return;
    setSubmitting(true);
    try {
      const result = await submitClarifyResponse(clarifyId ?? "", response ?? "", profile);
      if (result.status === 'resolved' || result.status === 'ok') {
        setSubmitted(true);
        onDone?.(response);
      } else {
        setExpired(true);
      }
    } catch (err: unknown) {
      // 🔴 后端已无 pending（超时/中断清理）→ 折叠过期态，不再让用户反复点击
      setExpired(true);
    } finally {
      setSubmitting(false);
    }
  }, [clarifyId, submitting, submitted, expired, profile, onDone]);

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

  // ── 已完成折叠态 ──
  if (submitted) {
    return (
      <div className="icard icard--done">
        <div className="icard-head">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="icard-check">
              <Check size={11} strokeWidth={3} />
            </span>
            <span>已回答</span>
          </div>
        </div>
      </div>
    );
  }

  // ── 🔴 已过期折叠态（超时/中断后后端已无 pending）──
  if (expired) {
    return (
      <div className="icard icard--done">
        <div className="icard-head">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="icard-check">
              <Check size={11} strokeWidth={3} />
            </span>
            <span>已过期（未及时回答）</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="icard icard--info">
      {/* 头部 */}
      <div className="icard-head">
        <div className="icard-icon">
          <MessageCircleQuestion size={14} strokeWidth={2} />
        </div>
        <span className="icard-title">Agent 想确认一下</span>
      </div>

      <div className="icard-body">
        <p className="text-[13px] leading-relaxed text-foreground mb-3">{question}</p>

        {hasChoices ? (
          <>
            {/* 选项 chips — 数字快捷键 */}
            <div className="flex flex-wrap gap-2">
              {choices!.map((choice, i) => (
                <button
                  key={i}
                  className={cn('icard-chip', selected === choice && 'selected')}
                  onClick={() => handleChoice(choice)}
                  disabled={submitting}
                >
                  <span className="chip-key">{i + 1}</span>
                  {choice}
                </button>
              ))}
            </div>
            {/* "其他"输入行 — 对齐 Eleve MAX_CHOICES = 4 后自动追加 */}
            {selected === '__other__' || (!selected && choices!.length <= 4) ? (
              <div className="flex items-center gap-2 mt-2.5">
                <input
                  type="text"
                  className={cn(
                    'h-8 min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-3 text-xs text-foreground outline-none transition-all',
                    'placeholder:text-muted-foreground/50',
                    'focus:border-info/50 focus:bg-info/5 focus:ring-2 focus:ring-info/15',
                    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                  placeholder="其他 — 输入你的回答，回车发送"
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
                    'flex size-8 shrink-0 items-center justify-center rounded-lg transition-all',
                    'bg-info text-background shadow-sm',
                    'hover:brightness-110 hover:-translate-y-px active:scale-95',
                    'disabled:pointer-events-none disabled:opacity-40'
                  )}
                  onClick={handleOtherSubmit}
                  disabled={submitting || !otherText.trim()}
                  title="发送"
                >
                  {submitting ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Send size={13} />
                  )}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          /* 开放式回答 */
          <div className="space-y-2">
            <textarea
              className={cn(
                'w-full resize-none rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground outline-none transition-all',
                'placeholder:text-muted-foreground/50',
                'focus:border-info/50 focus:bg-info/5 focus:ring-2 focus:ring-info/15',
                'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
              )}
              placeholder="输入你的回答…（Enter 发送，Shift+Enter 换行）"
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
            <div className="flex justify-end">
              <button
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg bg-info px-3.5 py-1.5 text-xs font-semibold text-background shadow-sm transition-all',
                  'hover:brightness-110 hover:-translate-y-px active:scale-95',
                  'disabled:pointer-events-none disabled:opacity-40'
                )}
                onClick={handleOpenSubmit}
                disabled={submitting || !openInput.trim()}
              >
                {submitting ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Send size={12} />
                )}
                发送
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
