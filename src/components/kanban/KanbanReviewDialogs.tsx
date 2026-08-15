/**
 * KanbanReviewDialogs — 提交评审 force 覆盖确认 / 评审退回理由输入浮层
 *
 * 🔴 2026-08-16（P1 遗留闭合）：取代原生 confirm()/prompt()/alert()——对齐
 *   Hermes 无原生弹窗约定。两个浮层：
 *   1. force 确认：任务 running 时提交评审需显式覆盖（清空 worker claim）
 *   2. 退回理由：request_changes 必填 reason（浮层内校验非空）
 * 主面板（KanbanPanel）与侧边栏（KanbanPanelForSidebar）共用。
 * 样式对齐 KanbanPanel 既有批量确认/改优先级弹窗（fixed overlay + 卡片）。
 */
import { useEffect, useRef, useState } from 'react';
import type { KanbanTask } from './types';
import { cn } from '../../lib/utils';

interface Props {
  pendingForceReview: KanbanTask | null;
  pendingChanges: KanbanTask | null;
  reviewBusy: boolean;
  onConfirmForceReview: () => void;
  onCancelForceReview: () => void;
  onSubmitChanges: (reason: string) => void;
  onCancelChanges: () => void;
}

export function KanbanReviewDialogs({
  pendingForceReview,
  pendingChanges,
  reviewBusy,
  onConfirmForceReview,
  onCancelForceReview,
  onSubmitChanges,
  onCancelChanges,
}: Props) {
  // 退回理由草稿——每次打开浮层重置并聚焦
  const [reasonDraft, setReasonDraft] = useState('');
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (pendingChanges) {
      setReasonDraft('');
      // 浮层挂载后聚焦输入框
      requestAnimationFrame(() => reasonInputRef.current?.focus());
    }
  }, [pendingChanges]);
  const reasonEmpty = !reasonDraft.trim();

  return (
    <>
      {/* 提交评审 force 覆盖确认（running 任务，对齐 Hermes request_review force 语义） */}
      {pendingForceReview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/50"
          onClick={() => { if (!reviewBusy) onCancelForceReview(); }}
          style={{ animation: 'fadeIn 150ms ease-out' }}
        >
          <div
            className="flex flex-col gap-4 p-5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-2xl backdrop-blur-sm min-w-[320px] max-w-[420px]"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'scaleIn 150ms ease-out' }}
          >
            <span className="text-[0.9rem] font-semibold text-[var(--ui-text-primary)]">提交评审</span>
            <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] leading-relaxed">
              任务 <span className="text-[var(--ui-text-primary)]">{pendingForceReview.title || pendingForceReview.id}</span> 正在运行中，
              提交评审将清空 worker 的 claim（需显式覆盖，对齐 Hermes force 语义）。确认继续？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancelForceReview} disabled={reviewBusy}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors disabled:opacity-50"
              >取消</button>
              <button
                onClick={onConfirmForceReview} disabled={reviewBusy}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 transition-colors disabled:opacity-50"
              >{reviewBusy ? '提交中…' : '确认提交评审'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 评审退回理由输入（必填，对齐 Hermes request_changes reason） */}
      {pendingChanges && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/50"
          onClick={() => { if (!reviewBusy) onCancelChanges(); }}
          style={{ animation: 'fadeIn 150ms ease-out' }}
        >
          <div
            className="flex flex-col gap-4 p-5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-2xl backdrop-blur-sm min-w-[320px] max-w-[460px]"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'scaleIn 150ms ease-out' }}
          >
            <span className="text-[0.9rem] font-semibold text-[var(--ui-text-primary)]">退回评审返工</span>
            <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] leading-relaxed">
              任务 <span className="text-[var(--ui-text-primary)]">{pendingChanges.title || pendingChanges.id}</span> 将退回实现者按理由重跑。
              请输入退回理由（必填）：
            </p>
            <textarea
              ref={reasonInputRef}
              value={reasonDraft}
              onChange={e => setReasonDraft(e.target.value)}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !reasonEmpty && !reviewBusy) {
                  onSubmitChanges(reasonDraft);
                }
              }}
              rows={3}
              placeholder="说明需要修改的内容…"
              className="w-full rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] px-3 py-2 text-[0.8rem] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)] resize-none"
            />
            {reasonEmpty && (
              <p className="text-[0.72rem] text-danger">退回理由不能为空</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onCancelChanges} disabled={reviewBusy}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors disabled:opacity-50"
              >取消</button>
              <button
                onClick={() => onSubmitChanges(reasonDraft)}
                disabled={reasonEmpty || reviewBusy}
                className={cn('text-[0.8rem] px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50',
                  !reasonEmpty && !reviewBusy
                    ? 'border-info/30 bg-info/10 text-info hover:bg-info/20'
                    : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] cursor-not-allowed')}
              >{reviewBusy ? '提交中…' : '确认退回'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
