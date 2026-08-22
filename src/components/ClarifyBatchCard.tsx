// ClarifyBatchCard — 批量澄清表单（一次表单多题，对齐 Hermes questions batch）
// 多题同屏渲染（单选/多选/开放题混合），一次提交全部答案，按 qid 关联回传。
// 提交格式对齐 Hermes batch callback：{ answers: { qid: raw }, timed_out: false }

import { useCallback, useState } from 'react';
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

export default function ClarifyBatchCard({ clarifyId, title, questions, profile, onDone }: ClarifyBatchCardProps) {
  // qid → 已选值：多选为 string[]，单选/开放为 string
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** 🔴 对齐 ClarifyCard：超时/中断后后端已清 pending → 提交失败折叠为「已过期」态 */
  const [expired, setExpired] = useState(false);

  const setAnswer = useCallback((qid: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted || expired) return;
    setSubmitting(true);
    try {
      // 对齐 Hermes batch callback：{answers: {qid: raw}, timed_out: false}
      const payload = JSON.stringify({ answers, timed_out: false });
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
  }, [clarifyId, submitting, submitted, expired, profile, answers, onDone]);

  if (expired) {
    return (
      <div className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground bg-background/60">
        批量澄清已过期（后端已清理）——无需继续操作。
      </div>
    );
  }

  if (!questions || questions.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2.5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium text-foreground">
          {title || '请回答以下问题'}
        </div>
        <span className="text-[11px] text-muted-foreground">{questions.length} 个问题</span>
      </div>

      {questions.map((q, idx) => {
        const hasChoices = Array.isArray(q.choices) && q.choices.length > 0;
        const isMulti = !!q.multi_select && hasChoices;
        const value = answers[q.qid];
        return (
          <div key={q.qid} className="space-y-1.5">
            <div className="text-xs text-foreground">
              <span className="text-muted-foreground mr-1">#{idx + 1}</span>
              {q.question}
            </div>
            {hasChoices ? (
              <div className="flex flex-wrap gap-1.5">
                {q.choices!.map((c) => {
                  const selected = isMulti
                    ? Array.isArray(value) && value.includes(c)
                    : value === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={submitting || submitted}
                      onClick={() => {
                        if (isMulti) {
                          const cur = Array.isArray(value) ? value : [];
                          const next = cur.includes(c)
                            ? cur.filter((x) => x !== c)
                            : [...cur, c];
                          setAnswer(q.qid, next);
                        } else {
                          setAnswer(q.qid, c);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                        selected
                          ? 'border-primary/70 bg-primary/15 text-foreground'
                          : 'border-border/60 text-muted-foreground hover:border-border'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                value={typeof value === 'string' ? value : ''}
                disabled={submitting || submitted}
                placeholder="输入回答…"
                onChange={(e) => setAnswer(q.qid, e.target.value)}
                className="w-full px-2 py-1 rounded-md text-xs bg-background border border-border/60 text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60"
              />
            )}
          </div>
        );
      })}

      <div className="flex justify-end pt-0.5">
        <button
          type="button"
          disabled={submitting || submitted}
          onClick={handleSubmit}
          className="px-3 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? '提交中…' : submitted ? '已提交' : '提交全部回答'}
        </button>
      </div>
    </div>
  );
}
