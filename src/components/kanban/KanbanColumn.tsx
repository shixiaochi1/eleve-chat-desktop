/**
 * 看板列 + 任务卡片 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 */
import { memo, useState } from 'react';
import { Plus, CheckCircle2, X, Trash2, AlertTriangle, Clock, Eye, Loader, MessageSquare, GitBranch, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask, ColumnDef } from './types';
import { isBlocked, isDone, getStaleness, fmtAge, fmtDuration } from './helpers';
import { COLUMNS, LOCKED_DROP_COLUMNS } from './constants';

// ── 任务卡片（Trail 极简风格 + 删除按钮 + 右键菜单）──
const TaskCard = memo(function TaskCard({ task, onSelect, isSelected, onDragStart, checked, onCheck, justCreated, isDragging, onDelete, defaultAssignee, onMoveTo }: { task: KanbanTask; onSelect: (task: KanbanTask) => void; isSelected: boolean; onDragStart: (id: string) => void; checked: boolean; onCheck: (id: string) => void; justCreated: boolean; isDragging: boolean; onDelete?: (id: string) => void; defaultAssignee?: string; onMoveTo?: (status: string) => void }) {
  const blocked = isBlocked(task);
  const done = isDone(task);
  const running = task.status === 'running';
  const scheduled = (task.status || '').toLowerCase() === 'scheduled';
  const review = (task.status || '').toLowerCase() === 'review';
  const staleness = getStaleness(task);
  const hasProgress = (task.child_total ?? 0) > 0;
  const progressFull = hasProgress && task.child_done === task.child_total;
  // 🔴 对齐 Hermes：摘要行 = latest_summary || body（normalizeTask 已把
  //   latest_summary 并入 task.summary），展示在标题下方
  const summary = task.summary || task.body;
  // 🔴 对齐 Hermes won't-run 警告：ready + 无 assignee + 无默认负责人 → 调度器不会动它
  const wontRun = task.status === 'ready' && !task.assignee && !(defaultAssignee || '').trim();
  const links = task.link_counts ? task.link_counts.parents + task.link_counts.children : 0;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hovered, setHovered] = useState(false);
  // 🔴 对齐 Hermes ContextMenu：右键菜单（打开/选择/移动到/删除）
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const priorityLevel = task.priority ? String(task.priority).replace(/^p/i, '') : null;
  const showBar = isSelected || (priorityLevel !== null && ['0', '1', '2', '3'].includes(priorityLevel));

  // 🔴 对齐 Hermes board.tsx L276：⌘/Ctrl-点击切换选中（此前用 shift 勾选，
  //   与批量选择交互不一致）
  const handleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
      onCheck?.(task.id);
    } else {
      onSelect(task);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
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
    <>
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(task.id);
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
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
          {running && (task.startedAt || task.startTs) && (
            <span className="text-[0.65rem] tabular-nums text-success/90" title="已运行时长">
              {fmtDuration(Date.now() - (task.startedAt || task.startTs)!)}
            </span>
          )}
          {task.updated_at && <span className="tabular-nums whitespace-nowrap">{fmtAge(task.updated_at)}</span>}
          {/* 🔴 对齐 Hermes footer meta：评论数 / 依赖链接数 / 诊断警告数 */}
          <div className="ml-auto flex items-center gap-1.5 shrink-0 text-[var(--ui-text-quaternary)]">
            {Boolean(task.comment_count) && (
              <span className="inline-flex items-center gap-0.5" title={`${task.comment_count} 条评论`}>
                <MessageSquare size={10} strokeWidth={1.5} />{task.comment_count}
              </span>
            )}
            {links > 0 && (
              <span className="inline-flex items-center gap-0.5" title={`${links} 个依赖链接`}>
                <GitBranch size={10} strokeWidth={1.5} />{links}
              </span>
            )}
            {Boolean(task.diagnostics?.length) && (
              <span className="inline-flex items-center gap-0.5 text-warning" title={task.diagnostics!.join('\n')}>
                <AlertTriangle size={10} strokeWidth={1.5} />{task.diagnostics!.length}
              </span>
            )}
            <span className="font-mono text-[0.6rem] tracking-wide">
              #{typeof task.id === 'string' ? task.id.slice(0, 6) : task.id}
            </span>
          </div>
        </div>

        {/* Row 3: 摘要（latest_summary || body，对齐 Hermes） */}
        {summary && !done && (
          <div className="text-[0.68rem] leading-snug text-[var(--ui-text-tertiary)] line-clamp-2 min-w-0">
            {summary}
          </div>
        )}

        {/* won't run 警告（对齐 Hermes：ready + 无 assignee + 无默认负责人） */}
        {wontRun && (
          <div className="flex items-center gap-1 text-[0.62rem] font-medium text-warning">
            <AlertTriangle size={10} strokeWidth={1.5} className="shrink-0" />
            未分配，将不会自动运行
          </div>
        )}
      </div>
    </div>

      {/* 🔴 对齐 Hermes ContextMenu：打开/选择/移动到/删除 */}
      {menu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="fixed z-50 min-w-[150px] py-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-elevated)] shadow-lg"
            style={{ left: Math.min(menu.x, window.innerWidth - 170), top: Math.min(menu.y, window.innerHeight - 220) }}>
            <button onClick={() => { setMenu(null); onSelect(task); }}
              className="w-full text-left px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors">
              打开
            </button>
            <button onClick={() => { setMenu(null); onCheck?.(task.id); }}
              className="w-full text-left px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors">
              {checked ? '取消选择' : '选择'}
            </button>
            <div className="border-t border-[var(--ui-stroke-tertiary)] my-1" />
            {COLUMNS.filter(c => c.key !== task.status && !LOCKED_DROP_COLUMNS.includes(c.key)).map(c => (
              <button key={c.key} onClick={() => { setMenu(null); onMoveTo?.(c.key); }}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors">
                <span className="size-2 rounded-full" style={{ backgroundColor: c.dotColor }} />
                移动到 {c.label}
              </button>
            ))}
            <div className="border-t border-[var(--ui-stroke-tertiary)] my-1" />
            <button onClick={() => { setMenu(null); onDelete?.(task.id); }}
              className="w-full text-left px-3 py-1.5 text-[0.75rem] text-danger hover:bg-[color-mix(in_srgb,var(--ui-red)_12%,transparent)] transition-colors">
              删除
            </button>
          </div>
        </>
      )}
    </>
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
  /** 默认负责人（orchestration.config.default_assignee），用于 won't-run 判断 */
  defaultAssignee?: string;
  /** 🔴 对齐 Hermes：列折叠（空列自动折叠成竖轨 rail） */
  collapsed?: boolean;
  onToggle?: () => void;
}

export const KanbanColumn = memo(function KanbanColumn({ column, tasks, onSelect, selectedId, onDragStart, onDrop, creatingIn, onCreateStart, onCreateCancel, checkedIds, onCheck, runningLanes, justCreatedIds, draggingTaskId, onCreateSubmit, newTitle, setNewTitle, onDelete, defaultAssignee, collapsed = false, onToggle }: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  // 🔴 修复（对齐 Hermes LOCKED_COLUMNS）：running（调度器 claim 独占）与
  //   scheduled（需定时唤醒时间）列拒绝拖入——不 preventDefault → 操作系统
  //   显示 no-drop 光标，drop 事件永不触发，列诚实告知自身。
  const locked = LOCKED_DROP_COLUMNS.includes(column.key);

  const handleDragOver = (e: React.DragEvent) => {
    if (locked) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (locked) return;
    const taskId = e.dataTransfer.getData('text/plain'); if (taskId) onDrop(column.key, taskId);
  };

  // 🔴 对齐 Hermes rail：折叠态 = 窄竖轨（色点 + 竖排标签 + 计数），
  //   仍是活拖放目标（直接拖到 rail 上），点击展开
  if (collapsed) {
    return (
      <button
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onToggle}
        title={`展开「${column.label}」`}
        className={cn(
          'flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors shrink-0',
          'bg-[var(--ui-card-bg)] backdrop-blur-[20px]',
          dragOver && 'bg-[color-mix(in_srgb,var(--ui-card-bg)_80%,var(--ui-accent))]',
        )}
        style={{ width: 44 }}
      >
        <span className="shrink-0 rounded-full" style={{ width: 6, height: 6, backgroundColor: column.dotColor }} />
        <span className="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--ui-text-tertiary)] [writing-mode:vertical-rl]">
          {column.label}
        </span>
        {tasks.length > 0 && (
          <span className="text-[0.6rem] tabular-nums text-[var(--ui-text-quaternary)]">{tasks.length}</span>
        )}
      </button>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'group/col flex flex-col shrink-0 min-w-0 min-h-0 rounded-xl p-2 transition-colors duration-150',
        'bg-[var(--ui-card-bg)] backdrop-blur-[20px]',
        dragOver && 'bg-[color-mix(in_srgb,var(--ui-card-bg)_80%,var(--ui-accent))]',
      )}
      style={{ flex: '1 1 0%' }}
    >
      {/* 列头 — 状态小色条 + 标题 + 计数 */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="shrink-0 rounded-[var(--kanban-col-header-bar-radius)]" style={{ width: 24, height: 3, backgroundColor: column.dotColor, borderRadius: 'var(--kanban-col-header-bar-radius)' }} />
        <span className="text-[0.85rem] font-semibold text-[var(--ui-text-primary)] flex-1 tracking-[0.01em] cursor-help" title={column.emptyText}>{column.label}</span>
        <span className="text-[0.75rem] tabular-nums text-[var(--ui-text-tertiary)] font-medium">{tasks.length}</span>
        <button onClick={onToggle} title="折叠该列"
          className="grid size-5 place-items-center rounded text-[var(--ui-text-tertiary)] opacity-0 transition-opacity hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] group-hover/col:opacity-100">
          <ChevronLeft size={13} strokeWidth={1.5} />
        </button>
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
                    checked={checkedIds?.has(task.id)} onCheck={onCheck} justCreated={justCreatedIds?.has(task.id)} isDragging={draggingTaskId === task.id} onDelete={onDelete} defaultAssignee={defaultAssignee}
                      onMoveTo={(status) => onDrop(status, task.id)} />
                ))}
              </div>
            </div>);
          })
        ) : (
          tasks.map((task: KanbanTask) => (
            <TaskCard key={task.id} task={task} onSelect={onSelect} isSelected={selectedId === task.id} onDragStart={onDragStart}
              checked={checkedIds?.has(task.id)} onCheck={onCheck} justCreated={justCreatedIds?.has(task.id)} isDragging={draggingTaskId === task.id} onDelete={onDelete} defaultAssignee={defaultAssignee}
                      onMoveTo={(status) => onDrop(status, task.id)} />
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
