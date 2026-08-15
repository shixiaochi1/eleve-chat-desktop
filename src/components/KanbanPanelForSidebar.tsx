/**
 * KanbanPanelForSidebar — 侧边栏看板包装组件
 *
 * 在 SidePanel 中渲染，调用 useKanban 获取数据，传给 SidebarKanbanBoard；
 * 新建任务 / 派发任务 复用与主看板相同的共享组件（CreateTaskDrawer overlay
 * 变体 + DispatchModal），字段能力与主看板完全对齐。
 */
import SidebarKanbanBoard from './SidebarKanbanBoard';
import { useKanban } from './kanban/useKanban';
import type { KanbanTask } from './kanban/types';
import { TaskDrawer } from './kanban/TaskDrawer';
import { CreateBoardModal } from './kanban/CreateBoardModal';
import { CreateTaskDrawer } from './kanban/CreateTaskDrawer';
import { DispatchModal } from './kanban/DispatchModal';

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
    allTasks,
    newTitle,
    setNewTitle,
    newBody,
    setNewBody,
    newAssignee,
    setNewAssignee,
    newPriority,
    setNewPriority,
    newSkills,
    setNewSkills,
    newParent,
    setNewParent,
    newGoalMode,
    setNewGoalMode,
    newGoalMaxTurns,
    setNewGoalMaxTurns,
    newWorkspaceKind,
    setNewWorkspaceKind,
    newWorkspacePath,
    setNewWorkspacePath,
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
    showDispatch,
    setShowDispatch,
  } = useKanban({ board: 'default' });

  const handleSelectTask = (task: KanbanTask) => {
    setSelectedTask(task);
  };

  const handleCreateTask = (status: string) => {
    setCreatingIn(status);
  };

  const handleRefresh = () => {
    loadBoard();
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
        onDispatch={() => setShowDispatch(true)}
      />

      {/* 创建任务 — 与主看板共享 CreateTaskDrawer（overlay 变体，全量字段） */}
      <CreateTaskDrawer
        open={Boolean(creatingIn)} target={creatingIn || 'triage'} variant="overlay"
        title={newTitle} body={newBody} assignee={newAssignee} priority={newPriority}
        skills={newSkills} parent={newParent} goalMode={newGoalMode} goalMaxTurns={newGoalMaxTurns}
        workspaceKind={newWorkspaceKind} workspacePath={newWorkspacePath}
        parentOptions={allTasks.filter(t => t.id && t.status !== 'running').slice(0, 30).map(t => ({ id: t.id, title: t.title }))}
        onTitleChange={setNewTitle} onBodyChange={setNewBody} onAssigneeChange={setNewAssignee}
        onPriorityChange={setNewPriority} onSkillsChange={setNewSkills} onParentChange={setNewParent}
        onGoalModeChange={setNewGoalMode} onGoalMaxTurnsChange={setNewGoalMaxTurns}
        onWorkspaceKindChange={setNewWorkspaceKind} onWorkspacePathChange={setNewWorkspacePath}
        onSubmit={() => handleCreateSubmit()}
        onClose={() => { setCreatingIn(null); resetCreateForm(); }}
      />

      {/* 手动调度 — 与主看板共享 DispatchModal */}
      <DispatchModal open={showDispatch} board={currentBoard} onClose={() => setShowDispatch(false)} onDispatched={loadBoard} />

      {/* 详情抽屉 — 点卡片打开查看/操作 */}
      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} onAction={handleAction} loadingId={loadingId}
          onRefresh={loadBoard} onViewLog={handleViewLog} workerLog={workerLog} homeChannels={homeChannels} board={currentBoard} />
      )}

      {/* 新建看板模态 — 与主面板共享 CreateBoardModal */}
      <CreateBoardModal open={showCreateBoard} name={newBoardName} desc={newBoardDesc} color={newBoardColor}
        busy={creatingBoard} onClose={() => setShowCreateBoard(false)} onCreate={handleCreateBoard}
        onNameChange={setNewBoardName} onDescChange={setNewBoardDesc} onColorChange={setNewBoardColor} />
    </div>
  );
}
