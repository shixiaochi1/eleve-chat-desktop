// ClarifyBatchCard — 批量澄清向导（一题一页，对齐 Hermes questions batch）
// 每页一道题：选项（单选点击即进下一题；多选勾选）+ 手动输入兜底（选项都不对时直接输入）；
// 全部答完统一提交 {answers: {qid: raw}, timed_out: false}，按 qid 关联回传。
// 答案优先级：手动输入非空 → 以输入为准；否则选项选择；未答的题不包含（后端 user_response=""）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { submitClarifyResponse } from '../utils/api';

export interface BatchQuestionWire {
  qid: string;
  id?: string | null;
  question: string;
  choices?: string[] | null;
  multi_select?: boolean;
}

interface ClarifyBatchCardProps {
  clarifyId: string;
  title?: string | null;
  questions: BatchQuestionWire[];
  profile?: string;
  onDone?: (response: string) => void;
}

/** 单选选中后自动跳下一题的延迟（让用户看到选中态再跳转） */
const AUTO_ADVANCE_MS = 220;

export default function ClarifyBatchCard({ clarifyId, title, questions, profile, onDone }: ClarifyBatchCardProps) {
  // 选项选择：单选 string / 多选 string[]
  const [selected, setSelected] = useState<Record<string, string | string[]>>({});
  // 手动输入（选项都不对时的兜底答案）
  const [texts, setTexts] = useState<Record<string, string>>({});
  // 当前题索引（一题一页）
  const [currentIdx, setCurrentIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** 🔴 对齐 ClarifyCard：超时/中断后后端已清 pending → 提交失败折叠为「已过期」态 */
  const [expired, setExpired] = useState(false);
  const advanceTimer = useRef<number | undefined>(undefined);

  const total = questions?.length ?? 0;
  const isLast = currentIdx >= total - 1;

  // 卸载时清理自动跳转定时器
  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  // 手动输入：非空 → 以输入为准（清除该题选项选择，避免两者冲突）
  const setText = useCallback((qid: string, value: string) => {
    setTexts((prev) => ({ ...prev, [qid]: value }));
    if (value.trim() !== '') {
      setSelected((prev) => {
        if (prev[qid] === undefined) return prev;
        const next = { ...prev };
        delete next[qid];
        return next;
      });
    }
  }, []);

  // 选项点击：单选立即选中并自动进下一题；多选勾选切换（不自动跳）
  const pickOption = useCallback((qid: string, choice: string, isMulti: boolean, idx: number) => {
    setSelected((prev) => {
      if (isMulti) {
        const cur = Array.isArray(prev[qid]) ? (prev[qid] as string[]) : [];
        const next = cur.includes(choice) ? cur.filter((x) => x !== choice) : [...cur, choice];
        return { ...prev, [qid]: next };
      }
      return { ...prev, [qid]: choice };
    });
    // 点选项即清除手动输入（答案以最后动作为准）
    setTexts((prev) => {
      if (!prev[qid]) return prev;
      const next = { ...prev };
      delete next[qid];
      return next;
    });
    // 单选 → 选中后自动跳下一题（最后一题不跳，等待统一提交）
    if (!isMulti && idx < total - 1) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = window.setTimeout(() => setCurrentIdx(idx + 1), AUTO_ADVANCE_MS);
    }
  }, [total]);

  const goPrev = useCallback(() => setCurrentIdx((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setCurrentIdx((i) => Math.min(total - 1, i + 1)), [total]);

  // 组装提交答案：手动输入优先，否则选项选择；未答的题不包含（后端 user_response=""）
  const buildAnswers = useCallback(() => {
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const t = (texts[q.qid] ?? '').trim();
      if (t) {
        answers[q.qid] = t;
      } else if (selected[q.qid] !== undefined) {
        answers[q.qid] = selected[q.qid];
      }
    }
    return answers;
  }, [questions, texts, selected]);

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted || expired) return;
    setSubmitting(true);
    try {
      // 对齐 Hermes batch callback：{answers: {qid: raw}, timed_out: false}
      const payload = JSON.stringify({ answers: buildAnswers(), timed_out: false });
      const result = await submitClarifyResponse(clarifyId ?? '', payload, profile);
      if (result?.status === 'resolved' || result?.status === 'ok' || result?.ok) {
        setSubmitted(true);
        onDone?.(payload);
      } else {
        setExpired(true);
      }
    } catch {
      setExpired(true);
    } finally {
      setSubmitting(false);
    }
  }, [clarifyId, submitting, submitted, expired, profile, buildAnswers, onDone]);

  if (expired) {
    return (
      <div className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground bg-background/60">
        批量澄清已过期（后端已清理）——无需继续操作。
      </div>
    );
  }

  if (total === 0) return null;

  const q = questions[currentIdx];
  const hasChoices = Array.isArray(q.choices) && q.choices.length > 0;
  const isMulti = !!q.multi_select && hasChoices;
  const sel = selected[q.qid];
  const text = texts[q.qid] ?? '';
  const answered = text.trim() !== '' || sel !== undefined;

  return (
    <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2.5 space-y-2.5">
      {/* 头部：标题 + 题号进度 */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-foreground truncate">
          {title || '请回答以下问题'}
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">第 {currentIdx + 1}/{total} 题</span>
      </div>
      {/* 进度条 */}
      <div className="h-0.5 w-full bg-border/50 rounded overflow-hidden">
        <div
          className="h-full bg-primary rounded transition-all duration-200"
          style={{ width: `${((currentIdx + 1) / total) * 100}%` }}
        />
      </div>

      {/* 当前题（一题一页） */}
      <div className="space-y-2" key={q.qid}>
        <div className="text-xs text-foreground">
          <span className="text-muted-foreground mr-1">#{currentIdx + 1}</span>
          {q.question}
        </div>

        {hasChoices && (
          <div className="space-y-1">
            {q.choices!.map((c) => {
              const flag = isMulti
                ? Array.isArray(sel) && sel.includes(c)
                : sel === c;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={submitting || submitted}
                  onClick={() => pickOption(q.qid, c, isMulti, currentIdx)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors ${
                    flag
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-background'
                  }`}
                >
                  {/* 单选圆点 / 多选方块 */}
                  <span
                    className={`w-3.5 h-3.5 shrink-0 flex items-center justify-center border transition-colors ${
                      isMulti ? 'rounded-[3px]' : 'rounded-full'
                    } ${flag ? 'border-primary bg-primary' : 'border-border/80 bg-transparent'}`}
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
                  <span className="truncate">{c}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 手动输入兜底：选项都不对时直接输入（每页始终可用） */}
        <input
          type="text"
          value={text}
          disabled={submitting || submitted}
          placeholder={hasChoices ? '选项都不合适？手动输入回答…' : '输入回答…'}
          onChange={(e) => setText(q.qid, e.target.value)}
          onKeyDown={(e) => {
            // 回车：最后一题提交，否则进下一题
            if (e.key === 'Enter') {
              e.preventDefault();
              if (isLast) void handleSubmit();
              else goNext();
            }
          }}
          className="w-full px-2 py-1 rounded-md text-xs bg-background border border-border/60 text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60"
        />

        {isMulti && (
          <div className="text-[11px] text-muted-foreground">可多选，选完后点击「下一步」</div>
        )}
      </div>

      {/* 底部导航：上一步 / 下一步（最后一题：提交全部回答） */}
      <div className="flex items-center justify-between pt-0.5">
        <button
          type="button"
          disabled={currentIdx === 0 || submitting || submitted}
          onClick={goPrev}
          className="px-2.5 py-1 rounded-md text-xs border border-border/60 text-muted-foreground hover:border-border disabled:opacity-40"
        >
          上一步
        </button>
        {isLast ? (
          <button
            type="button"
            disabled={submitting || submitted}
            onClick={handleSubmit}
            className="px-3 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '提交中…' : submitted ? '已提交' : answered ? '提交全部回答' : '跳过并提交'}
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting || submitted}
            onClick={goNext}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            下一步
          </button>
        )}
      </div>
    </div>
  );
}
