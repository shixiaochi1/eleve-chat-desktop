/**
 * KanbanPanelForSidebar — 侧边栏看板包装组件
 *
 * 在 SidePanel 中渲染，调用 useKanban 获取数据，传给 SidebarKanbanBoard
 */
import { useState } from 'react';
import { X, Loader } from 'lucide-react';
import SidebarKanbanBoard from './SidebarKanbanBoard';
import { useKanban } from './kanban/useKanban';
import { COLUMNS } from './kanban/constants';
import type { KanbanTask } from './kanban/types';
import { TaskDrawer } from './kanban/TaskDrawer';
import { CreateBoardModal } from './kanban/CreateBoardModal';

export default function KanbanPanelForSidebar() {
  const {
    currentBoard,
    boards,
    grouped,
    loading,
    selectedTask,
    setSelectedTask,
    creatingIn,
    setCreatingIn,
    newTitle,
    setNewTitle,
    newBody,
    setNewBody,
    newAssignee,
    setNewAssignee,
    newPriority,
    setNewPriority,
    handleCreateSubmit,
    resetCreateForm,
    handleSwitchBoard,
    showCreateBoard,
    setShowCreateBoard,
    newBoardName,
    setNewBoardName,
    newBoardDesc,
    setNewBoardDesc,
    newBoardColor,
    setNewBoardColor,
    creatingBoard,
    handleCreateBoard,
    loadBoard,
    loadingId,
    handleAction,
    handleViewLog,
    workerLog,
    homeChannels,
  } = useKanban({ board: 'default' });

  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleSelectTask = (task: KanbanTask) => {
    setSelectedTask(task);
  };

  const handleCreateTask = (status: string) => {
    setCreatingIn(status);
    setCreateError(null);
  };

  const handleRefresh = () => {
    loadBoard();
  };

  const doCreate = async () => {
    if (!newTitle.trim()) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      await handleCreateSubmit();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative h-full flex flex-col">
      <SidebarKanbanBoard
        currentBoard={currentBoard}
        boards={boards}
        grouped={grouped}
        loading={loading}
        onSelectTask={handleSelectTask}
        onCreateTask={handleCreateTask}
        onSwitchBoard={handleSwitchBoard}
        onShowCreateBoard={() => setShowCreateBoard(true)}
        onRefresh={handleRefresh}
      />

      {/* 创建任务表单 */}
      {creatingIn && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--ui-bg-elevated)] border border-[var(--ui-stroke-tertiary)] rounded-lg overflow-hidden">
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ui-stroke-tertiary)]">
            <h3 className="text-[0.85rem] font-semibold text-[var(--ui-text-primary)]">
              新建任务 → {COLUMNS.find(c => c.key === creatingIn)?.label || creatingIn}
            </h3>
            <button
              onClick={() => { setCreatingIn(null); resetCreateForm(); setCreateError(null); }}
              className="p-1 rounded hover:bg-[var(--ui-bg-quinary)] transition-colors"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>

          {/* 表单 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {/* 标题 */}
            <div className="flex flex-col gap-1">
              <label className="text-[0.75rem] font-medium text-[var(--ui-text-secondary)]">标题 *</label>
              <textarea
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    doCreate();
                  }
                  if (e.key === 'Escape') {
                    setCreatingIn(null);
                    resetCreateForm();
                    setCreateError(null);
                  }
                }}
                placeholder={creatingIn === 'triage' ? '粗略想法 — AI 将细化...' : '任务标题'}
                rows={2}
                className="w-full text-[0.8rem] px-3 py-2 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-primary)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] resize-none focus:outline-none focus:border-[var(--ui-accent)]"
              />
            </div>

            {/* 描述 */}
            <div className="flex flex-col gap-1">
              <label className="text-[0.75rem] font-medium text-[var(--ui-text-secondary)]">详细描述</label>
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="描述任务的目标、范围、验收标准..."
                rows={3}
                className="w-full text-[0.8rem] px-3 py-2 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-primary)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] resize-none focus:outline-none focus:border-[var(--ui-accent)]"
              />
            </div>

            {/* 负责人 + 优先级 */}
            <div className="flex gap-3">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[0.75rem] font-medium text-[var(--ui-text-secondary)]">
                  {creatingIn === 'triage' ? 'Specifier' : 'Assignee'}
                </label>
                <input
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  placeholder="留空自动分配"
                  className="w-full text-[0.8rem] h-8 px-3 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-primary)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
              </div>
              <div className="w-20 flex flex-col gap-1">
                <label className="text-[0.75rem] font-medium text-[var(--ui-text-secondary)]">优先级</label>
                <input
                  type="number"
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  placeholder="0"
                  className="w-full text-[0.8rem] h-8 px-3 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-primary)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--ui-accent)]"
                />
              </div>
            </div>

            {/* 错误提示 */}
            {createError && (
              <div className="text-[0.75rem] text-[var(--ui-red)] px-1">
                创建失败: {createError}
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="px-4 py-3 border-t border-[var(--ui-stroke-tertiary)] flex gap-2">
            <button
              onClick={doCreate}
              disabled={!newTitle.trim() || submitting}
              className="flex-1 h-8 rounded-md bg-[var(--ui-accent)] text-white text-[0.8rem] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              title={!newTitle.trim() ? '请先输入标题' : undefined}
            >
              {submitting && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
              {!newTitle.trim() ? '请输入标题' : '创建任务'}
            </button>
            <button
              onClick={() => { setCreatingIn(null); resetCreateForm(); setCreateError(null); }}
              className="h-8 px-3 rounded-md border border-[var(--ui-stroke-tertiary)] text-[0.8rem] text-[var(--ui-text-tertiary)] hover:bg-[var(--ui-bg-quinary)] transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 详情抽屉 — 🔴 修复：侧边栏点卡片此前只 setSelectedTask 无任何呈现
          （死交互），补上 TaskDrawer 让卡片可打开查看/操作 */}
      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} onAction={handleAction} loadingId={loadingId}
          onRefresh={loadBoard} onViewLog={handleViewLog} workerLog={workerLog} homeChannels={homeChannels} board={currentBoard} />
      )}

      {/* 新建看板模态 — 🔴 修复：此前 setShowCreateBoard(true) 无弹窗（死交互），
          复用与主面板相同的 CreateBoardModal */}
      <CreateBoardModal open={showCreateBoard} name={newBoardName} desc={newBoardDesc} color={newBoardColor}
        busy={creatingBoard} onClose={() => setShowCreateBoard(false)} onCreate={handleCreateBoard}
        onNameChange={setNewBoardName} onDescChange={setNewBoardDesc} onColorChange={setNewBoardColor} />
    </div>
  );
}
