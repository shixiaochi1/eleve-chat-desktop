/**
 * KanbanPanel v3 — 看板全功能版
 *
 * 对齐 Eleve Dashboard 全部交互：
 *   - 8列 (triage/todo/scheduled/ready/running/blocked/review/done)
 *   - 陈旧度警告 (amber/red 内阴影)
 *   - 进度药丸 (3/5 子任务完成)
 *   - 拖拽移动列 (HTML5 drag)
 *   - 内联创建任务 (列头 + 按钮)
 *   - 评论线程 (抽屉底部评论输入+历史)
 *   - 运行历史 (抽屉展示每次调度 Run)
 *   - 搜索/过滤 (顶栏搜索)
 *   - 描述可编辑 (点击→textarea→保存)
 *   - 附件管理 (抽屉附件区)
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  X,
  RefreshCw,
  Loader,
  AlertTriangle,
  Play,
  Ban,
  Archive,
  Trash2,
  ArrowLeftFromLine,
  CheckCircle2,
  Plus,
  Search,
  Send,
  Paperclip,
  Edit3,
  Save,
  ChevronDown,
  GitBranch,
  Wrench,
  Activity,
  Radio,
  Bell,
  BellOff,
  FileText,
  Zap,
  Bug,
  Download,
  Users,
  Settings2,
  UserCircle,
  BarChart3,
  Clock,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readFileAsDataURL, base64FromDataURL } from '@/utils/file';
import { getWsActiveProfile } from '@/services/ws-client';
import {
  getKanbanBoard,
  getKanbanTask,
  createKanbanTask,
  updateKanbanTask,
  deleteKanbanTask,
  reclaimKanbanTask,
  addKanbanComment,
  getKanbanAttachments,
  uploadKanbanAttachment,
  deleteKanbanAttachment,
  getKanbanRun,
  bulkUpdateKanbanTasks,
  pollKanbanEvents,
  getApiBase,
  // Phase 4 APIs
  getKanbanBoards,
  createKanbanBoard,
  deleteKanbanBoard,
  updateKanbanBoard,
  getKanbanStats,
  getKanbanAssignees,
  createKanbanLink,
  deleteKanbanLink,
  reassignKanbanTask,
  switchKanbanBoard,
  decomposeKanbanTask,
  specifyKanbanTask,
  getKanbanDiagnostics,
  getKanbanActiveWorkers,
  terminateKanbanRun,
  getKanbanHomeChannels,
  subscribeKanbanHome,
  unsubscribeKanbanHome,
  getKanbanConfig,
  getKanbanOrchestration,
  setKanbanOrchestration,
  getKanbanProfiles,
  patchKanbanProfile,
  autoDescribeKanbanProfile,
} from '@/utils/api';

// ═══════════════════════════════════════════════════════════════
// kanban 子模块（Tier 3 · 6-2 拆分）
// ═══════════════════════════════════════════════════════════════
import type { KanbanTask } from './kanban/types';
import { COLUMNS, COLUMN_STATUS, updateStaleConfig } from './kanban/constants';
import { taskColumn, normalizeBoardData } from './kanban/helpers';
import { KanbanColumn } from './kanban/KanbanColumn';
import { TaskDrawer } from './kanban/TaskDrawer';
import { CreateBoardModal } from './kanban/CreateBoardModal';
import { CreateTaskDrawer } from './kanban/CreateTaskDrawer';
import { DispatchModal } from './kanban/DispatchModal';
import { useKanbanSSE } from './kanban/useKanbanSSE';
import { useKanban } from './kanban/useKanban';

// ═══════════════════════════════════════════════════════════════

// ── Profile 描述编辑行（对齐 Hermes OrchestrationPanel ProfileDescriptionRow：
//    描述编辑保存 + Auto 自动生成，decomposer 按描述路由）──
function ProfileDescriptionRow({ profile }: { profile: any }) {
  const [draft, setDraft] = useState<string>(profile?.description || '');
  const [saving, setSaving] = useState(false);
  const [autoing, setAutoing] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await patchKanbanProfile(profile.name, draft.trim());
    } catch (err) {
      console.error('save profile description failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const auto = async () => {
    setAutoing(true);
    try {
      const r = await autoDescribeKanbanProfile(profile.name);
      if (r?.description) setDraft(r.description);
    } catch (err) {
      console.error('auto describe failed:', err);
    } finally {
      setAutoing(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-20 shrink-0 truncate text-[0.7rem] font-medium text-[var(--ui-text-secondary)]">
        {profile.name}{profile.is_default ? '（默认）' : ''}
      </span>
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="该 Agent 擅长…（分解路由依据）"
        className="flex-1 min-w-0 text-[0.7rem] px-1.5 py-0.5 rounded border border-warning/20 bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-warning/50" />
      <button onClick={save} disabled={saving || draft.trim() === (profile?.description || '')}
        className="shrink-0 text-[0.65rem] px-1.5 py-0.5 rounded border border-warning/25 text-warning/80 hover:bg-warning/10 transition-colors disabled:opacity-40">
        {saving ? '保存中…' : '保存'}
      </button>
      <button onClick={auto} disabled={autoing}
        className="shrink-0 text-[0.65rem] px-1.5 py-0.5 rounded border border-warning/25 text-warning/80 hover:bg-warning/10 transition-colors disabled:opacity-40">
        {autoing ? '生成中…' : 'Auto'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 看板面板主组件
// ═══════════════════════════════════════════════════════════════

export default function KanbanPanel({ board = 'default' }: { board?: string }) {
  // 🔴 2026-08-13 Phase 2 拆分：状态与回调抽离到 useKanban（纯移动，无逻辑变更）。
  // 🔴 对齐 Hermes 列折叠：override map（手动切换持久于会话）+ 空列自动折叠
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>({});
  const {
    apiTasks,
    setApiTasks,
    loading,
    setLoading,
    error,
    setError,
    loadingId,
    setLoadingId,
    selectedTask,
    setSelectedTask,
    detailRefreshTick,
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
    searchQuery,
    setSearchQuery,
    groupRunning,
    toggleGroupRunning,
    checkedIds,
    setCheckedIds,
    currentBoard,
    setCurrentBoard,
    boards,
    setBoards,
    showBoardPicker,
    setShowBoardPicker,
    diagnostics,
    setDiagnostics,
    activeWorkers,
    setActiveWorkers,
    homeChannels,
    setHomeChannels,
    showDiagnostics,
    setShowDiagnostics,
    showWorkers,
    setShowWorkers,
    orchestration,
    setOrchestration,
    profiles,
    setProfiles,
    showCreateBoard,
    setShowCreateBoard,
    newBoardName,
    setNewBoardName,
    newBoardDesc,
    setNewBoardDesc,
    newBoardColor,
    setNewBoardColor,
    creatingBoard,
    setCreatingBoard,
    deleteBoardTarget,
    setDeleteBoardTarget,
    deletePermanently,
    setDeletePermanently,
    editBoardTarget,
    setEditBoardTarget,
    editBoardName,
    setEditBoardName,
    editBoardDesc,
    setEditBoardDesc,
    editBoardColor,
    setEditBoardColor,
    savingBoard,
    setSavingBoard,
    showStats,
    setShowStats,
    boardStats,
    setBoardStats,
    showAssigneeFilter,
    setShowAssigneeFilter,
    assigneeList,
    setAssigneeList,
    assigneeFilter,
    setAssigneeFilter,
    showStatusFilter,
    setShowStatusFilter,
    statusFilter,
    setStatusFilter,
    tenantFilter,
    setTenantFilter,
    showDispatch,
    setShowDispatch,
    showReassign,
    setShowReassign,
    reassignProfile,
    setReassignProfile,
    reassignReclaim,
    setReassignReclaim,
    reassigning,
    setReassigning,
    justCreatedIds,
    setJustCreatedIds,
    draggingTaskId,
    setDraggingTaskId,
    bulkConfirmAction,
    setBulkConfirmAction,
    showBulkReassign,
    setShowBulkReassign,
    bulkReassignProfile,
    setBulkReassignProfile,
    showBulkPriority,
    setShowBulkPriority,
    bulkPriority,
    setBulkPriority,
    loadBoard,
    allTasks,
    filteredTasks,
    grouped,
    runningLanes,
    handleDrop,
    resetCreateForm,
    handleCreateSubmit,
    handleAction,
    handleCheck,
    handleBulkAction,
    executeBulkAction,
    handleBulkReassign,
    handleBulkPriority,
    handleDeleteTask,
    handleSwitchBoard,
    handleCreateBoard,
    handleDeleteBoard,
    handleUpdateBoard,
    handleReassign,
  } = useKanban({ board });
  // 🔴 对齐 Hermes：有工作时空列自动折叠成 rail（boardHasWork 判定）
  const boardHasWork = Object.values(grouped).some((arr: KanbanTask[]) => arr.length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0 gap-3">
        {/* Phase 4.1: Board Picker */}
        <div className="relative">
          <button onClick={() => setShowBoardPicker(v => !v)}
            className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-[var(--ui-text-primary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] px-2 py-1 rounded-md transition-colors">
            看板{currentBoard !== 'default' ? `: ${currentBoard}` : ''}
            {/* 🔴 对齐 Hermes：total 徽标 = 过滤后计数（P2-6 修复计数失真） */}
            <span className="rounded-full bg-[var(--ui-bg-quinary)] px-1.5 py-px text-[0.65rem] tabular-nums text-[var(--ui-text-tertiary)]">
              {filteredTasks.length}
            </span>
            <ChevronDown size={14} strokeWidth={1.5} className={cn('transition-transform', showBoardPicker && 'rotate-180')} />
          </button>
          {showBoardPicker && (
            <div className="absolute top-full left-0 mt-1 min-w-[180px] py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-popover)] shadow-lg z-50 backdrop-blur-sm">
              {boards.map(b => {
                const slug = b.slug || b;
                const name = b.name || b.slug || b;
                const isDefault = slug === 'default';
                return (
                  <div key={slug} className="group flex items-center">
                    <button onClick={() => handleSwitchBoard(slug)}
                      className={cn('flex-1 text-left text-[0.8rem] px-3 py-1.5 transition-colors',
                        slug === currentBoard
                          ? 'text-[var(--color-foreground)] font-semibold'
                          : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]'
                      )}>
                      <span>{name}</span>
                      {/* 🔴 对齐 Hermes BoardSwitcher 每板 total 徽标（board-switcher.tsx
                          L220-222，审查 P1-8）：后端 list_boards_with_counts 已返回 */}
                      {typeof b.total === 'number' && (
                        <span className={cn('ml-1.5 text-[0.65rem] tabular-nums',
                          slug === currentBoard ? 'text-[var(--kanban-hover-bg)]' : 'text-[var(--ui-text-tertiary)]')}>
                          {b.total}
                        </span>
                      )}
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center transition-all">
                      <button onClick={e => { e.stopPropagation(); setShowBoardPicker(false); setEditBoardTarget({ slug, name, description: b.description || '', color: b.color || '' }); setEditBoardName(name); setEditBoardDesc(b.description || ''); setEditBoardColor(b.color || ''); }}
                        className="px-1.5 py-1 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)] rounded transition-colors"
                        title="编辑看板">
                        <Edit3 size={12} strokeWidth={1.5} />
                      </button>
                      {!isDefault && (
                        <button onClick={e => { e.stopPropagation(); setShowBoardPicker(false); setDeleteBoardTarget({ slug, name }); setDeletePermanently(false); }}
                          className="px-1.5 py-1 text-[var(--color-muted-foreground)] hover:text-danger hover:bg-[var(--color-accent)] rounded transition-colors"
                          title="删除看板">
                          <Trash2 size={12} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {boards.length === 0 && <span className="block px-3 py-1.5 text-[0.75rem] text-[var(--color-muted-foreground)]">暂无其他看板</span>}
              <div className="border-t border-[var(--color-border)] mt-1 pt-1">
                <button onClick={() => { setShowBoardPicker(false); setShowCreateBoard(true); }}
                  className="w-full text-left text-[0.8rem] px-3 py-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)] rounded-sm transition-colors flex items-center gap-1.5">
                  <Plus size={13} strokeWidth={1.5} /> 新建看板
                </button>
              </div>
            </div>
          )}
        </div>
        {/* 搜索框 */}
        <div className="flex items-center gap-2 flex-1 max-w-lg">
          <div className="relative flex-1 min-w-0">
            <Search size={13} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ui-text-quaternary)]" />
            <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索任务（标题/描述/负责人/ID）…" data-kanban-search
              className="w-full text-[0.75rem] pl-8 pr-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
          </div>
          {/* 状态过滤 */}
          <div className="relative">
            <button onClick={() => setShowStatusFilter(v => !v)}
              className={cn('p-1.5 rounded-md transition-colors border', statusFilter.size > 0
                ? 'border-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)]'
                : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)]')}
              title="按状态筛选">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>
            {showStatusFilter && (
              <div className="absolute top-full right-0 mt-1 min-w-[130px] py-1.5 px-2 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-lg z-50 backdrop-blur-sm">
                <div className="text-[0.72rem] font-medium text-[var(--ui-text-tertiary)] mb-1 px-1">按状态</div>
                {COLUMNS.map(col => {
                  const checked = statusFilter.has(col.key);
                  return (
                    <label key={col.key} className="flex items-center gap-2 py-0.5 text-[0.7rem] text-[var(--ui-text-primary)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_5%,transparent)] rounded px-1">
                      <input type="checkbox" checked={checked} onChange={() => {
                        setStatusFilter(prev => { const n = new Set(prev); if (n.has(col.key)) n.delete(col.key); else n.add(col.key); return n; });
                      }}
                        className="rounded border-[var(--ui-stroke-tertiary)] accent-[var(--kanban-hover-bg)] w-3 h-3" />
                      <span style={{ color: col.dotColor }}>{col.label}</span>
                    </label>
                  );
                })}
                {statusFilter.size > 0 && (
                  <button onClick={() => { setStatusFilter(new Set()); setShowStatusFilter(false); }}
                    className="w-full text-[0.65rem] text-[var(--kanban-hover-bg)] hover:underline mt-1 pt-1 border-t border-[var(--ui-stroke-tertiary)] px-1">
                    清除 ({statusFilter.size})
                  </button>
                )}
              </div>
            )}
          </div>
          {/* 租户过滤 */}
          <input value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}
            placeholder="租户/标签"
            className={cn('w-20 text-[0.7rem] px-2 py-1.5 rounded-md border bg-[var(--kanban-overlay)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]',
              tenantFilter ? 'border-[var(--kanban-hover-bg)]' : 'border-[var(--ui-stroke-tertiary)]')} />
          {/* Phase B2: 负责人筛选 */}
          <div className="relative">
            <button onClick={() => setShowAssigneeFilter(v => !v)}
              className={cn('p-1.5 rounded-md transition-colors', assigneeFilter.size > 0
                ? 'text-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)]'
                : 'text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)]'
              )}
              title="按负责人筛选">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </button>
            {showAssigneeFilter && (
              <div className="absolute top-full right-0 mt-1 min-w-[160px] max-h-[240px] overflow-y-auto py-1.5 px-2 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-lg z-50 backdrop-blur-sm">
                <div className="text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1.5">按负责人筛选</div>
                {assigneeList.length === 0 && <span className="text-[0.7rem] text-[var(--ui-text-quaternary)]">暂无负责人</span>}
                {assigneeList.map(a => {
                  const name = typeof a === 'string' ? a : a.name || a.assignee || String(a);
                  const checked = assigneeFilter.has(name);
                  return (
                    <label key={name} className="flex items-center gap-2 py-1 text-[0.75rem] text-[var(--ui-text-primary)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_5%,transparent)] rounded px-1">
                      <input type="checkbox" checked={checked} onChange={() => {
                        setAssigneeFilter(prev => {
                          const next = new Set(prev);
                          if (next.has(name)) next.delete(name); else next.add(name);
                          return next;
                        });
                      }}
                        className="rounded border-[var(--ui-stroke-tertiary)] text-[var(--kanban-hover-bg)] focus:ring-[var(--kanban-hover-bg)]" />
                      {name}
                    </label>
                  );
                })}
                {assigneeFilter.size > 0 && (
                  <button onClick={() => setAssigneeFilter(new Set())}
                    className="w-full text-[0.7rem] text-[var(--kanban-hover-bg)] hover:underline mt-1.5 pt-1 border-t border-[var(--ui-stroke-tertiary)]">
                    清除筛选 ({assigneeFilter.size})
                  </button>
                )}
              </div>
            )}
          </div>
          {/* 🔴 对齐 Hermes $lanesByProfile（board.tsx FilterMenu L936-939）：
              Running 分组开关，默认关=平铺（审查 P1-5） */}
          <button onClick={toggleGroupRunning}
            className={cn('flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[0.7rem] transition-colors shrink-0',
              groupRunning
                ? 'border-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)] text-[var(--ui-text-primary)]'
                : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)]')}
            title="按负责人分组 Running 列（持久化）">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            分组
          </button>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader size={12} strokeWidth={1.5} className="animate-spin text-[var(--color-muted-foreground)]" />}
          {error && <span className="text-[0.7rem] text-danger">{error}</span>}
          {/* 新建任务（主按钮，对齐 Hermes 顶栏 "+ 新建任务"；另可点列内 "+" 或按 N） */}
          <button onClick={() => setCreatingIn('triage')} title="新建任务（N）"
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[0.8rem] font-medium hover:opacity-90 transition-opacity">
            <Plus size={13} strokeWidth={2} />
            新建任务
          </button>
          {/* 调度按钮 */}
          <button onClick={() => setShowDispatch(true)} title="手动调度"
            className="inline-flex items-center p-1.5 rounded-md transition-colors border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]">
            <Zap size={13} strokeWidth={1.5} />
          </button>
          {/* 诊断按钮 */}
          <button onClick={() => setShowDiagnostics(v => !v)} title="诊断"
            className={cn('inline-flex items-center p-1.5 rounded-md transition-colors border',
              showDiagnostics ? 'text-[var(--color-foreground)] border-primary bg-[var(--color-accent)]' : 'text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]')}>
            <Bug size={13} strokeWidth={1.5} />
          </button>
          {/* Worker 按钮 */}
          <button onClick={() => setShowWorkers(v => !v)} title="Worker"
            className={cn('inline-flex items-center p-1.5 rounded-md transition-colors border',
              showWorkers ? 'text-[var(--color-foreground)] border-primary bg-[var(--color-accent)]' : 'text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]')}>
            <Activity size={13} strokeWidth={1.5} />
          </button>
          {/* 统计按钮 */}
          <div className="relative">
            <button onClick={() => setShowStats(v => !v)}
              className={cn('inline-flex items-center p-1.5 rounded-md transition-colors border',
                showStats ? 'text-[var(--color-foreground)] border-primary bg-[var(--color-accent)]' : 'text-[var(--color-muted-foreground)] border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]')}
              title="统计">
              <BarChart3 size={13} strokeWidth={1.5} />
            </button>
            {showStats && boardStats && (
              <div className="absolute top-full right-0 mt-1 min-w-[220px] py-2 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-popover)] shadow-lg z-50 backdrop-blur-sm space-y-2">
                <div className="text-[0.8rem] font-semibold text-[var(--color-foreground)]">看板统计</div>
                {boardStats.by_status && Object.keys(boardStats.by_status).length > 0 && (
                  <div className="space-y-1">
                    {['triage','todo','ready','running','blocked','done'].map(s => {
                      const count = (boardStats.by_status as Record<string, number>)[s] || 0;
                      if (count === 0) return null;
                      const total = Object.values(boardStats.by_status as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
                      const pct = total > 0 ? Math.round(count / total * 100) : 0;
                      const colors = { triage: 'bg-accent-purple', todo: 'bg-info', ready: 'bg-accent-cyan', running: 'bg-warning', blocked: 'bg-danger', done: 'bg-success' };
                      return (
                        <div key={s} className="flex items-center gap-2 text-[0.75rem]">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', colors[s as keyof typeof colors] || 'bg-muted-foreground/50')} />
                          <span className="text-[var(--color-foreground)] capitalize flex-1">{s}</span>
                          <span className="text-[var(--color-muted-foreground)] tabular-nums">{count}</span>
                          <div className="w-12 h-1 rounded-full bg-[var(--color-border)]">
                            <div className={cn('h-1 rounded-full', colors[s as keyof typeof colors] || 'bg-muted-foreground/50')} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {boardStats.oldest_ready_age_seconds != null && (
                  <div className="text-[0.7rem] text-[var(--color-muted-foreground)]">
                    最久待执行: {boardStats.oldest_ready_age_seconds < 3600 ? `${Math.round(boardStats.oldest_ready_age_seconds / 60)}分钟` : boardStats.oldest_ready_age_seconds < 86400 ? `${Math.round(boardStats.oldest_ready_age_seconds / 3600)}小时` : `${Math.round(boardStats.oldest_ready_age_seconds / 86400)}天`}
                  </div>
                )}
                {boardStats.by_assignee && Object.keys(boardStats.by_assignee).length > 0 && (
                  <div className="border-t border-[var(--color-border)] pt-1.5 space-y-1">
                    <div className="text-[0.7rem] font-medium text-[var(--color-muted-foreground)]">按负责人</div>
                    {Object.entries(boardStats.by_assignee as Record<string, Record<string, number>>).map(([assignee, statuses]) => {
                      const total: number = Object.values(statuses as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
                      return (
                        <div key={assignee} className="flex items-center gap-2 text-[0.75rem]">
                          <span className="text-[var(--color-foreground)] flex-1 truncate">{assignee}</span>
                          <span className="text-[var(--color-muted-foreground)] tabular-nums">{total}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* 刷新按钮 */}
          <button onClick={loadBoard} disabled={loading}
            className={cn('inline-flex items-center p-1.5 rounded-md transition-colors border border-[var(--color-border)]',
              loading ? 'opacity-50 pointer-events-none' : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]')}
            title="刷新看板">
            <RefreshCw size={13} strokeWidth={1.5} className={cn(loading && 'animate-spin')} />
          </button>
          <span className="text-[0.7rem] tabular-nums text-[var(--color-muted-foreground)]">{allTasks.length} 个任务</span>
        </div>
      </div>

      {/* Phase 4.5: 诊断面板 */}
      {showDiagnostics && diagnostics && (
        <div className="mx-4 px-3 py-2.5 rounded-md border border-warning/25 bg-warning/5 text-[0.8rem] flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-semibold text-warning"><Bug size={13} /> 诊断</div>
          {diagnostics.stale_claims > 0 && <div className="text-warning">⚠ {diagnostics.stale_claims} 个过期 claim</div>}
          {diagnostics.blocked_over_24h > 0 && <div className="text-danger">⚠ {diagnostics.blocked_over_24h} 个任务阻塞超24h</div>}
          {diagnostics.orphaned_tasks > 0 && <div className="text-warning">⚠ {diagnostics.orphaned_tasks} 个孤立任务</div>}
          {(!diagnostics.stale_claims && !diagnostics.blocked_over_24h && !diagnostics.orphaned_tasks) && <div className="text-success">✓ 一切正常</div>}
          {/* C1: 编排配置 — 🔴 对齐 Hermes OrchestrationPanel：只读展示改为
               可编辑（orchestrator_profile/default_assignee 下拉 + auto 开关，
               保存即写 config.yaml——后端配置源已统一） */}
          {orchestration && (
            <div className="mt-1.5 pt-1.5 border-t border-warning/15 flex flex-col gap-2">
              <div className="flex items-center gap-2 font-semibold text-warning"><Settings2 size={12} /> 编排设置</div>
              <label className="flex flex-col gap-0.5">
                <span className="text-[0.68rem] text-[var(--ui-text-tertiary)]">orchestrator_profile</span>
                <select
                  value={orchestration.config?.orchestrator_profile || ''}
                  onChange={async (e) => {
                    const v = e.target.value;
                    try {
                      const r = await setKanbanOrchestration({ orchestrator_profile: v });
                      setOrchestration(r?.config ? { config: r.config } : r);
                    } catch (err) { console.error('save orchestrator_profile failed:', err); }
                  }}
                  className="text-[0.75rem] px-2 py-1 rounded border border-warning/25 bg-transparent text-[var(--ui-text-primary)] focus:outline-none"
                >
                  <option value="">默认（继承）</option>
                  {(profiles || []).map((p: any) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[0.68rem] text-[var(--ui-text-tertiary)]">default_assignee</span>
                <select
                  value={orchestration.config?.default_assignee || ''}
                  onChange={async (e) => {
                    const v = e.target.value;
                    try {
                      const r = await setKanbanOrchestration({ default_assignee: v });
                      setOrchestration(r?.config ? { config: r.config } : r);
                    } catch (err) { console.error('save default_assignee failed:', err); }
                  }}
                  className="text-[0.75rem] px-2 py-1 rounded border border-warning/25 bg-transparent text-[var(--ui-text-primary)] focus:outline-none"
                >
                  <option value="">默认（继承）</option>
                  {(profiles || []).map((p: any) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] cursor-pointer">
                  <input type="checkbox" checked={Boolean(orchestration.config?.auto_decompose)}
                    onChange={async (e) => {
                      try {
                        const r = await setKanbanOrchestration({ auto_decompose: e.target.checked });
                        setOrchestration(r?.config ? { config: r.config } : r);
                      } catch (err) { console.error('save auto_decompose failed:', err); }
                    }}
                    className="rounded border-warning/40" />
                  自动分解
                </label>
                <label className="flex items-center gap-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] cursor-pointer">
                  <input type="checkbox" checked={Boolean(orchestration.config?.auto_promote_children)}
                    onChange={async (e) => {
                      try {
                        const r = await setKanbanOrchestration({ auto_promote_children: e.target.checked });
                        setOrchestration(r?.config ? { config: r.config } : r);
                      } catch (err) { console.error('save auto_promote_children failed:', err); }
                    }}
                    className="rounded border-warning/40" />
                  自动提升子任务
                </label>
              </div>
            </div>
          )}
          {/* C1: Profile 列表 + 描述编辑（对齐 Hermes OrchestrationPanel
              ProfileDescriptionRow：描述编辑保存 + Auto 自动生成） */}
          {profiles.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-warning/15">
              <div className="flex items-center gap-2 font-semibold text-warning mb-1"><UserCircle size={12} /> 可用 Agent ({profiles.length})</div>
              <div className="flex flex-col gap-1.5">
                {profiles.map((p: any, i: number) => (
                  <ProfileDescriptionRow key={`${p.name}-${i}`} profile={p} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phase 4.6: Worker 监控面板 */}
      {showWorkers && (
        <div className="mx-4 px-3 py-2.5 rounded-md border border-success/25 bg-success/5 text-[0.8rem] flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-semibold text-success"><Activity size={13} /> 活跃 Worker ({activeWorkers.length})</div>
          {activeWorkers.length === 0 && <div className="text-[var(--ui-text-tertiary)]">暂无活跃 Worker</div>}
          {activeWorkers.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="font-mono text-[0.75rem]">{w.profile || w.assignee || 'worker'}</span>
              {w.task_id && <span className="text-[0.7rem] text-[var(--ui-text-tertiary)]">→ #{typeof w.task_id === 'string' ? w.task_id.slice(0,6) : w.task_id}</span>}
              {w.run_id && <button onClick={() => handleAction('terminate', w.run_id)} className="ml-auto text-[0.65rem] text-danger/70 hover:text-danger transition-colors">终止</button>}
            </div>
          ))}
        </div>
      )}

      {/* 批量操作栏 */}
      {checkedIds.size > 0 && (
        <div className="flex items-center gap-2 mx-4 px-3 py-2 rounded-md bg-[color-mix(in_srgb,var(--kanban-hover-bg)_10%,var(--kanban-overlay))] border border-[color-mix(in_srgb,var(--kanban-hover-bg)_40%,var(--ui-stroke-tertiary))]">
          <span className="text-[0.75rem] font-semibold text-[var(--ui-text-primary)]">已选 {checkedIds.size} 项</span>
          <button onClick={() => handleBulkAction('complete')} className="text-[0.7rem] px-2 py-1 rounded border border-success/25 text-success hover:bg-success/10 transition-colors">批量完成</button>
          <button onClick={() => handleBulkAction('archive')} className="text-[0.7rem] px-2 py-1 rounded border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">批量归档</button>
          <button onClick={() => handleBulkAction('delete')} className="text-[0.7rem] px-2 py-1 rounded border border-danger/25 text-danger hover:bg-danger/10 transition-colors">批量删除</button>
          <button onClick={() => { setShowBulkReassign(true); setBulkReassignProfile(''); }} className="text-[0.7rem] px-2 py-1 rounded border border-info/25 text-info hover:bg-info/10 transition-colors">批量重分配</button>
          <button onClick={() => { setShowBulkPriority(true); setBulkPriority(''); }} className="text-[0.7rem] px-2 py-1 rounded border border-warning/25 text-warning hover:bg-warning/10 transition-colors">批量改优先级</button>
          <button onClick={() => setCheckedIds(new Set())} className="ml-auto text-[0.7rem] text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] transition-colors">取消选择</button>
        </div>
      )}

      {/* 8列看板 — 列等高 stretch，min-h-0 确保高度受父级约束
          🔴 对齐 Hermes 整页态（board.tsx L1370-1388）：首载 Loader /
          错误 ErrorState+重试 / 空板 CTA（审查 P1-6）——
          刷新中（已有数据）不闪屏，仅整页级状态才替换板体 */}
      {error && allTasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center min-h-0">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <AlertTriangle size={28} strokeWidth={1.2} className="text-danger" />
            <p className="text-[0.85rem] text-[var(--ui-text-secondary)]">{error}</p>
            <button onClick={() => void loadBoard()}
              className="px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[0.75rem] text-[var(--ui-text-primary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">
              重试
            </button>
          </div>
        </div>
      ) : loading && allTasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center min-h-0">
          <div className="flex items-center gap-2 text-[var(--ui-text-tertiary)]">
            <Loader size={16} strokeWidth={1.5} className="animate-spin" />
            <span className="text-[0.8rem]">加载看板…</span>
          </div>
        </div>
      ) : allTasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center min-h-0">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <p className="text-[0.85rem] text-[var(--ui-text-tertiary)]">看板空空如也——你的 Agent 们正等着开工</p>
            <button onClick={() => setCreatingIn('triage')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[0.8rem] font-medium hover:opacity-90 transition-opacity">
              <Plus size={13} strokeWidth={2} />
              新建任务
            </button>
          </div>
        </div>
      ) : (
      <div className="flex flex-1 items-stretch min-h-0 min-w-0 px-4 pb-4" style={{ gap: 'var(--kanban-col-gap)' }}>
        {COLUMNS.map(col => (
          <KanbanColumn key={col.key} column={col} tasks={col.key === 'running' ? grouped.running : grouped[col.key]}
            runningLanes={col.key === 'running' ? runningLanes : undefined}
            onSelect={setSelectedTask} selectedId={selectedTask?.id}
            onDragStart={(taskId: string) => setDraggingTaskId(taskId)}
            onDrop={handleDrop}
            creatingIn={creatingIn} onCreateStart={setCreatingIn} onCreateCancel={() => setCreatingIn(null)}
            checkedIds={checkedIds} onCheck={handleCheck} justCreatedIds={justCreatedIds} draggingTaskId={draggingTaskId}
            onCreateSubmit={() => { void handleCreateSubmit().catch(() => {}); }} newTitle={newTitle} setNewTitle={setNewTitle} onDelete={handleDeleteTask}
            defaultAssignee={orchestration?.config?.default_assignee || ''}
            collapsed={collapsedLanes[col.key] ?? (boardHasWork && (grouped[col.key] || []).length === 0)}
            onToggle={() => {
              const tasks = grouped[col.key] || [];
              const auto = boardHasWork && tasks.length === 0;
              const next = !(collapsedLanes[col.key] ?? auto);
              setCollapsedLanes(prev => ({ ...prev, [col.key]: next }));
            }} />
        ))}
      </div>
      )}

      {/* 详情抽屉（头部 StatusMenu 走 handleDrop 门控/摘要/乐观更新） */}
      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} onAction={handleAction} loadingId={loadingId} onRefresh={loadBoard}
          homeChannels={homeChannels} board={currentBoard}
          detailRefreshTick={detailRefreshTick}
          onMoveStatus={(s) => handleDrop(s, selectedTask.id)}
          onOpenTask={(id) => { const t = allTasks.find(x => x.id === id); if (t) setSelectedTask(t); }} />
      )}

      {/* 创建任务抽屉 — 共享 CreateTaskDrawer（对齐 HERMES NewTaskDialog 字段集，
          主看板右侧滑出；侧边栏以 overlay 变体复用） */}
      <CreateTaskDrawer
        open={Boolean(creatingIn)} target={creatingIn || 'triage'} variant="drawer"
        title={newTitle} body={newBody} assignee={newAssignee} priority={newPriority}
        skills={newSkills} parent={newParent} goalMode={newGoalMode} goalMaxTurns={newGoalMaxTurns}
        workspaceKind={newWorkspaceKind} workspacePath={newWorkspacePath} modelOverride={newModelOverride}
        providerOverride={newProviderOverride} reasoningEffort={newReasoningEffort}
        assigneeOptions={(profiles || []).map((p: any) => ({ name: p.name }))}
        parentOptions={allTasks.filter(t => t.id && t.status !== 'running').slice(0, 30).map(t => ({ id: t.id, title: t.title }))}
        onTitleChange={setNewTitle} onBodyChange={setNewBody} onAssigneeChange={setNewAssignee}
        onPriorityChange={setNewPriority} onSkillsChange={setNewSkills} onParentChange={setNewParent}
        onGoalModeChange={setNewGoalMode} onGoalMaxTurnsChange={setNewGoalMaxTurns}
        onWorkspaceKindChange={setNewWorkspaceKind} onWorkspacePathChange={setNewWorkspacePath} onModelOverrideChange={setNewModelOverride}
        onProviderOverrideChange={setNewProviderOverride} onReasoningEffortChange={setNewReasoningEffort}
        onSubmit={() => handleCreateSubmit()}
        onClose={() => { setCreatingIn(null); resetCreateForm(); }}
      />

      {/* 手动调度 — 共享 DispatchModal（完整 DispatchResult 展示） */}
      <DispatchModal open={showDispatch} board={currentBoard} onClose={() => setShowDispatch(false)} onDispatched={loadBoard} />

      {/* Phase 3: 批量重分配弹窗 */}
      {showBulkReassign && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/50" onClick={() => setShowBulkReassign(false)} style={{ animation: 'fadeIn 150ms ease-out' }}>
          <div className="flex flex-col gap-4 p-5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-2xl backdrop-blur-sm min-w-[280px]" onClick={e => e.stopPropagation()} style={{ animation: 'scaleIn 150ms ease-out' }}>
            <span className="text-[0.9rem] font-semibold text-[var(--ui-text-primary)]">批量重分配</span>
            <p className="text-[0.8rem] text-[var(--ui-text-tertiary)]">将 {checkedIds.size} 个任务分配到指定 Agent</p>
            <input value={bulkReassignProfile} onChange={e => setBulkReassignProfile(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') handleBulkReassign(); if (e.key === 'Escape') setShowBulkReassign(false); }}
              placeholder="Agent 名称"
              className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowBulkReassign(false)} className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
              <button onClick={handleBulkReassign} disabled={!bulkReassignProfile.trim()}
                className={cn('text-[0.8rem] px-3 py-1.5 rounded-md border transition-colors',
                  bulkReassignProfile.trim() ? 'border-info/30 bg-info/10 text-info hover:bg-info/20' : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] cursor-not-allowed')}>
                确认重分配
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 3: 批量改优先级弹窗 */}
      {showBulkPriority && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/50" onClick={() => setShowBulkPriority(false)} style={{ animation: 'fadeIn 150ms ease-out' }}>
          <div className="flex flex-col gap-4 p-5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-2xl backdrop-blur-sm min-w-[260px]" onClick={e => e.stopPropagation()} style={{ animation: 'scaleIn 150ms ease-out' }}>
            <span className="text-[0.9rem] font-semibold text-[var(--ui-text-primary)]">批量改优先级</span>
            <p className="text-[0.8rem] text-[var(--ui-text-tertiary)]">为 {checkedIds.size} 个任务设置新优先级</p>
            <div className="flex gap-2">
              {['0','1','2','3'].map(p => (
                <button key={p} onClick={() => { setBulkPriority(p); }}
                  className={cn('flex-1 h-10 rounded-md border text-[0.85rem] font-semibold transition-colors',
                    bulkPriority === p ? 'border-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)]' : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)]')}>
                  P{p}
                </button>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowBulkPriority(false)} className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
              <button onClick={handleBulkPriority} disabled={!bulkPriority}
                className={cn('text-[0.8rem] px-3 py-1.5 rounded-md border transition-colors',
                  bulkPriority ? 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20' : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] cursor-not-allowed')}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 4.10: 批量确认弹窗 */}
      {bulkConfirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/50" style={{ animation: 'fadeIn 150ms ease-out' }}>
          <div className="flex flex-col gap-4 p-5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-2xl backdrop-blur-sm min-w-[280px]" style={{ animation: 'scaleIn 150ms ease-out' }}>
            <span className="text-[0.9rem] font-semibold text-[var(--ui-text-primary)]">
              确认批量{bulkConfirmAction === 'delete' ? '删除' : '归档'}
            </span>
            <p className="text-[0.8rem] text-[var(--ui-text-tertiary)]">
              将对 {checkedIds.size} 个任务执行{bulkConfirmAction === 'delete' ? '删除' : '归档'}操作，此操作不可撤销。
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setBulkConfirmAction(null)} className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
              <button onClick={() => executeBulkAction(bulkConfirmAction)} className={cn('text-[0.8rem] px-3 py-1.5 rounded-md border transition-colors',
                bulkConfirmAction === 'delete' ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/20' : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20'
              )}>确认{bulkConfirmAction === 'delete' ? '删除' : '归档'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Phase A1: 新建看板模态 — 🔴 收敛到共享组件 CreateBoardModal（侧边栏复用） */}
      <CreateBoardModal open={showCreateBoard} name={newBoardName} desc={newBoardDesc} color={newBoardColor}
        busy={creatingBoard} onClose={() => setShowCreateBoard(false)} onCreate={handleCreateBoard}
        onNameChange={setNewBoardName} onDescChange={setNewBoardDesc} onColorChange={setNewBoardColor} />

      {/* Phase A2: 删除看板确认 */}
      {deleteBoardTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/30 backdrop-blur-[2px]" onClick={() => setDeleteBoardTarget(null)}>
          <div className="w-[340px] rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] shadow-xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'scaleIn 0.15s ease-out' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} strokeWidth={1.5} className="text-warning shrink-0" />
              <span className="text-[0.95rem] font-semibold text-[var(--ui-text-primary)]">删除看板</span>
            </div>
            <p className="text-[0.8rem] text-[var(--ui-text-tertiary)]">
              确定要删除看板「{deleteBoardTarget.name}」吗？该看板下的任务将移回 default。
            </p>
            <label className="flex items-center gap-2 text-[0.8rem] text-[var(--ui-text-tertiary)]">
              <input type="checkbox" checked={deletePermanently} onChange={e => setDeletePermanently(e.target.checked)}
                className="rounded border-[var(--ui-stroke-tertiary)] text-danger focus:ring-danger/30" />
              永久删除（含任务数据，不可恢复）
            </label>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setDeleteBoardTarget(null)}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
              <button onClick={handleDeleteBoard}
                className="text-[0.8rem] px-4 py-1.5 rounded-md border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20 transition-colors">
                {deletePermanently ? '永久删除' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase A3: 编辑看板模态 */}
      {editBoardTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/30 backdrop-blur-[2px]" onClick={() => setEditBoardTarget(null)}>
          <div className="w-[360px] rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] shadow-xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'scaleIn 0.15s ease-out' }}>
            <div className="flex items-center justify-between">
              <span className="text-[0.95rem] font-semibold text-[var(--ui-text-primary)]">编辑看板</span>
              <button onClick={() => setEditBoardTarget(null)} className="p-1 rounded-md hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] text-[var(--ui-text-tertiary)]"><X size={15} strokeWidth={1.5} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">Slug（不可修改）</label>
                <input value={editBoardTarget.slug} readOnly
                  className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] text-[var(--ui-text-tertiary)] cursor-not-allowed" />
              </div>
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">名称 *</label>
                <input value={editBoardName} onChange={e => setEditBoardName(e.target.value)} autoFocus
                  className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
              </div>
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">描述</label>
                <input value={editBoardDesc} onChange={e => setEditBoardDesc(e.target.value)} placeholder="可选"
                  className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
              </div>
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">颜色</label>
                <div className="flex items-center gap-2">
                  <input value={editBoardColor} onChange={e => setEditBoardColor(e.target.value)} placeholder="#6490C8"
                    className="flex-1 text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
                  {editBoardColor && <span className="w-5 h-5 rounded-full border border-[var(--ui-stroke-tertiary)]" style={{ backgroundColor: editBoardColor }} />}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setEditBoardTarget(null)} disabled={savingBoard}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
              <button onClick={handleUpdateBoard} disabled={savingBoard || !editBoardName.trim()}
                className={cn('text-[0.8rem] px-4 py-1.5 rounded-md border transition-colors flex items-center gap-1.5',
                  editBoardName.trim() && !savingBoard
                    ? 'border-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]'
                    : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] cursor-not-allowed'
                )}>
                {savingBoard && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase B3: 手动调度模态 — 收敛到共享 DispatchModal（见创建抽屉上方） */}

      {/* Phase B5: 重分配模态 */}
      {showReassign && selectedTask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/30 backdrop-blur-[2px]" onClick={() => setShowReassign(false)}>
          <div className="w-[340px] rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] shadow-xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'scaleIn 0.15s ease-out' }}>
            <div className="flex items-center justify-between">
              <span className="text-[0.95rem] font-semibold text-[var(--ui-text-primary)]">重分配任务</span>
              <button onClick={() => setShowReassign(false)} className="p-1 rounded-md hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] text-[var(--ui-text-tertiary)]"><X size={15} strokeWidth={1.5} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">目标 Agent *</label>
                <input value={reassignProfile} onChange={e => setReassignProfile(e.target.value)} placeholder="例如：default" autoFocus
                  className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
              </div>
              <label className="flex items-center gap-2 text-[0.8rem] text-[var(--ui-text-primary)]">
                <input type="checkbox" checked={reassignReclaim} onChange={e => setReassignReclaim(e.target.checked)}
                  className="rounded border-[var(--ui-stroke-tertiary)] text-[var(--kanban-hover-bg)] focus:ring-[var(--kanban-hover-bg)]" />
                先回收再分配
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowReassign(false)} disabled={reassigning}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
              <button onClick={handleReassign} disabled={reassigning || !reassignProfile.trim()}
                className={cn('text-[0.8rem] px-4 py-1.5 rounded-md border transition-colors flex items-center gap-1.5',
                  reassignProfile.trim() && !reassigning
                    ? 'border-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]'
                    : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] cursor-not-allowed'
                )}>
                {reassigning && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
                重分配
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 动画 keyframes */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0.3 } to { transform: translateX(0); opacity: 1 } }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        @keyframes pulseHighlight { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--kanban-hover-bg) 40%, transparent); } 50% { box-shadow: 0 0 12px 2px color-mix(in srgb, var(--kanban-hover-bg) 20%, transparent); } 100% { box-shadow: none; } }
      `}</style>
    </div>
  );
}
