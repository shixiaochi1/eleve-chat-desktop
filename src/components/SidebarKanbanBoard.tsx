/**
 * SidebarKanbanBoard — 侧边栏看板布局（9 排垂直堆叠，每排固定高度实线框）
 *
 * 设计原则：
 * - 每排一个实线框容器（边框走主题 --ui-stroke-tertiary）：框即排的边界，
 *   一眼区分 9 个状态排的作用
 * - 每排框固定高度 h-[82px]，卡片高度填满卡片区（h-full）：卡片与线框相对高度
 *   固定，不随卡片内容伸缩，拖拽换排线框不跳变；卡片横向排布（w-[72px] 小卡），
 *   超出裁剪，排内不出现滚动条
 * - 排间缝隙 6px（py-[3px]）；线框高度以默认主窗体（1440×900）反推：默认尺寸下
 *   9 排全部显示无滚动条，窗体缩小低于 9 排总高时看板区域出现整体竖向滚动条
 * - 新建任务统一走顶栏「新建」按钮（CreateTaskDrawer），排内不提供新建入口
 * - 卡片可拖拽：HTML5 DnD 跨排换状态，门控与主看板一致
 *   （LOCKED_DROP_COLUMNS：running/scheduled 锁定不可拖入）
 * - 卡片立体：多层背投影 + accent 主题渐变 + hover 上浮
 */
import React, { useState } from 'react';
import {
  Plus,
  ChevronDown,
  Loader,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KanbanTask, ColumnDef } from './kanban/types';
import { COLUMNS, LOCKED_DROP_COLUMNS } from './kanban/constants';
// 🔴 2026-08-16：卡片 hover 状态浮层（侧边栏 72px 小卡看不清内容与状态）
import { useTaskHover } from './kanban/TaskHoverCard';

// 新建任务高亮动画（独立注入，不依赖主看板 KanbanPanel 的 <style>）
const SB_PULSE_CSS = `
@keyframes sbPulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent) 45%, transparent); } 50% { box-shadow: 0 0 10px 2px color-mix(in srgb, var(--ui-accent) 22%, transparent); } 100% { box-shadow: none; } }
`;

// 主按钮样式 — 与 AGENT 面板（ProfilePanel「新建 Agent」/ ProjectTreePanel
// 「新建项目」）完全同款：胶囊 + primary 渐变 + 内高光/外投影 + hover 上浮
const PRIMARY_BTN_CLS =
  'inline-flex items-center gap-1.5 pl-1 pr-2.5 h-[22px] rounded-full text-[11px] leading-normal font-semibold transition-all duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.12),0_3px_8px_var(--theme-shadow-color)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.16),0_6px_16px_var(--theme-shadow-color-heavy)] hover:brightness-[1.06] hover:-translate-y-[1.5px] shrink-0';

// ── 侧边栏任务卡片（紧凑版，可拖拽；单击选中 / 双击打开抽屉）──
function SidebarTaskCard({
  task,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragEnd,
  isDragging,
  justCreated,
  isSelected,
}: {
  task: KanbanTask;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  justCreated: boolean;
  isSelected: boolean;
}) {
  const hasProgress = (task.child_total ?? 0) > 0;
  // 🔴 2026-08-16：hover 状态浮层（200ms 延迟防抖动，portal 到 body）
  const { hoverEl, hoverHandlers } = useTaskHover(task);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={hoverHandlers.onMouseEnter}
      onMouseMove={hoverHandlers.onMouseMove}
      onMouseLeave={hoverHandlers.onMouseLeave}
      style={{
        // 主题色渐变背景：顶部 accent 微光 → 卡片底色（立体层次，accent 加强）；
        // 选中态 accent 浓度更高（可见的选中反馈）
        background: isSelected
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--ui-accent) 24%, transparent) 0%, color-mix(in srgb, var(--ui-accent) 8%, transparent) 60%, transparent 100%), var(--ui-bg-elevated)'
          : 'linear-gradient(180deg, color-mix(in srgb, var(--ui-accent) 14%, transparent) 0%, color-mix(in srgb, var(--ui-accent) 3%, transparent) 55%, transparent 100%), var(--ui-bg-elevated)',
      }}
      className={cn(
        // h-full：卡片高度填满卡片区 → 与线框相对高度固定（不随内容伸缩）
        'relative shrink-0 w-[72px] h-full self-start p-1 rounded-lg border cursor-pointer transition-all duration-150 flex flex-col gap-0.5 select-none min-h-0',
        // 背投影：外阴影双层（贴地 + 弥散）+ 顶部内高光（立体）
        'shadow-[0_1px_2px_var(--ui-card-shadow-outer),0_8px_18px_-8px_var(--ui-card-shadow-outer),inset_0_1px_0_var(--ui-card-highlight)]',
        // 常态：细主题色描边（淡 accent）；hover 描边稍亮但保持淡；
        // 选中：60% 淡 accent（不刺眼）；新建高亮：全亮 accent（2s 脉冲后恢复）
        justCreated
          ? 'border-[var(--ui-accent)]'
          : isSelected
            ? 'border-[color-mix(in_srgb,var(--ui-accent)_60%,transparent)]'
            : 'border-[color-mix(in_srgb,var(--ui-accent)_28%,transparent)] hover:border-[color-mix(in_srgb,var(--ui-accent)_45%,transparent)]',
        'hover:-translate-y-px hover:shadow-[0_2px_4px_var(--ui-card-shadow-outer),0_14px_26px_-10px_var(--ui-card-shadow-outer),inset_0_1px_0_var(--ui-card-highlight)]',
        // 拖起态：半透明 + 灰化 + 轻微缩小（"被提起"感），transform 不影响线框布局
        isDragging && 'opacity-40 grayscale-[0.6] scale-[0.96] shadow-none',
        justCreated && 'animate-[sbPulse_2s_ease-out]',
      )}
    >
      <div className="text-[0.7rem] font-medium text-[var(--ui-text-primary)] line-clamp-1 leading-snug">
        {task.title || '(无标题)'}
      </div>
      <div className="flex items-center gap-1 text-[0.6rem] text-[var(--ui-text-tertiary)] mt-auto min-h-0">
        {task.assignee && <span className="truncate max-w-[44px]">{task.assignee}</span>}
        {hasProgress && (
          <span className="ml-auto font-mono text-[var(--ui-accent)]">
            {task.child_done}/{task.child_total}
          </span>
        )}
      </div>
      {/* 🔴 2026-08-16：hover 状态浮层（portal 到 body） */}
      {hoverEl}
    </div>
  );
}

// ── 侧边栏状态排（实线框容器 + 拖放目标）──
function SidebarKanbanRow({
  column,
  tasks,
  onSelectTask,
  onSelectCard,
  selectedTaskId,
  onDrop,
  onDragStart,
  onDragEnd,
  draggingTaskId,
  justCreatedIds,
}: {
  column: ColumnDef;
  tasks: KanbanTask[];
  /** 双击卡片 → 打开任务抽屉 */
  onSelectTask: (task: KanbanTask) => void;
  /** 单击卡片 → 选中（高亮） */
  onSelectCard: (taskId: string) => void;
  selectedTaskId: string | null;
  onDrop: (columnKey: string, taskId: string) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  draggingTaskId: string | null;
  justCreatedIds?: Set<string>;
}) {
  const [dragOver, setDragOver] = useState(false);
  // running（调度器 claim 独占）与 scheduled（需定时唤醒时间）列拒绝拖入：
  // 不 preventDefault → 系统显示 no-drop 光标，drop 永不触发（对齐主看板门控）
  const locked = LOCKED_DROP_COLUMNS.includes(column.key);

  const handleDragOver = (e: React.DragEvent) => {
    if (locked) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (locked) return;
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onDrop(column.key, taskId);
  };

  return (
    <div className="shrink-0 px-3 py-[3px]">
      {/* 排容器框 = 排的边界（实线，主题色） */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          // 固定高度 h-[82px]：以默认主窗体 1440×900 反推——可用 900−32(titlebar)−15(statusbar)=853px，
          // 看板顶栏 ~48px → 9 排可用 805px；排间缝隙 6px → 9×(82+6)=792 ≤ 805，
          // 默认主窗体下 9 排全部显示无滚动条，窗体再缩小才出现整体竖向滚动条。
          // 卡片高度 = 82−排头−内边距 ≈ 50px，保持可见（不随卡片内容伸缩）。
          'rounded-xl border border-solid h-[82px] flex flex-col transition-colors duration-150',
          // 淡淡的投影（主题阴影色），让排框有轻微悬浮层次
          'shadow-[0_1px_2px_var(--ui-card-shadow-inner)]',
          dragOver
            ? 'border-[color-mix(in_srgb,var(--ui-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--ui-accent)_6%,transparent)]'
            : 'border-[var(--ui-stroke-tertiary)] bg-[color-mix(in_srgb,var(--ui-bg-elevated)_30%,transparent)]',
        )}
      >
        {/* 排头 — 色点 + 标签 + 计数（新建走顶栏「新建」按钮，排内不提供） */}
        <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 shrink-0">
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

        {/* 卡片区 — 横向排布，卡片高度填满（相对线框固定）；超出裁剪，不出现滚动条 */}
        <div className="flex-1 min-h-0 flex items-stretch gap-1 p-1 overflow-hidden">
          {tasks.map(task => (
            <SidebarTaskCard
              key={task.id}
              task={task}
              onClick={(e) => { e.stopPropagation(); onSelectCard(task.id); }}
              onDoubleClick={() => onSelectTask(task)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              isDragging={draggingTaskId === task.id}
              justCreated={justCreatedIds?.has(task.id) ?? false}
              isSelected={selectedTaskId === task.id}
            />
          ))}
        </div>
      </div>
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
  onDispatch,
  onDrop,
  onDragStart,
  onDragEnd,
  draggingTaskId,
  justCreatedIds,
}: {
  currentBoard: string;
  boards: Array<{ slug: string; name: string }>;
  grouped: Record<string, KanbanTask[]>;
  loading: boolean;
  onSelectTask: (task: KanbanTask) => void;
  onCreateTask: (status: string) => void;
  onSwitchBoard: (slug: string) => void;
  onShowCreateBoard: () => void;
  /** 手动调度（打开共享 DispatchModal） */
  onDispatch: () => void;
  /** 拖拽落位（useKanban.handleDrop：门控 + 确认 + 乐观更新） */
  onDrop: (columnKey: string, taskId: string) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  draggingTaskId: string | null;
  justCreatedIds?: Set<string>;
}) {
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  // 单击选中的卡片 id（双击才打开抽屉；选中态=卡片高亮）
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full">
      {/* 高亮动画 keyframes（组件级注入） */}
      <style>{SB_PULSE_CSS}</style>

      {/* 顶栏 */}
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

        {/* 右侧：派发 + 新建（与 AGENT 面板按钮同款胶囊主按钮） */}
        <div className="flex items-center gap-1.5">
          {loading && <Loader size={12} strokeWidth={1.5} className="animate-spin text-[var(--ui-text-quaternary)]" />}
          <button
            onClick={onDispatch}
            className={PRIMARY_BTN_CLS}
            title="手动调度"
          >
            <Zap size={12} strokeWidth={2.5} className="shrink-0" />
            派发
          </button>
          <button
            onClick={() => onCreateTask('triage')}
            className={PRIMARY_BTN_CLS}
            title="新建任务"
          >
            <Plus size={12} strokeWidth={2.5} className="shrink-0" />
            新建
          </button>
        </div>
      </div>

      {/* 9 排状态（每排实线框：高度随卡片内容自适应 + 最小高度兜底；
          容器高度不足时本区出现滚动条）——点击空白处取消卡片选中 */}
      <div className="flex-1 overflow-y-auto py-1" onClick={() => setSelectedTaskId(null)}>
        {COLUMNS.map(col => (
          <SidebarKanbanRow
            key={col.key}
            column={col}
            tasks={grouped[col.key] || []}
            onSelectTask={onSelectTask}
            onSelectCard={(taskId) => setSelectedTaskId(taskId)}
            selectedTaskId={selectedTaskId}
            onDrop={onDrop}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            draggingTaskId={draggingTaskId}
            justCreatedIds={justCreatedIds}
          />
        ))}
      </div>
    </div>
  );
}
