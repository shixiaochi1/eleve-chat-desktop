/**
 * 看板列 + 任务卡片 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 */
import { memo, useState } from 'react';
import { Plus, CheckCircle2, X, Trash2, AlertTriangle, Clock, Eye, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask, ColumnDef } from './types';
import { isBlocked, isDone, getStaleness, fmtAge } from './helpers';

// ── 任务卡片（Trail 极简风格 + 删除按钮）──
const TaskCard = memo(function TaskCard({ task, onSelect, isSelected, onDragStart, checked, onCheck, justCreated, isDragging, onDelete }: { task: KanbanTask; onSelect: (task: KanbanTask) => void; isSelected: boolean; onDragStart: (id: string) => void; checked: boolean; onCheck: (id: string) => void; justCreated: boolean; isDragging: boolean; onDelete?: (id: string) => void }) {
  const blocked = isBlocked(task);
  const done = isDone(task);
  const running = task.status === 'running';
  const scheduled = (task.status || '').toLowerCase() === 'scheduled';
  const review = (task.status || '').toLowerCase() === 'review';
  const staleness = getStaleness(task);
  const hasProgress = (task.child_total ?? 0) > 0;
  const progressFull = hasProgress && task.child_done === task.child_total;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hovered, setHovered] = useState(false);

  const priorityLevel = task.priority ? String(task.priority).replace(/^p/i, '') : null;
  const showBar = isSelected || (priorityLevel !== null && ['0', '1', '2', '3'].includes(priorityLevel));

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.stopPropagation();
      onCheck?.(task.id);
    } else {
      onSelect(task);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onDelete?.(task.id);
    setConfirmDelete(false);
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmDelete(false);
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(task.id);
      }}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDelete(false); }}
      style={showBar ? {
        borderLeftWidth: isSelected ? 3 : 2,
        borderLeftColor: isSelected ? 'var(--kanban-card-selected-bar)' : `var(--priority-${priorityLevel})`,
      } : undefined}
      className={cn(
        'relative cursor-pointer transition-all duration-150 select-none',
        'bg-[var(--kanban-card-bg)] border border-[var(--kanban-card-border)]',
        'rounded-[var(--kanban-card-radius)]',
        'shadow-sm hover:shadow-md',
        'hover:-translate-y-px',
        'active:scale-[0.995]',
        // 选中态
        isSelected && 'bg-[var(--kanban-card-selected-bg)]',
        // 陈旧度 amber
        staleness === 'amber' && !isSelected && 'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-yellow)_50%,transparent)]',
        staleness === 'amber' && !isSelected && 'hover:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--ui-yellow)_80%,transparent)]',
        // 陈旧度 red
        staleness === 'red' && !isSelected && 'shadow-[inset_0_0_0_1px_var(--ui-red),0_0_8px_color-mix(in_srgb,var(--ui-red)_30%,transparent)]',
        // done 态
        done && 'opacity-60',
        // 拖拽态
        isDragging && 'opacity-45 grayscale-[0.6]',
        // 新创建高亮
        justCreated && 'animate-[pulseHighlight_2s_ease-out] shadow-[0_0_12px_color-mix(in_srgb,var(--kanban-hover-bg)_30%,transparent)]',
      )}
    >
      {/* 优先级/选中态 左侧彩色竖条 — 通过 border-left inline style 实现 */}
      {/* 删除按钮 — hover 出现，右上角 */}
      {onDelete && (
        <div className="absolute top-1 right-1.5 z-10">
          {confirmDelete && (
            <div className="flex items-center gap-0.5 bg-[var(--kanban-card-bg)] border border-primary rounded-md px-1 py-0.5 shadow-sm">
              <span className="text-[0.65rem] text-[var(--ui-text-secondary)] mr-0.5">删除?</span>
              <button onClick={handleDeleteConfirm} className="p-0.5 rounded hover:bg-[var(--ui-red)]/15 transition-colors" title="确认删除">
                <CheckCircle2 size={12} strokeWidth={1.5} className="text-success" />
              </button>
              <button onClick={handleDeleteCancel} className="p-0.5 rounded hover:bg-[var(--ui-text-tertiary)]/15 transition-colors" title="取消">
                <X size={12} strokeWidth={1.5} className="text-[var(--ui-text-tertiary)]" />
              </button>
            </div>
          )}
          {!confirmDelete && (
            <button onClick={handleDeleteClick} className="p-1 rounded opacity-60 hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--ui-red)_12%,transparent)] transition-colors" title="删除任务">
              <Trash2 size={13} strokeWidth={1.5} className="text-[var(--ui-text-quaternary)] hover:text-[var(--ui-red)] transition-colors" />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {/* Row 1: 标题 + 进度药丸 + 阻塞警告 */}
        <div className="flex items-start gap-2">
          <div className="text-[0.85rem] font-medium leading-snug text-[var(--ui-text-primary)] break-words line-clamp-2 flex-1 min-w-0" title={task.title}>
            {task.title || '(无描述)'}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {blocked && <AlertTriangle size={12} strokeWidth={1.5} className="text-warning" />}
            {scheduled && <Clock size={12} strokeWidth={1.5} className="text-[var(--ui-cyan)]" />}
            {review && <Eye size={12} strokeWidth={1.5} className="text-[var(--ui-orange)]" />}
            {hasProgress && (
              <span className={cn(
                'font-mono text-[0.62rem] px-1.5 py-px rounded-sm',
                progressFull
                  ? 'bg-[color-mix(in_srgb,var(--ui-green)_22%,transparent)] border border-[color-mix(in_srgb,var(--ui-green)_45%,transparent)] text-[var(--ui-text-primary)]'
                  : 'bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] border border-[color-mix(in_srgb,var(--ui-stroke-tertiary)_80%,transparent)] text-[var(--ui-text-tertiary)]'
              )}>
                {task.child_done}/{task.child_total}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: 负责人 + 时间 + ID */}
        <div className="flex items-center gap-2 text-[0.7rem] text-[var(--ui-text-tertiary)] min-w-0">
          {task.assignee && <span className="font-medium truncate max-w-[100px]">{task.assignee}</span>}
          {running && <Loader size={10} strokeWidth={1.5} className="animate-spin text-success shrink-0" />}
          {task.updated_at && <span className="tabular-nums whitespace-nowrap">{fmtAge(task.updated_at)}</span>}
          <span className="font-mono text-[0.6rem] tracking-wide text-[var(--ui-text-quaternary)] ml-auto shrink-0">
            #{typeof task.id === 'string' ? task.id.slice(0, 6) : task.id}
          </span>
        </div>
      </div>
    </div>
  );
});

// ── 单列（含拖拽目标+内联创建）──
interface KanbanColumnProps {
  column: ColumnDef;
  tasks: KanbanTask[];
  onSelect: (task: KanbanTask) => void;
  selectedId: string | null | undefined;
  onDragStart: (taskId: string) => void;
  onDrop: (columnKey: string, taskId: string) => void;
  creatingIn: string | null;
  onCreateStart: (key: string) => void;
  onCreateCancel: () => void;
  checkedIds: Set<string>;
  onCheck: (id: string) => void;
  runningLanes: [string, KanbanTask[]][] | undefined;
  justCreatedIds: Set<string>;
  draggingTaskId: string | null;
  onCreateSubmit: () => void;
  newTitle: string;
  setNewTitle: (v: string) => void;
  onDelete: (taskId: string) => void;
}

export const KanbanColumn = memo(function KanbanColumn({ column, tasks, onSelect, selectedId, onDragStart, onDrop, creatingIn, onCreateStart, onCreateCancel, checkedIds, onCheck, runningLanes, justCreatedIds, draggingTaskId, onCreateSubmit, newTitle, setNewTitle, onDelete }: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const taskId = e.dataTransfer.getData('text/plain'); if (taskId) onDrop(column.key, taskId); };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col shrink-0 min-w-0 min-h-0 rounded-lg border transition-colors duration-150',
        'border-[var(--kanban-col-border)] bg-[var(--kanban-col-bg)]',
        dragOver && 'border-[var(--kanban-card-selected-bar)] border-dashed bg-[color-mix(in_srgb,var(--kanban-card-selected-bar)_5%,var(--kanban-col-bg))]',
      )}
      style={{ flex: '1 1 0%' }}
    >
      {/* 列头 — 状态小色条 + 标题 + 计数 */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="shrink-0 rounded-[var(--kanban-col-header-bar-radius)]" style={{ width: 24, height: 3, backgroundColor: column.dotColor, borderRadius: 'var(--kanban-col-header-bar-radius)' }} />
        <span className="text-[0.85rem] font-semibold text-[var(--ui-text-primary)] flex-1 tracking-[0.01em]">{column.label}</span>
        <span className="text-[0.75rem] tabular-nums text-[var(--ui-text-tertiary)] font-medium">{tasks.length}</span>
      </div>

      <div className="mx-3 border-t border-[color-mix(in_srgb,var(--ui-stroke-tertiary)_60%,transparent)]" />

      {/* 列内容 — Running 列按 assignee 分 Lane */}
      <div className="flex flex-col gap-2 p-2 overflow-y-auto flex-1 min-h-0">
        {tasks.length === 0 && creatingIn !== column.key ? (
          <div className="flex items-center justify-center py-6 px-3">
            <span className="text-[0.75rem] text-[var(--ui-text-tertiary)] border border-dashed border-[color-mix(in_srgb,var(--ui-stroke-tertiary)_70%,transparent)] rounded-md px-4 py-3">
              {column.emptyText}
            </span>
          </div>
        ) : runningLanes && runningLanes.length > 0 ? (
          // Phase 4.2: Running 列 Lane 分组
          runningLanes.map((item: [string, KanbanTask[]]) => {
            const [assignee, laneTasks] = item;
            return (<div key={assignee}>
              <div className="text-[0.65rem] font-mono font-semibold tracking-wide text-[var(--ui-text-tertiary)] px-1 py-1.5 border-b border-dashed border-[color-mix(in_srgb,var(--ui-stroke-tertiary)_60%,transparent)]">
                {assignee} ({laneTasks.length})
              </div>
              <div className="flex flex-col gap-2 mt-1">
                {(laneTasks).map((task: KanbanTask) => (
                  <TaskCard key={task.id} task={task} onSelect={onSelect} isSelected={selectedId === task.id} onDragStart={onDragStart}
                    checked={checkedIds?.has(task.id)} onCheck={onCheck} justCreated={justCreatedIds?.has(task.id)} isDragging={draggingTaskId === task.id} onDelete={onDelete} />
                ))}
              </div>
            </div>);
          })
        ) : (
          tasks.map((task: KanbanTask) => (
            <TaskCard key={task.id} task={task} onSelect={onSelect} isSelected={selectedId === task.id} onDragStart={onDragStart}
              checked={checkedIds?.has(task.id)} onCheck={onCheck} justCreated={justCreatedIds?.has(task.id)} isDragging={draggingTaskId === task.id} onDelete={onDelete} />
          ))
        )}
      </div>

      {/* 列底部 — 行内快速创建 / + 添加按钮（仅可创建列显示） */}
      {column.canCreate && (
        <div className="shrink-0 px-2 pb-2">
          {creatingIn === column.key ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={newTitle || ''}
                onChange={(e) => setNewTitle?.(e.target.value)}
                placeholder="任务标题，回车创建…"
                className="flex-1 text-[0.8rem] px-2.5 py-1.5 rounded-md border border-[var(--kanban-card-selected-bar)] bg-[var(--kanban-card-bg)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none"
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) { e.preventDefault(); onCreateSubmit?.(); }
                  if (e.key === 'Escape') onCreateCancel();
                }}
              />
            </div>
          ) : (
            <button
              onClick={() => onCreateStart(column.key)}
              className="w-full flex items-center gap-1.5 text-[0.75rem] text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] px-2 py-1.5 rounded-md hover:bg-[color-mix(in_srgb,var(--ui-base)_6%,transparent)] transition-colors"
            >
              <Plus size={13} strokeWidth={1.5} />
              添加任务
            </button>
          )}
        </div>
      )}
    </div>
  );
});
