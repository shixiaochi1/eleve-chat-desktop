import { useState, useCallback } from 'react';
import { Check, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { submitClarifyResponse } from '../utils/api';

/**
 * ClarifyCard — 澄清问题交互卡片（单题）
 *
 * 🔴 UI 与 ClarifyBatchCard（批量多题）统一为同一视觉语言：
 * - 容器/头部/选项（纵向 radio/checkbox 行）/手动输入兜底/提交按钮同款样式
 * - 单选点选项即提交（Hermes 单选语义，与批量卡"选中即前进"的即时性一致）；
 *   多选勾选后点「提交选择」；开放题输入 + 发送
 * - 手动输入兜底：选项都不合适时直接输入（placeholder 明确引导），答案以最后动作为准
 */
interface ClarifyCardProps {
  clarifyId?: string;
  question?: string;
  choices?: string[];
  /** 🔴 多选（checkbox）——后端多选语义全链路透传；缺失/undefined = 单选（radio） */
  multiSelect?: boolean;
  /** 🔴 卡片归属 profile（宫格模式显式传入）；undefined 时自动盖当前活跃 profile（单视图正确） */
  profile?: string;
  onDone?: (response: string) => void;
}

export default function ClarifyCard({ clarifyId, question, choices, multiSelect, profile, onDone }: ClarifyCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  // 手动输入兜底（选项都不合适时的自定义回答）
  const [otherText, setOtherText] = useState('');
  const [openInput, setOpenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** 🔴 2026-08-11 超时/中断后后端已清 pending → 提交必失败（no pending clarify request）
   *  旧实现只显示红字错误，卡片永不关闭 = 看起来"卡死"。失败即折叠为「已过期」态。 */
  const [expired, setExpired] = useState(false);

  const hasChoices = Array.isArray(choices) && choices.length > 0;
  // 多选仅在 choices 存在时生效（对齐后端 multi_select && choices.is_some()）
  const isMulti = !!multiSelect && hasChoices;

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

  // 单选：点选项即提交（Hermes 语义，与批量卡"选中即前进"即时性一致）
  const handleChoice = useCallback((choice: string) => {
    setSelected(choice);
    // 点选项即清除手动输入（答案以最后动作为准——对齐批量卡互斥逻辑）
    setOtherText('');
    handleSubmit(choice);
  }, [handleSubmit]);

  /** 🔴 多选：勾选切换，不立即提交（对齐 Hermes checkbox 语义；提交 JSON 数组
   *  字符串 → 后端 _parse_multi_select_response 解码回列表） */
  const toggleMulti = useCallback((choice: string) => {
    setMultiSelected((prev) =>
      prev.includes(choice) ? prev.filter((c) => c !== choice) : [...prev, choice]
    );
    // 勾选即清除手动输入（互斥，对齐批量卡）
    setOtherText('');
  }, []);

  const handleMultiSubmit = useCallback(() => {
    if (multiSelected.length === 0) return;
    handleSubmit(JSON.stringify(multiSelected));
  }, [multiSelected, handleSubmit]);

  // 手动输入（选项都不合适时）：非空 → 清除选项勾选（互斥，以输入为准）
  const handleOtherChange = useCallback((value: string) => {
    setOtherText(value);
    if (value.trim() !== '') {
      setSelected(null);
      setMultiSelected([]);
    }
  }, []);

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
      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground bg-background flex items-center gap-2">
        <span className="icard-check">
          <Check size={11} strokeWidth={3} />
        </span>
        <span>已回答</span>
      </div>
    );
  }

  // ── 🔴 已过期折叠态（超时/中断后后端已无 pending）──
  if (expired) {
    return (
      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground bg-background flex items-center gap-2">
        <span className="icard-check">
          <Check size={11} strokeWidth={3} />
        </span>
        <span>已过期（未及时回答）</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5 space-y-2.5">
      {/* 头部：标题（与批量卡同款样式） */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-foreground truncate">Agent 想确认一下</div>
      </div>

      {/* 问题文本 */}
      <div className="text-xs text-foreground">{question}</div>

      {hasChoices ? (
        <div className="space-y-2">
          {/* 选项：纵向列表行（单选圆点 / 多选方块+勾）——与批量卡同款 */}
          <div className="space-y-1">
            {choices!.map((choice, i) => {
              const flag = isMulti
                ? multiSelected.includes(choice)
                : selected === choice;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={submitting || submitted}
                  onClick={() => (isMulti ? toggleMulti(choice) : handleChoice(choice))}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors',
                    flag
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-background'
                  )}
                >
                  {/* 单选圆点 / 多选方块 */}
                  <span
                    className={cn(
                      'w-3.5 h-3.5 shrink-0 flex items-center justify-center border transition-colors',
                      isMulti ? 'rounded-[3px]' : 'rounded-full',
                      flag ? 'border-primary bg-primary' : 'border-border/80 bg-transparent'
                    )}
                  >
                    {flag &&
                      (isMulti ? (
                        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 6.5 L5 9 L9.5 3.5" />
                        </svg>
                      ) : (
                        <span className="w-1 h-1 rounded-full bg-white" />
                      ))}
                  </span>
                  <span className="truncate">{choice}</span>
                </button>
              );
            })}
          </div>

          {/* 多选提示 + 提交 */}
          {isMulti && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">可多选</span>
              <button
                type="button"
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90',
                  'disabled:pointer-events-none disabled:opacity-50'
                )}
                onClick={handleMultiSubmit}
                disabled={submitting || multiSelected.length === 0}
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    提交中…
                  </span>
                ) : (
                  '提交选择'
                )}
              </button>
            </div>
          )}

          {/* 手动输入兜底：选项都不合适时直接输入（与批量卡同款） */}
          <input
            type="text"
            value={otherText}
            disabled={submitting || submitted}
            placeholder="选项都不合适？手动输入回答…"
            onChange={(e) => handleOtherChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleOtherSubmit();
              }
            }}
            className="w-full px-2 py-1 rounded-md text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60"
          />
        </div>
      ) : (
        /* 开放式回答（与批量卡开放题同款输入框 + 发送按钮） */
        <div className="space-y-2">
          <input
            type="text"
            value={openInput}
            disabled={submitting || submitted}
            placeholder="输入回答…（Enter 发送）"
            onChange={(e) => setOpenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleOpenSubmit();
              }
            }}
            className="w-full px-2 py-1 rounded-md text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60"
          />
          <div className="flex justify-end">
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90',
                'disabled:pointer-events-none disabled:opacity-50'
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
  );
}
