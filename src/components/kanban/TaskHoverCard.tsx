/**
 * TaskHoverCard — 看板任务卡片 hover 状态浮层
 *
 * 🔴 2026-08-16：侧边栏看板卡片极小（72px 宽）、主看板卡片标题/摘要截断，
 *   任务内容与状态看不清——hover 显示完整状态浮层（标题全文、状态徽标、
 *   负责人、优先级、摘要、创建时间、完整 ID、评论/链接/诊断、阻塞原因）。
 *
 * 实现要点：
 * - createPortal 到 body：fixed 定位在 transform/overflow 祖先下会失效
 *   （列容器 overflow-y-auto、卡片 hover 有 translate 动画）
 * - 200ms 延迟打开防抖动（掠过卡片不闪浮层）；跟随鼠标移动；
 *   右侧优先、出屏翻转到左侧；pointer-events-none 不挡卡片交互
 * - useTaskHover hook 供主看板/侧边栏卡片复用（enter 开定时器，move 更新
 *   坐标，leave 清定时器并关闭）
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KanbanTask } from './types';
import { COLUMNS } from './constants';
import { cn } from '../../lib/utils';

/** hover 状态管理 hook：返回绑定到卡片的鼠标事件处理器与浮层位置 */
export function useTaskHover(task: KanbanTask | null) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 只需 client 坐标——宽松签名兼容 React/DOM 任意 mouse 事件
  const enter = (e: { clientX: number; clientY: number }) => {
    if (timer.current) clearTimeout(timer.current);
    const x = e.clientX, y = e.clientY;
    timer.current = setTimeout(() => setPos({ x, y }), 200);
  };
  const move = (e: { clientX: number; clientY: number }) => {
    if (pos) setPos({ x: e.clientX, y: e.clientY });
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return {
    hoverEl: pos && task ? <TaskHoverCard task={task} x={pos.x} y={pos.y} /> : null,
    hoverHandlers: { onMouseEnter: enter, onMouseMove: move, onMouseLeave: leave },
  };
}

interface TaskHoverCardProps {
  task: KanbanTask;
  /** 鼠标 client 坐标 */
  x: number;
  y: number;
}

export function TaskHoverCard({ task, x, y }: TaskHoverCardProps) {
  const col = COLUMNS.find(c => c.key === task.status);
  const statusLabel = col?.label ?? task.status;
  const statusColor = col?.dotColor;
  const priorityLevel = task.priority ? String(task.priority).replace(/^p/i, '') : null;
  // 🔴 对齐 KanbanColumn：摘要 = latest_summary || body（normalize 已并入 task.summary）
  const summary = task.summary || task.body;
  const links = task.link_counts ? task.link_counts.parents + task.link_counts.children : 0;

  // 右侧优先；出屏翻转到左侧（280px 卡片 + 16px 间距）
  const CARD_W = 280, GAP = 16;
  const left = x + GAP + CARD_W > window.innerWidth ? x - GAP - CARD_W : x + GAP;
  const top = Math.max(8, Math.min(y + 12, window.innerHeight - 48));

  return createPortal(
    <div
      className="fixed z-[70] w-[280px] rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-elevated)] shadow-2xl p-3 space-y-2 pointer-events-none"
      style={{ left, top, animation: 'fadeIn 120ms ease-out' }}
    >
      {/* 头部：状态徽标 + 优先级 + 完整 ID */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-medium text-[var(--ui-text-secondary)]">
          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
          {statusLabel}
        </span>
        {priorityLevel !== null && ['1', '2', '3'].includes(priorityLevel) && (
          <span className="font-mono text-[0.62rem] px-1 py-px rounded-sm bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)]">
            P{priorityLevel}
          </span>
        )}
        <span className="ml-auto font-mono text-[0.6rem] text-[var(--ui-text-quaternary)]">
          #{typeof task.id === 'string' ? task.id.replace(/^t_/, '') : task.id}
        </span>
      </div>

      {/* 标题（全文不截断） */}
      <div className="text-[0.82rem] font-semibold leading-snug text-[var(--ui-text-primary)] break-words">
        {task.title || '(无标题)'}
      </div>

      {/* 负责人 + 创建时间 */}
      <div className="flex items-center gap-2 text-[0.68rem] text-[var(--ui-text-tertiary)]">
        {task.assignee ? (
          <span className="inline-flex items-center gap-1 font-medium truncate max-w-[140px]">
            <span
              className="grid size-3.5 shrink-0 place-items-center rounded-full text-[0.5rem] font-semibold text-[var(--ui-text-primary)]"
              style={{ backgroundColor: `color-mix(in srgb, var(--priority-${priorityLevel ?? '1'}) 45%, transparent)` }}
            >
              {task.assignee.trim().charAt(0).toUpperCase()}
            </span>
            {task.assignee}
          </span>
        ) : (
          <span className="text-[var(--ui-text-quaternary)]">未分配</span>
        )}
        {task.created_at && (
          <span className="tabular-nums ml-auto whitespace-nowrap">
            {new Date(Number(task.created_at) * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* 摘要/描述（截断 4 行） */}
      {summary && (
        <div className="text-[0.7rem] leading-snug text-[var(--ui-text-tertiary)] line-clamp-4 break-words whitespace-pre-line border-t border-[var(--ui-stroke-tertiary)] pt-2">
          {summary}
        </div>
      )}

      {/* 阻塞原因 / 诊断 */}
      {task.block_reason && (
        <div className={cn('text-[0.68rem] leading-snug break-words border-t border-[var(--ui-stroke-tertiary)] pt-2')}>
          <span className="text-warning font-medium">阻塞：</span>
          <span className="text-[var(--ui-text-tertiary)]">{task.block_reason}</span>
        </div>
      )}
      {Boolean(task.diagnostics?.length) && (
        <div className="text-[0.68rem] leading-snug text-warning break-words border-t border-[var(--ui-stroke-tertiary)] pt-2">
          {task.diagnostics!.join('\n')}
        </div>
      )}

      {/* 底部 meta：评论/链接/子任务进度 */}
      {(Boolean(task.comment_count) || links > 0 || (task.child_total ?? 0) > 0) && (
        <div className="flex items-center gap-2.5 text-[0.65rem] text-[var(--ui-text-quaternary)] border-t border-[var(--ui-stroke-tertiary)] pt-1.5">
          {Boolean(task.comment_count) && <span>{task.comment_count} 评论</span>}
          {links > 0 && <span>{links} 依赖链接</span>}
          {(task.child_total ?? 0) > 0 && (
            <span className="font-mono">{task.child_done}/{task.child_total} 子任务</span>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
