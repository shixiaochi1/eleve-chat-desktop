/**
 * GoalBar — 进行中目标显示框（对齐 DSH ui-goal GoalBar）
 *
 * 🔴 2026-08-15 老大需求：DSH 前端"进行中目标显示框"移植。
 * DSH 基准：packages/client/ui-goal/src/client/GoalBar.tsx——目标图标 +
 * 阶段标签 + 截断目标文本 + 暂停/恢复/清除图标按钮；complete/null 不渲染。
 *
 * 布局契约（老大要求）：
 * - 普通文档流（非 overlay）：消息区 → 附件缩略图 → 本框 → 输入框，
 *   天然不挡消息，附件缩略图在其上方（各自流位，零 z-index 冲突）。
 * - 数据源 = goal.status WS RPC（轮询 3s + 操作后即时刷新）；
 *   写入走 goal.pause / goal.resume / goal.clear。
 */
import { useCallback, useEffect, useState } from 'react';
import { Target, Pause, Play, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { notifyError } from '../utils/notifications';

export interface GoalSnapshot {
  goal: string;
  status: 'active' | 'paused' | 'done' | 'cleared';
  turns_used: number;
  max_turns: number;
  subgoals: string[];
  has_contract: boolean;
  paused_reason?: string | null;
  waiting?: string | null;
  waiting_reason?: string | null;
  last_verdict?: string | null;
  created_at?: number;
}

const POLL_MS = 3000;

export default function GoalBar({ sessionId }: { sessionId?: string | null }) {
  const [goal, setGoal] = useState<GoalSnapshot | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await call('goal_status', { session_id: sessionId });
      setGoal(res?.goal ?? null);
    } catch {
      // 静默（会话 DB 未就绪等）
    }
  }, [sessionId]);

  // 轮询 + 切会话即时刷新
  useEffect(() => {
    setGoal(null);
    if (!sessionId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, refresh]);

  const runAction = useCallback(
    async (command: string, okText: string) => {
      if (!sessionId || pending) return;
      setPending(true);
      try {
        const res = await call(command, { session_id: sessionId });
        if (res?.ok) {
          await refresh();
        } else if (res?.error) {
          notifyError(new Error(String(res.error)), okText);
        }
      } catch (e) {
        notifyError(e instanceof Error ? e : new Error(String(e)), okText);
      } finally {
        setPending(false);
      }
    },
    [sessionId, pending, refresh],
  );

  // DSH: loading / no goal / complete goals render nothing
  if (!goal || goal.status === 'done' || goal.status === 'cleared') return null;

  const isActive = goal.status === 'active';
  const isPaused = goal.status === 'paused';
  const isWaiting = isActive && !!goal.waiting;
  // 阶段标签（DSH phase label 语义：active/paused/blocked→waiting）
  const phaseLabel = isPaused ? '已暂停' : isWaiting ? '等待中' : '进行中';
  const phaseCls = isPaused ? 'text-muted-foreground/70' : isWaiting ? 'text-primary/80' : 'text-primary';

  return (
    <div className="mx-1 mb-1 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-muted/30">
      <div
        className="flex items-center gap-2 px-2.5 h-9"
        title={goal.goal}
      >
        {/* 目标图标（DSH goalGlyph） */}
        <Target size={13} className={cn('shrink-0', phaseCls)} />
        {/* 阶段标签（DSH label） */}
        <span className={cn('shrink-0 text-[11px] font-medium', phaseCls)}>{phaseLabel}</span>
        {/* 目标文本（DSH objective：截断） */}
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">{goal.goal}</span>
        {/* 轮次预算 */}
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
          {goal.turns_used}/{goal.max_turns}
        </span>
        {/* 等待原因 */}
        {isWaiting && goal.waiting_reason && (
          <span className="shrink-0 max-w-[120px] truncate text-[10px] text-muted-foreground/60">
            ⏳ {goal.waiting_reason}
          </span>
        )}
        {/* 操作按钮（DSH icon actions：active→暂停 / paused→恢复；清除常驻） */}
        <div className="flex shrink-0 items-center gap-0.5">
          {isActive && (
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
              title="暂停目标"
              aria-label="暂停目标"
              disabled={pending}
              onClick={() => void runAction('goal_pause', '暂停失败')}
            >
              <Pause size={11} />
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
              title="恢复目标"
              aria-label="恢复目标"
              disabled={pending}
              onClick={() => void runAction('goal_resume', '恢复失败')}
            >
              <Play size={11} />
            </button>
          )}
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-destructive/15 hover:text-destructive transition-colors disabled:opacity-40"
            title="清除目标"
            aria-label="清除目标"
            disabled={pending}
            onClick={() => void runAction('goal_clear', '清除失败')}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
