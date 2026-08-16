/**
 * KanbanPanelForSidebar — 侧边栏看板包装组件
 *
 * 在 SidePanel 中渲染，调用 useKanban 获取数据，传给 SidebarKanbanBoard；
 * 新建任务 / 派发任务 复用与主看板相同的共享组件（CreateTaskDrawer overlay
 * 变体 + DispatchModal），字段能力与主看板完全对齐。
 */
import { useMemo } from 'react';
import SidebarKanbanBoard from './SidebarKanbanBoard';
import { useKanban } from './kanban/useKanban';
import type { KanbanTask } from './kanban/types';
import { TaskDrawer } from './kanban/TaskDrawer';
import { CreateBoardModal } from './kanban/CreateBoardModal';
import { CreateTaskDrawer } from './kanban/CreateTaskDrawer';
import { buildModelCatalog } from './kanban/ModelCatalogMenu';
import { DispatchModal } from './kanban/DispatchModal';
import { KanbanReviewDialogs } from './kanban/KanbanReviewDialogs';

export default function KanbanPanelForSidebar() {
  const {
    currentBoard,
    boards,
    grouped,
    loading,
    boardMeta,
    resolvedDefaultAssignee,
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
    newModelOverride,
    setNewModelOverride,
    newProviderOverride,
    setNewProviderOverride,
    newReasoningEffort,
    setNewReasoningEffort,
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
    newBoardProject,
    setNewBoardProject,
    creatingBoard,
    handleCreateBoard,
    loadBoard,
    loadingId,
    handleAction,
    homeChannels,
    showDispatch,
    setShowDispatch,
    handleDrop,
    draggingTaskId,
    setDraggingTaskId,
    justCreatedIds,
    profiles,
    pendingForceReview,
    pendingChanges,
    reviewBusy,
    confirmForceReview,
    cancelForceReview,
    submitChanges,
    cancelChanges,
    boardProjectList,
  } = useKanban({ board: 'default' });

  // 🔴 2026-08-16：ModelCatalogMenu 数据源（profiles 派生 model→provider 目录）
  const modelCatalog = useMemo(() => buildModelCatalog(profiles || []), [profiles]);

  const handleSelectTask = (task: KanbanTask) => {
    setSelectedTask(task);
  };

  const handleCreateTask = (status: string) => {
    setCreatingIn(status);
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
        onDispatch={() => setShowDispatch(true)}
        onDrop={handleDrop}
        onDragStart={(taskId) => setDraggingTaskId(taskId)}
        onDragEnd={() => setDraggingTaskId(null)}
        draggingTaskId={draggingTaskId}
        justCreatedIds={justCreatedIds}
      />

      {/* 创建任务 — 与主看板共享 CreateTaskDrawer（overlay 变体，全量字段） */}
      <CreateTaskDrawer
        open={Boolean(creatingIn)} target={creatingIn || 'triage'} variant="overlay"
        title={newTitle} body={newBody} assignee={newAssignee} priority={newPriority}
        skills={newSkills} parent={newParent} goalMode={newGoalMode} goalMaxTurns={newGoalMaxTurns}
        workspaceKind={newWorkspaceKind} workspacePath={newWorkspacePath} modelOverride={newModelOverride}
        providerOverride={newProviderOverride} reasoningEffort={newReasoningEffort}
        assigneeOptions={(profiles || []).map((p: any) => ({ name: p.name }))}
        catalog={modelCatalog}
        boardDefaultKind={boardMeta?.default_workspace_kind}
        boardDefaultDir={boardMeta?.default_workdir}
        defaultAssignee={resolvedDefaultAssignee}
        // 🔴 对齐 Hermes 父任务候选 = 全板任务（审查 d3-21）：去掉 30 条截断
        parentOptions={allTasks.filter(t => t.id && t.status !== 'running').map(t => ({ id: t.id, title: t.title }))}
        onTitleChange={setNewTitle} onBodyChange={setNewBody} onAssigneeChange={setNewAssignee}
        onPriorityChange={setNewPriority} onSkillsChange={setNewSkills} onParentChange={setNewParent}
        onGoalModeChange={setNewGoalMode} onGoalMaxTurnsChange={setNewGoalMaxTurns}
        onWorkspaceKindChange={setNewWorkspaceKind} onWorkspacePathChange={setNewWorkspacePath} onModelOverrideChange={setNewModelOverride}
        onProviderOverrideChange={setNewProviderOverride} onReasoningEffortChange={setNewReasoningEffort}
        onSubmit={() => handleCreateSubmit()}
        onClose={() => { setCreatingIn(null); resetCreateForm(); }}
      />

      {/* 手动调度 — 与主看板共享 DispatchModal */}
      <DispatchModal open={showDispatch} board={currentBoard} onClose={() => setShowDispatch(false)} onDispatched={loadBoard} />

      {/* 详情抽屉 — 双击卡片打开查看/操作；依赖点击可跳转（overlay 变体，
          与新建任务 CreateTaskDrawer 的侧边栏样式一致；头部 StatusMenu 走
          handleDrop 门控/摘要/乐观更新） */}
      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} onAction={handleAction} loadingId={loadingId}
          onRefresh={loadBoard} homeChannels={homeChannels} board={currentBoard} variant="overlay"
          modelCatalog={modelCatalog}
          onMoveStatus={(s) => handleDrop(s, selectedTask.id)}
          onOpenTask={(id) => { const t = allTasks.find(x => x.id === id); if (t) setSelectedTask(t); }} />
      )}

      {/* 新建看板模态 — 与主面板共享 CreateBoardModal */}
      <CreateBoardModal open={showCreateBoard} name={newBoardName} desc={newBoardDesc} color={newBoardColor}
        busy={creatingBoard} project={newBoardProject} projectList={boardProjectList}
        onClose={() => setShowCreateBoard(false)} onCreate={handleCreateBoard}
        onNameChange={setNewBoardName} onDescChange={setNewBoardDesc} onColorChange={setNewBoardColor}
        onProjectChange={setNewBoardProject} />

      {/* 🔴 2026-08-16（P1 遗留闭合）：提交评审 force 确认 / 退回理由——
          应用内浮层（与主面板共享，取代原生 confirm/prompt/alert） */}
      <KanbanReviewDialogs
        pendingForceReview={pendingForceReview}
        pendingChanges={pendingChanges}
        reviewBusy={reviewBusy}
        onConfirmForceReview={confirmForceReview}
        onCancelForceReview={cancelForceReview}
        onSubmitChanges={submitChanges}
        onCancelChanges={cancelChanges}
      />
    </div>
  );
}
