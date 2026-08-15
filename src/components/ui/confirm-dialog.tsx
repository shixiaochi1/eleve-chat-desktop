/**
 * ConfirmDialog — 应用内确认浮层（取代 window.confirm）
 *
 * 🔴 2026-08-16（P1 延伸统一）：LearningPanel 删除学习节点 / SessionsPanel
 *   批量删会话 / RollbackPanel 恢复快照 的原生 confirm 统一迁移至此。
 *   样式对齐看板批量确认弹窗（fixed overlay + 卡片）；message 支持多行
 *   （whitespace-pre-line）；确认按钮 danger（删除类）/ warning（恢复类）。
 */
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 确认按钮色调：danger（默认，删除类）/ warning（恢复/危险操作类） */
  tone?: 'danger' | 'warning';
  /** 处理中：禁用按钮并阻止遮罩关闭（供耗时操作复用 busy 状态） */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  // createPortal 到 body：fixed 定位在 transform/filter 祖先下会失效，
  // 面板容器（SidePanel 等）可能有动画容器，portal 保证浮层始终相对视口
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/50"
      onClick={() => { if (!busy) onCancel(); }}
      style={{ animation: 'fadeIn 150ms ease-out' }}
    >
      <div
        className="flex flex-col gap-4 p-5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] shadow-2xl backdrop-blur-sm min-w-[320px] max-w-[440px]"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'scaleIn 150ms ease-out' }}
      >
        <span className="text-[0.9rem] font-semibold text-[var(--ui-text-primary)]">{title}</span>
        <div className="text-[0.8rem] text-[var(--ui-text-tertiary)] leading-relaxed whitespace-pre-line">{message}</div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel} disabled={busy}
            className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors disabled:opacity-50"
          >{cancelLabel}</button>
          <button
            onClick={onConfirm} disabled={busy}
            className={cn('text-[0.8rem] px-3 py-1.5 rounded-md border transition-colors disabled:opacity-50',
              tone === 'danger'
                ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/20'
                : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20')}
          >{busy ? '处理中…' : confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
