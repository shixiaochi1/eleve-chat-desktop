/**
 * SidebarKanbanBoard — 侧边栏看板布局（8 排横向滚动）
 *
 * 设计原则：
 * - 主操作（新建任务）突出显示
 * - 次操作（刷新/归档/派发）收起或弱化
 * - 留白呼吸感
 * - 视觉层次分明
 */
import React, { useState } from 'react';
import {
  Plus,
  RefreshCw,
  ChevronDown,
  Loader,
  MoreHorizontal,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask, ColumnDef } from './kanban/types';
import { COLUMNS } from './kanban/constants';

// ── 侧边栏任务卡片（紧凑版，参考项目卡片样式）──
function SidebarTaskCard({ task, onClick }: { task: KanbanTask; onClick: () => void }) {
  const hasProgress = (task.child_total ?? 0) > 0;

  return (
    <div
      onClick={onClick}
      className="shrink-0 w-44 p-2.5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-elevated)] cursor-pointer hover:border-[var(--ui-accent)] hover:shadow-sm transition-all flex flex-col gap-1"
    >
      <div className="text-[0.75rem] font-medium text-[var(--ui-text-primary)] line-clamp-2 leading-snug">
        {task.title || '(无标题)'}
      </div>
      <div className="flex items-center gap-1.5 text-[0.65rem] text-[var(--ui-text-tertiary)] mt-auto">
        {task.assignee && <span className="truncate max-w-[80px]">{task.assignee}</span>}
        {hasProgress && (
          <span className="ml-auto font-mono text-[var(--ui-accent)]">
            {task.child_done}/{task.child_total}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 空状态卡片（虚线框，无内容）──
function EmptyTaskCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex-1 min-w-[176px] p-2.5 rounded-lg border border-dashed border-[var(--ui-accent)] bg-transparent flex flex-col gap-1 cursor-pointer hover:bg-[var(--ui-bg-quinary)] transition-colors"
      style={{ minHeight: '5rem' }}
    />
  );
}

// ── 侧边栏状态排 ──
function SidebarKanbanRow({
  column,
  tasks,
  onSelectTask,
  onCreateTask,
}: {
  column: ColumnDef;
  tasks: KanbanTask[];
  onSelectTask: (task: KanbanTask) => void;
  onCreateTask: () => void;
}) {
  return (
    <div className="flex flex-col shrink-0 py-2">
      {/* 状态标题 */}
      <div className="flex items-center gap-2 px-4 py-1">
        <span
          className="shrink-0 rounded-full"
          style={{ width: 6, height: 6, backgroundColor: column.dotColor }}
        />
        <span className="text-[0.7rem] font-semibold text-[var(--ui-text-secondary)] uppercase tracking-wide">
          {column.label}
        </span>
        <span className="text-[0.65rem] tabular-nums text-[var(--ui-text-quaternary)]">
          {tasks.length}
        </span>
      </div>

      {/* 任务卡片横向滚动 */}
      <div className="flex gap-2 px-3 overflow-x-auto scrollbar-thin">
        {tasks.map(task => (
          <SidebarTaskCard key={task.id} task={task} onClick={() => onSelectTask(task)} />
        ))}
        {/* 仅可创建列显示虚线占位（🔴 修复：running/scheduled/blocked/done/
            archived 列后端无法直接落位创建，此前点了会弹出表单但卡片落在 ready） */}
        {column.canCreate && <EmptyTaskCard onClick={onCreateTask} />}
      </div>
    </div>
  );
}

// ── 更多操作菜单（🔴 修复：原「显示归档」开关无数据源——后端 board 接口
//   不返回 archived 列（include_archived 无对应实现），开关点了无任何效果，
//   移除死控制，仅保留刷新）──
function MoreMenu({ onRefresh }: { onRefresh: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'p-1.5 rounded-md transition-colors',
          open ? 'bg-[var(--ui-bg-quinary)] text-[var(--ui-text-primary)]' : 'text-[var(--ui-text-tertiary)] hover:bg-[var(--ui-bg-quinary)] hover:text-[var(--ui-text-secondary)]'
        )}
        title="更多操作"
      >
        <MoreHorizontal size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 min-w-[120px] py-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-elevated)] shadow-lg z-50">
            <button
              onClick={() => { onRefresh(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors"
            >
              <RefreshCw size={12} strokeWidth={1.5} />
              刷新
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 侧边栏看板主组件 ──
export default function SidebarKanbanBoard({
  currentBoard,
  boards,
  grouped,
  loading,
  onSelectTask,
  onCreateTask,
  onSwitchBoard,
  onShowCreateBoard,
  onRefresh,
  onDispatch,
}: {
  currentBoard: string;
  boards: Array<{ slug: string; name: string }>;
  grouped: Record<string, KanbanTask[]>;
  loading: boolean;
  onSelectTask: (task: KanbanTask) => void;
  onCreateTask: (status: string) => void;
  onSwitchBoard: (slug: string) => void;
  onShowCreateBoard: () => void;
  onRefresh: () => void;
  /** 手动调度（打开共享 DispatchModal） */
  onDispatch: () => void;
}) {
  const [showBoardPicker, setShowBoardPicker] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏 — 设计感布局 */}
      <div className="flex items-center px-4 py-3 shrink-0 border-b border-[var(--ui-stroke-tertiary)]">
        {/* 左侧：看板选择器 */}
        <div className="relative flex-1 min-w-0">
          <button
            onClick={() => setShowBoardPicker(v => !v)}
            className="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold text-[var(--ui-text-primary)] hover:text-[var(--ui-accent)] transition-colors"
          >
            <span className="truncate max-w-[120px]">
              {currentBoard === 'default' ? '看板' : currentBoard}
            </span>
            <ChevronDown size={12} strokeWidth={2} className={cn('transition-transform', showBoardPicker && 'rotate-180')} />
          </button>
          {showBoardPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowBoardPicker(false)} />
              <div className="absolute top-full left-0 mt-1 min-w-[160px] py-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-elevated)] shadow-lg z-50">
                {boards.map(b => (
                  <button
                    key={b.slug}
                    onClick={() => { onSwitchBoard(b.slug); setShowBoardPicker(false); }}
                    className={cn(
                      'w-full text-left text-[0.75rem] px-3 py-1.5 hover:bg-[var(--ui-bg-quinary)] transition-colors',
                      b.slug === currentBoard && 'font-semibold text-[var(--ui-accent)]'
                    )}
                  >
                    {b.name || b.slug}
                  </button>
                ))}
                <div className="border-t border-[var(--ui-stroke-tertiary)] mt-1 pt-1">
                  <button
                    onClick={() => { setShowBoardPicker(false); onShowCreateBoard(); }}
                    className="w-full text-left text-[0.75rem] px-3 py-1.5 text-[var(--ui-text-tertiary)] hover:bg-[var(--ui-bg-quinary)] hover:text-[var(--ui-accent)] transition-colors flex items-center gap-1.5"
                  >
                    <Plus size={12} strokeWidth={1.5} /> 新建看板
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 右侧：派发 + 更多 + 主操作（新建）——派发打开共享 DispatchModal，
            上轮因无弹窗移除，现补弹窗后恢复入口 */}
        <div className="flex items-center gap-1.5">
          {loading && <Loader size={12} strokeWidth={1.5} className="animate-spin text-[var(--ui-text-quaternary)]" />}
          <button
            onClick={onDispatch}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[var(--ui-text-tertiary)] hover:bg-[var(--ui-bg-quinary)] hover:text-[var(--ui-text-secondary)] transition-colors text-[0.7rem]"
            title="手动调度"
          >
            <Zap size={12} strokeWidth={1.5} />
            派发
          </button>
          <MoreMenu onRefresh={onRefresh} />
          <button
            onClick={() => onCreateTask('triage')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[var(--ui-accent)] text-white text-[0.7rem] font-medium hover:opacity-90 transition-opacity shadow-sm"
            title="新建任务"
          >
            <Plus size={12} strokeWidth={2} />
            新建
          </button>
        </div>
      </div>

      {/* 8 排状态 */}
      <div className="flex-1 overflow-y-auto">
        {COLUMNS.map(col => (
          <SidebarKanbanRow
            key={col.key}
            column={col}
            tasks={grouped[col.key] || []}
            onSelectTask={onSelectTask}
            onCreateTask={() => onCreateTask(col.key)}
          />
        ))}
      </div>
    </div>
  );
}
