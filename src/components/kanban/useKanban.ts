/**
 * useKanban — 看板状态与 CRUD 回调（列/卡状态 + 看板管理 + 调度/重分配）
 *
 * 🔴 2026-08-13 Phase 2 拆分（施工方案_文件事件下沉与前端减负）：
 *   从 KanbanPanel.tsx 纯移动抽取（diff 无逻辑变更）。只拆组织，不动状态归属——
 *   看板状态单一权威源仍在本 hook，组件经返回值消费。
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  requestKanbanReview,
  requestKanbanChanges,
  // Phase 4 APIs
  getKanbanBoards,
  createKanbanBoard,
  deleteKanbanBoard,
  updateKanbanBoard,
  getKanbanStats,
  getKanbanAssignees,
  dispatchKanbanTasks,
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
} from '@/utils/api';
import type { KanbanTask, KanbanEvent } from './types';
import { COLUMNS, COLUMN_STATUS, LOCKED_REASON, updateStaleConfig } from './constants';
import { notify } from '../../utils/notifications';
import { taskColumn, normalizeBoardData } from './helpers';
import { useKanbanSSE } from './useKanbanSSE';

export function useKanban({ board = 'default' }: { board?: string }) {
  const [apiTasks, setApiTasks] = useState<KanbanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [newSkills, setNewSkills] = useState('');
  const [newParent, setNewParent] = useState('');
  const [newGoalMode, setNewGoalMode] = useState(false);
  const [newGoalMaxTurns, setNewGoalMaxTurns] = useState('20');
  // 工作区类型/路径（对齐 HERMES NewTaskDialog：scratch/worktree/dir + 可选覆盖路径）
  const [newWorkspaceKind, setNewWorkspaceKind] = useState('');
  const [newWorkspacePath, setNewWorkspacePath] = useState('');
  // 🔴 模型覆盖（对齐 HERMES TaskModelOverride）：'' = 继承 profile 的模型
  const [newModelOverride, setNewModelOverride] = useState('');
  // 对齐 Hermes：三元组 {model, provider, reasoning effort}
  const [newProviderOverride, setNewProviderOverride] = useState('');
  const [newReasoningEffort, setNewReasoningEffort] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<any>>(new Set());
  // Phase 4 状态
  const [currentBoard, setCurrentBoard] = useState(board);
  const [boards, setBoards] = useState<any[]>([]);
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [activeWorkers, setActiveWorkers] = useState<any[]>([]);
  const [homeChannels, setHomeChannels] = useState<any[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showWorkers, setShowWorkers] = useState(false);
  // C1: 编排配置 & Profile 列表
  const [orchestration, setOrchestration] = useState<any>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  // Phase A: 新建看板模态
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDesc, setNewBoardDesc] = useState('');
  const [newBoardColor, setNewBoardColor] = useState('');
  const [creatingBoard, setCreatingBoard] = useState(false);
  // Phase A2: 删除看板确认
  const [deleteBoardTarget, setDeleteBoardTarget] = useState<any>(null); // { slug, name }
  const [deletePermanently, setDeletePermanently] = useState(false);
  // Phase A3: 编辑看板
  const [editBoardTarget, setEditBoardTarget] = useState<any>(null); // { slug, name, description, color }
  const [editBoardName, setEditBoardName] = useState('');
  const [editBoardDesc, setEditBoardDesc] = useState('');
  const [editBoardColor, setEditBoardColor] = useState('');
  const [savingBoard, setSavingBoard] = useState(false);
  // Phase B1: 统计面板
  const [showStats, setShowStats] = useState(false);
  const [boardStats, setBoardStats] = useState<any>(null);
  // Phase B2: 负责人筛选
  const [showAssigneeFilter, setShowAssigneeFilter] = useState(false);
  const [assigneeList, setAssigneeList] = useState<any[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<Set<any>>(new Set());
  // Phase 3: 状态过滤 + 租户过滤
  const [showStatusFilter, setShowStatusFilter] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<any>>(new Set());
  const [tenantFilter, setTenantFilter] = useState('');
  // Phase B3: 手动调度（弹窗状态在此，调度参数/结果由共享 DispatchModal 自管）
  const [showDispatch, setShowDispatch] = useState(false);
  // Phase B5: 重分配
  const [showReassign, setShowReassign] = useState(false);
  const [reassignProfile, setReassignProfile] = useState('');
  const [reassignReclaim, setReassignReclaim] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  // 🔴 workerLog 状态已移除：日志查看下沉 TaskDrawer 自管（running 3s/其他 15s
  //   自动轮询，对齐 Hermes logKey），useKanban 不再持有
  const [justCreatedIds, setJustCreatedIds] = useState<Set<any>>(new Set()); // Phase 4.10: 新创建卡片高亮
  const [draggingTaskId, setDraggingTaskId] = useState<any>(null); // Phase 3: 拖拽源标识
  const [bulkConfirmAction, setBulkConfirmAction] = useState<any>(null); // Phase 4.10: 批量确认弹窗
  const [showBulkReassign, setShowBulkReassign] = useState(false); // Phase 3: 批量重分配
  const [bulkReassignProfile, setBulkReassignProfile] = useState('');
  const [showBulkPriority, setShowBulkPriority] = useState(false); // Phase 3: 批量改优先级
  const [bulkPriority, setBulkPriority] = useState('');

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getKanbanBoard(currentBoard);
      const tasks = normalizeBoardData(result);
      setApiTasks(tasks);
      // 🔴 对齐 Hermes board.tsx L1131-1145：选中集自动修剪已离板/已删除的
      //   id——否则批量操作可能命中死 id（部分失败/误操作）
      setCheckedIds(prev => {
        if (!prev || prev.size === 0) return prev;
        const live = new Set(tasks.map(t => t.id));
        const next = new Set([...prev].filter(id => live.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (err) {
      console.error('[KanbanPanel] Failed to load board:', err);
      setError('加载看板失败');
    } finally {
      setLoading(false);
    }
  }, [currentBoard]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  // 🔴 对齐 Hermes socket 事件帧精确失效（drawer.tsx L556-561）：SSE 事件
  //   到达时递增 tick，打开中的详情抽屉监听并秒级重拉——此前抽屉 detail
  //   只靠 30s 轮询，评论/回收/状态变更最长滞后 30s（审查 d4-1）
  const [detailRefreshTick, setDetailRefreshTick] = useState(0);
  const onSseEventsRef = useRef<(events: KanbanEvent[]) => void>(() => {});
  onSseEventsRef.current = (events: KanbanEvent[]) => {
    if (events.length > 0) setDetailRefreshTick(t => t + 1);
  };
  useKanbanSSE(currentBoard, setApiTasks, loadBoard, (events) => onSseEventsRef.current(events));

  // Phase 4: 加载看板列表
  useEffect(() => {
    getKanbanBoards().then(data => {
      const list = data?.boards || data || [];
      setBoards(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  // Phase 4.8: 加载配置覆盖陈旧度阈值
  useEffect(() => {
    getKanbanConfig().then(data => {
      if (data?.stale_thresholds) {
        updateStaleConfig(data.stale_thresholds);
      }
    }).catch(() => {});
  }, []);

  // 🔴 对齐 Hermes useOrchestration/useDefaultAssignee：profiles + 编排配置
  //   挂载即加载（此前仅诊断面板打开时加载一次——负责人下拉/默认负责人
  //   路由依赖"面板打开史"，行为不确定）
  useEffect(() => {
    getKanbanProfiles().then(data => setProfiles(data?.profiles || data || [])).catch(() => setProfiles([]));
    getKanbanOrchestration().then(data => setOrchestration(data?.orchestration || data || null)).catch(() => setOrchestration(null));
  }, []);

  // Phase 4: 加载诊断 & Worker & 编排 & Profile
  useEffect(() => {
    if (showDiagnostics) {
      getKanbanDiagnostics(currentBoard).then(data => setDiagnostics(data)).catch(() => setDiagnostics(null));
    }
    if (showWorkers) {
      getKanbanActiveWorkers(currentBoard).then(data => setActiveWorkers(data?.workers || data || [])).catch(() => setActiveWorkers([]));
    }
  }, [showDiagnostics, showWorkers, currentBoard]);

  // Phase 4: 选中任务时加载 home channels
  useEffect(() => {
    if (selectedTask?.id) {
      getKanbanHomeChannels(selectedTask.id, currentBoard).then(data => setHomeChannels(data?.channels || data || [])).catch(() => setHomeChannels([]));
    }
  }, [selectedTask?.id, currentBoard]);

  useEffect(() => { const i = setInterval(() => loadBoard(), 60000); return () => clearInterval(i); }, [loadBoard]);

  // 🔴 2026-08-15 前端普查待办②：monitorState prop 悬空清理——KanbanWindowApp
  // 从不传 delegateTasks，合并链恒为空对象（mergeTasks 空输入原样返回，此处
  // 直接 apiTasks 行为逐字节等价）。subagent 任务在看板的呈现属未来特性
  // （如需再接，用 SubagentMonitor 数据源 + 显式接线，不走隐式 prop）。
  const allTasks = useMemo(() => apiTasks, [apiTasks]);

  // 搜索 + 负责人过滤
  const filteredTasks = useMemo(() => {
    let result = allTasks;
    // 负责人筛选
    if (assigneeFilter.size > 0) {
      result = result.filter(t => t.assignee && assigneeFilter.has(t.assignee));
    }
    // 关键词搜索（含body）
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.assignee || '').toLowerCase().includes(q) ||
        (t.body || '').toLowerCase().includes(q) ||
        String(t.id).toLowerCase().includes(q) ||
        (t.priority && `p${String(t.priority).replace(/^p/i,'')}`.includes(q))
      );
    }
    // 状态筛选
    if (statusFilter.size > 0) {
      result = result.filter(t => statusFilter.has(taskColumn(t)));
    }
    // 租户筛选 — 🔴 修复：后端字段是 task.tenant（此前 normalizeTask 丢弃 tenant、
    //   只在恒空的 tags 上匹配，筛选永不生效）
    if (tenantFilter.trim()) {
      const tenantQ = tenantFilter.toLowerCase();
      result = result.filter(t =>
        (t.tenant || '').toLowerCase().includes(tenantQ) ||
        (t.tags || []).some((tag: string) => String(tag).toLowerCase().includes(tenantQ))
      );
    }
    return result;
  }, [allTasks, searchQuery, assigneeFilter, statusFilter, tenantFilter]);

  // 分组 + Running 列 Lane 分组（Phase 4.2）
  const grouped: Record<string, KanbanTask[]> = useMemo(() => {
    const result: Record<string, KanbanTask[]> = {};
    for (const col of COLUMNS) result[col.key] = [];
    for (const t of filteredTasks) {
      const ck = taskColumn(t);
      if (result[ck]) result[ck].push(t);
    }
    return result;
  }, [filteredTasks]);

  // Running 列按 assignee 分 Lane（Phase 4.2）
  // 🔴 对齐 Hermes $lanesByProfile（board.tsx L366-383）：Running 分组可选开关，
  //   默认关=平铺，开=按 assignee 分 lane；localStorage 持久化（审查 P1-5）——
  //   此前恒分组，小规模看板下视觉层级冗余
  const [groupRunning, setGroupRunning] = useState<boolean>(() => {
    try { return localStorage.getItem('eleve.kanban.groupRunning') === '1'; } catch { return false; }
  });
  const toggleGroupRunning = useCallback(() => {
    setGroupRunning(prev => {
      const next = !prev;
      try { localStorage.setItem('eleve.kanban.groupRunning', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  const runningLanes = useMemo(() => {
    const runningTasks = grouped.running || [];
    if (runningTasks.length === 0) return [];
    if (!groupRunning) {
      // 平铺：单 lane（对齐 Hermes 默认不分组）
      return [['全部', runningTasks] as [string, KanbanTask[]]];
    }
    const laneMap = new Map();
    for (const t of runningTasks) {
      const key = t.assignee || '未分配';
      if (!laneMap.has(key)) laneMap.set(key, []);
      laneMap.get(key).push(t);
    }
    return Array.from(laneMap.entries());
  }, [grouped.running, groupRunning]);

  // 创建 ready 任务后 400ms 防抖立即触发一次调度（对齐 Hermes nudgeDispatcher）：
  // 任务不等后端 30s tick 就被 claim+spawn；fire-and-forget，失败由 tick 兜底。
  // （前置声明：handleDrop/handleDeleteTask 写操作后也调用）
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeDispatch = useCallback((board: string) => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => {
      nudgeTimerRef.current = null;
      dispatchKanbanTasks({ board, dry_run: false }).catch(() => { /* tick 兜底 */ });
    }, 400);
  }, []);

  // 拖拽 drop 处理 — 对齐 Eleve: 破坏性确认 + completion summary + 状态门控
  // 🔴 修复（对齐 Hermes LOCKED_COLUMNS + 后端 transition_status 各路径 WHERE 门控）：
  // - running：调度器 claim 独占，transition_status 显式拒绝任何直设，拖入即 400
  // - scheduled：需定时唤醒时间，裸 status 拖入产生 scheduled_at=0 的悬挂卡
  // - done：仅 ready/running/blocked 可完成（complete_task 门控），且必须带完成摘要
  // - blocked：仅 running/ready 可阻塞（block_task 门控）
  const handleDrop = useCallback(async (columnKey: string, taskId: string) => {
    const newStatus = COLUMN_STATUS[columnKey];
    if (!newStatus) return;

    const task = apiTasks.find(t => t.id === taskId);
    const from = task?.status || '';

    // 锁定列：review/running/scheduled 列级已拒绝（dropEffect none），此处兜底防穿透。
    // 🔴 review 加入锁定（对齐 Hermes LOCKED_COLUMNS，2026-08 一等评审生命周期）；
    //   提示改用应用内 notify（对齐 Hermes lockedReason toast，替代原生 alert）
    if (newStatus === 'review' || newStatus === 'running' || newStatus === 'scheduled') {
      notify({
        kind: 'warning',
        title: '不能移动到「' + (COLUMNS.find(c => c.key === newStatus)?.label ?? newStatus) + '」',
        message: LOCKED_REASON[newStatus] ?? '该列由系统独占',
      });
      return;
    }

    // 源状态门控（对齐后端 complete_task/block_task 的 WHERE 子句）
    const ALLOWED_FROM: Record<string, string[]> = {
      done: ['ready', 'running', 'blocked', 'review'],
      blocked: ['running', 'ready'],
    };
    if (ALLOWED_FROM[newStatus] && task && !ALLOWED_FROM[newStatus].includes(from)) {
      notify({
        kind: 'warning',
        title: '无法移动到「' + (COLUMNS.find(c => c.key === newStatus)?.label ?? newStatus) + '」',
        message: `当前状态「${from}」不允许该转换（后端门控，对齐 Hermes）。`,
      });
      return;
    }

    if (newStatus === 'done') {
      // 🔴 review → done 免摘要（对齐 Hermes 2026-08：complete_task 门控含 review，
      //   无摘要时后端合成 'Review approved without additional evidence.'）；
      //   其余状态保持完成摘要流程
      const isReview = task?.status === 'review';
      if (!isReview) {
        const summary = prompt('请输入完成摘要（必填）：');
        if (summary === null) return; // 用户取消
        if (!summary.trim()) {
          alert('完成摘要不能为空，操作已取消。');
          return;
        }
        // 乐观更新
        setApiTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
        try {
          await updateKanbanTask(taskId, { status: newStatus, result: summary.trim(), summary: summary.trim() }, currentBoard);
          // 🔴 对齐 Hermes api.ts L168-188：写操作后 nudge dispatcher——
          //   移入 done 立即促进依赖子任务，不等 60s tick
          nudgeDispatch(currentBoard);
        } catch (err) {
          console.error('[KanbanPanel] Drag drop failed, rolling back:', err);
          await loadBoard();
        }
        return;
      }
      // review → done：直接 PATCH（无摘要，后端合成）
      setApiTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
      try {
        await updateKanbanTask(taskId, { status: newStatus }, currentBoard);
        nudgeDispatch(currentBoard);
      } catch (err) {
        console.error('[KanbanPanel] Review approve failed, rolling back:', err);
        await loadBoard();
      }
      return;
    }

    if (newStatus === 'blocked') {
      if (!confirm('确认将此任务标记为阻塞？')) return;
    }
    if (newStatus === 'archived') {
      if (!confirm('确认归档此任务？')) return;
    }

    // 乐观更新：立即移动卡片
    setApiTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    try {
      await updateKanbanTask(taskId, { status: newStatus }, currentBoard);
      // 🔴 对齐 Hermes：拖拽换状态后 nudge（ready 任务立即被 claim+spawn）
      nudgeDispatch(currentBoard);
    } catch (err) {
      console.error('[KanbanPanel] Drag drop failed, rolling back:', err);
      await loadBoard(); // 回滚：重新加载真实数据
    }
  }, [loadBoard, apiTasks, currentBoard, nudgeDispatch]);

  // 创建任务 → 从创建抽屉提交
  const resetCreateForm = useCallback(() => {
    setNewTitle(''); setNewBody(''); setNewAssignee(''); setNewPriority('');
    setNewSkills(''); setNewParent(''); setNewGoalMode(false); setNewGoalMaxTurns('20');
    setNewWorkspaceKind(''); setNewWorkspacePath(''); setNewModelOverride('');
    setNewProviderOverride(''); setNewReasoningEffort('');
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      // Eleve 仪表盘对齐：不发送 status 字段，只发 triage 标志，让后端决定状态
      const payload: Record<string, unknown> = { title: newTitle.trim(), board: currentBoard };
      if (newBody.trim()) payload.body = newBody.trim();
      // assignee（对齐 Hermes NewTaskDialog）：PARKED 显式停放（parked=true，
      //   后端不兜底、dispatcher 不 spawn）；用户指定 > 后端 default_assignee 兜底
      //   （不发送 assignee 时后端 config 兜底，对齐 Hermes resolved_default_assignee）
      const PARKED = '__parked__';
      if (newAssignee.trim() === PARKED) {
        payload.parked = true;
      } else if (newAssignee.trim()) {
        payload.assignee = newAssignee.trim();
      }
      // 空 → 不发送 assignee，后端 default_assignee 兜底
      if (Number(newPriority)) payload.priority = Number(newPriority);
      if (newSkills.trim()) payload.skills = newSkills.trim();
      if (newParent) payload.parents = [newParent];
      if (newGoalMode) { payload.goal_mode = true; payload.goal_max_turns = Number(newGoalMaxTurns) || 20; }
      // 工作区类型/路径（对齐 Hermes：'' = 继承看板 default_workspace_kind，
      // 后端 create_task 兜底；路径仅 dir/worktree 生效，scratch 忽略）
      if (newWorkspaceKind) payload.workspace_kind = newWorkspaceKind;
      if (newWorkspaceKind && newWorkspaceKind !== 'scratch' && newWorkspacePath.trim()) {
        payload.workspace_path = newWorkspacePath.trim();
      }
      // 模型覆盖（对齐 Hermes 三元组：model_override + provider_override +
      // reasoning_effort；'' 不发送 = 继承 profile）
      if (newModelOverride.trim()) payload.model_override = newModelOverride.trim();
      if (newModelOverride.trim() && newProviderOverride.trim()) payload.provider_override = newProviderOverride.trim();
      if (newReasoningEffort.trim()) payload.reasoning_effort = newReasoningEffort.trim();
      if (creatingIn === 'triage') payload.triage = true;
      const result = await createKanbanTask(payload);
      setCreatingIn(null);
      resetCreateForm();
      // 标记新创建的卡片
      const newId = result?.id || result?.task_id;
      if (newId) {
        setJustCreatedIds(prev => new Set([...prev, newId]));
        setTimeout(() => setJustCreatedIds(prev => { const next = new Set(prev); next.delete(newId); return next; }), 3000);
      }
      // 🔴 修复（对齐 Hermes NewTaskDialog：create 后 status 与目标列不一致时 patch 落位）：
      // create_task 无 parents 默认落 'ready'（triage 标志落 'triage'），在
      // todo 列内联创建会落错列——transition_status 对这些列直通
      // set_status_direct（合法），创建成功后补一次 patch 到目标列。
      // 🔴 review 已移出 canCreate（对齐 Hermes 锁定列语义），白名单同步收敛；
      //   triage 由后端直接落位无需补丁
      const createdStatus = result?.task?.status || result?.status;
      if (newId && creatingIn && createdStatus && createdStatus !== creatingIn
        && ['todo', 'ready'].includes(creatingIn)) {
        try { await updateKanbanTask(newId, { status: creatingIn }, currentBoard); } catch { /* 门控拒绝则留在后端落位状态 */ }
      }
      await loadBoard();
      // 创建成功即 nudge：新卡落 ready（或 todo→父完成→ready）立即被调度
      nudgeDispatch(currentBoard);
    } catch (err) {
      console.error('[KanbanPanel] Create task failed:', err);
      // 让调用方（CreateTaskDrawer）能感知失败并展示错误
      throw err;
    }
  }, [currentBoard, creatingIn, newTitle, newBody, newAssignee, newPriority, newSkills, newParent, newGoalMode, newGoalMaxTurns, newWorkspaceKind, newWorkspacePath, newModelOverride, loadBoard, orchestration, nudgeDispatch]);

  // 操作
  const handleAction = useCallback(async (action: string, taskId: string) => {
    setLoadingId(taskId);
    try {
      switch (action) {
        // 对齐 Hermes：不能直接设 running，只能 promote 到 ready 由 dispatcher claim
        case 'promote': await updateKanbanTask(taskId, { status: 'ready' }, currentBoard); break;
        // blocked/scheduled → ready（gateway 自动路由 unblock_task）
        case 'unblock': await updateKanbanTask(taskId, { status: 'ready' }, currentBoard); break;
        case 'complete': {
          // 🔴 修复：complete_task 要求至少 summary/result 之一且源状态
          //   门控 IN ('running','ready','blocked')——原实现裸发 {status:'done'}
          //   恒 400（"at least one of summary or result must be provided"）。
          //   与拖拽完成路径同语义：先收摘要再提交。
          // 🔴 对齐 Hermes 2026-08：门控含 review——评审卡可人工直接通过，
          //   无摘要时后端合成 'Review approved without additional evidence.'
          const task = apiTasks.find(t => t.id === taskId);
          if (task && !['ready', 'running', 'blocked', 'review'].includes(task.status)) {
            alert(`无法完成该任务：当前状态为「${task.status}」。只有 ready/running/blocked/review 状态的任务可直接完成（对齐 Hermes complete_task 门控）。`);
            break;
          }
          if (task?.status === 'review') {
            await updateKanbanTask(taskId, { status: 'done' }, currentBoard);
            break;
          }
          const summary = prompt('请输入完成摘要（必填）：');
          if (summary === null) break;
          if (!summary.trim()) { alert('完成摘要不能为空，操作已取消。'); break; }
          await updateKanbanTask(taskId, { status: 'done', result: summary.trim(), summary: summary.trim() }, currentBoard);
          break;
        }
        case 'block': await updateKanbanTask(taskId, { status: 'blocked' }, currentBoard); break;
        // 🔴 对齐 Hermes 2026-08 一等评审生命周期：提交评审（running/ready → review）。
        //   运行中任务默认拒绝（live-claim 防窃取），需用户确认 force 覆盖
        case 'requestReview': {
          const task = apiTasks.find(t => t.id === taskId);
          if (task && !['running', 'ready'].includes(task.status)) {
            notify({
              kind: 'warning',
              title: '无法提交评审',
              message: `当前状态「${task.status}」不允许提交评审（仅 running/ready，对齐 Hermes request_review）。`,
            });
            break;
          }
          const running = task?.status === 'running';
          if (running && !confirm('任务正在运行中，提交评审将清空 worker 的 claim（需显式覆盖，对齐 Hermes force 语义）。确认继续？')) break;
          await requestKanbanReview(taskId, { force: running }, currentBoard);
          notify({ kind: 'success', title: '已提交评审', message: `任务 ${taskId} 已进入评审列` });
          break;
        }
        // 评审退回返工（活动 review run → changes_requested）
        case 'requestChanges': {
          const reason = prompt('请输入退回理由（必填）：');
          if (reason === null) break;
          if (!reason.trim()) { alert('退回理由不能为空，操作已取消。'); break; }
          await requestKanbanChanges(taskId, reason.trim(), currentBoard);
          break;
        }
        // 滞留：running/ready → scheduled（gateway 走 schedule_task 关 run 清 claim）
        case 'schedule': await updateKanbanTask(taskId, { status: 'scheduled' }, currentBoard); break;
        case 'reclaim': await reclaimKanbanTask(taskId, 'manual reclaim', currentBoard); break;
        case 'archive': await updateKanbanTask(taskId, { status: 'archived' }, currentBoard); break;
        case 'delete': await deleteKanbanTask(taskId, currentBoard); break;
        // Phase 4.3: 分解/指定
        case 'decompose': await decomposeKanbanTask(taskId, 'user', currentBoard); break;
        case 'specify': await specifyKanbanTask(taskId, 'user', currentBoard); break;
        // Phase 4.6: 终止 run
        case 'terminate': await terminateKanbanRun(taskId, 'manual', currentBoard); break;
        // Phase 4.7: 订阅/取消订阅
        case 'subscribe': await subscribeKanbanHome(taskId, 'weixin', currentBoard); break;
        case 'unsubscribe': await unsubscribeKanbanHome(taskId, 'weixin', currentBoard); break;
        // Phase B5: 重分配
        case 'reassign': setShowReassign(true); setReassignProfile(''); setReassignReclaim(false); break;
      }
      await loadBoard();
      if (action === 'delete' || action === 'archive') setSelectedTask(null);
      // 🔴 对齐 Hermes api.ts L168-188：写操作后 nudge dispatcher——完成/阻塞/
      //   滞留/回收/归档/终止等全部动作立即促进调度，不等 60s tick（审查 P1-3）
      nudgeDispatch(currentBoard);
    } catch (err) {
      console.error(`[KanbanPanel] Action ${action} failed:`, err);
    } finally {
      setLoadingId(null);
    }
  }, [loadBoard, apiTasks, currentBoard, nudgeDispatch]);

  // checkbox 切换
  const handleCheck = useCallback((taskId: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  // 批量操作 → 确认弹窗 → 调 bulkUpdateKanbanTasks（Phase 4.10）
  const handleBulkAction = useCallback(async (action: string) => {
    if (checkedIds.size === 0) return;
    // 危险操作需确认
    if (action === 'delete' || action === 'archive') {
      setBulkConfirmAction(action);
      return;
    }
    await executeBulkAction(action);
  }, [checkedIds]);

  const executeBulkAction = useCallback(async (action: string) => {
    const ids = Array.from(checkedIds);
    setBulkConfirmAction(null);
    try {
      // 🔴 对齐 Hermes SelectionBar（board.tsx L1014-1068）：批量移动到列 /
      //   取消分配；部分失败 toast『N of M failed』且失败卡保持选中（审查 P1-9）
      let results: Array<{ id: string; ok: boolean; error?: string }> | null = null;
      if (action === 'delete') {
        // 🔴 修复：后端 bulk 端点无 delete 语义——逐个删除（对齐 Hermes bulkDelete 扇出）
        const settled = await Promise.allSettled(ids.map(id => deleteKanbanTask(id, currentBoard)));
        results = ids.map((id, i) => ({
          id,
          ok: settled[i].status === 'fulfilled',
          error: settled[i].status === 'rejected' ? String((settled[i] as PromiseRejectedResult).reason ?? '') : undefined,
        }));
      } else if (action === 'complete') {
        const res = await bulkUpdateKanbanTasks(ids, { status: 'done' }, currentBoard);
        results = res?.results || null;
      } else if (action === 'archive') {
        const res = await bulkUpdateKanbanTasks(ids, { archive: true }, currentBoard);
        results = res?.results || null;
      } else if (action === 'unassign') {
        // 🔴 批量取消分配（对齐 Hermes SelectionBar Unassign）：空串 = 后端写 NULL
        const res = await bulkUpdateKanbanTasks(ids, { assignee: '' }, currentBoard);
        results = res?.results || null;
      } else if (action.startsWith('move:')) {
        // 🔴 批量移动到列（对齐 Hermes SelectionBar Move to，锁定列已在前端过滤）
        const target = action.slice('move:'.length);
        const res = await bulkUpdateKanbanTasks(ids, { status: target }, currentBoard);
        results = res?.results || null;
      } else {
        await bulkUpdateKanbanTasks(ids, {}, currentBoard);
      }

      // 部分失败反馈（对齐 Hermes board.tsx L969-980）：失败卡保留在选中集
      let failedIds: string[] = [];
      if (results) {
        failedIds = results.filter(r => !r.ok).map(r => r.id);
        if (failedIds.length > 0) {
          notify({
            kind: 'warning',
            title: '批量操作部分失败',
            message: `${ids.length - failedIds.length}/${ids.length} 成功，${failedIds.length} 个失败（已保持选中，可重试）`,
          });
          setCheckedIds(new Set(failedIds));
        } else {
          setCheckedIds(new Set());
        }
      } else {
        setCheckedIds(new Set());
      }
      await loadBoard();
      // 🔴 对齐 Hermes api.ts L168-188：批量完成后 nudge——移入 done 立即
      //   促进依赖子任务、归档释放容量，不等 60s tick（审查 P1-3）
      nudgeDispatch(currentBoard);
    } catch (err) {
      console.error('[KanbanPanel] Bulk action failed:', err);
    }
  }, [checkedIds, currentBoard, loadBoard, nudgeDispatch]);

  // Phase 3: 批量重分配
  const handleBulkReassign = useCallback(async () => {
    if (!bulkReassignProfile.trim() || checkedIds.size === 0) return;
    const ids = Array.from(checkedIds);
    try {
      for (const id of ids) {
        await reassignKanbanTask(id, bulkReassignProfile.trim(), true, '', currentBoard);
      }
      setCheckedIds(new Set());
      setShowBulkReassign(false);
      setBulkReassignProfile('');
      await loadBoard();
      // 🔴 对齐 Hermes：重分配后 nudge（新 profile 可能立即被调度）
      nudgeDispatch(currentBoard);
    } catch (err) {
      console.error('[KanbanPanel] Bulk reassign failed:', err);
    }
  }, [checkedIds, bulkReassignProfile, currentBoard, loadBoard, nudgeDispatch]);

  // Phase 3: 批量改优先级
  const handleBulkPriority = useCallback(async () => {
    if (!bulkPriority || checkedIds.size === 0) return;
    const ids = Array.from(checkedIds);
    try {
      // 🔴 修复：后端 bulk_update_tasks 读顶层 priority（此前塞进 data.action 恒被忽略）
      await bulkUpdateKanbanTasks(ids, { priority: Number(bulkPriority) }, currentBoard);
      setCheckedIds(new Set());
      setShowBulkPriority(false);
      setBulkPriority('');
      await loadBoard();
      // 🔴 对齐 Hermes：改优先级后 nudge（高优先级任务应被立即调度）
      nudgeDispatch(currentBoard);
    } catch (err) {
      console.error('[KanbanPanel] Bulk priority failed:', err);
    }
  }, [checkedIds, bulkPriority, currentBoard, loadBoard, nudgeDispatch]);

  // 删除任务
  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteKanbanTask(taskId, currentBoard);
      setSelectedTask(null);
      loadBoard();
      // 🔴 对齐 Hermes：删除后 nudge（删除可能解除依赖门控，立即促进）
      nudgeDispatch(currentBoard);
    } catch (err) {
      console.error('[KanbanPanel] Delete task failed:', err);
    }
  }, [currentBoard, loadBoard, nudgeDispatch]);

  // Phase 4.1: 切换看板
  const handleSwitchBoard = useCallback(async (slug: string) => {
    try {
      await switchKanbanBoard(slug);
      setCurrentBoard(slug);
      setShowBoardPicker(false);
    } catch (err) {
      console.error('[KanbanPanel] Switch board failed:', err);
    }
  }, []);

  // Phase A1: 新建看板
  const handleCreateBoard = useCallback(async () => {
    const name = newBoardName.trim();
    if (!name) return;
    // slug: 从 name 自动生成（小写+连字符）
    const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || `board-${Date.now()}`;
    setCreatingBoard(true);
    try {
      await createKanbanBoard(slug, name, newBoardDesc.trim() || "", "", newBoardColor.trim() || "", true);
      // 创建并切换成功，刷新列表和看板
      const data = await getKanbanBoards();
      const list = data?.boards || data || [];
      setBoards(Array.isArray(list) ? list : []);
      setCurrentBoard(slug);
      setShowBoardPicker(false);
      setShowCreateBoard(false);
      setNewBoardName('');
      setNewBoardDesc('');
      setNewBoardColor('');
    } catch (err) {
      console.error('[KanbanPanel] Create board failed:', err);
    } finally {
      setCreatingBoard(false);
    }
  }, [newBoardName, newBoardDesc, newBoardColor]);

  // Phase A2: 删除看板
  const handleDeleteBoard = useCallback(async () => {
    if (!deleteBoardTarget) return;
    try {
      await deleteKanbanBoard(deleteBoardTarget.slug, deletePermanently);
      // 如果删除的是当前看板，切回 default
      if (deleteBoardTarget.slug === currentBoard) {
        await switchKanbanBoard('default');
        setCurrentBoard('default');
      }
      // 刷新看板列表
      const data = await getKanbanBoards();
      const list = data?.boards || data || [];
      setBoards(Array.isArray(list) ? list : []);
      setDeleteBoardTarget(null);
      setDeletePermanently(false);
      setShowBoardPicker(false);
    } catch (err) {
      console.error('[KanbanPanel] Delete board failed:', err);
    }
  }, [deleteBoardTarget, deletePermanently, currentBoard]);

  // Phase A3: 编辑看板
  const handleUpdateBoard = useCallback(async () => {
    if (!editBoardTarget) return;
    const name = editBoardName.trim();
    if (!name) return;
    setSavingBoard(true);
    try {
      await updateKanbanBoard(editBoardTarget.slug, {
        name,
        description: editBoardDesc.trim() || undefined,
        color: editBoardColor.trim() || undefined,
      });
      // 刷新看板列表
      const data = await getKanbanBoards();
      const list = data?.boards || data || [];
      setBoards(Array.isArray(list) ? list : []);
      setEditBoardTarget(null);
      setEditBoardName('');
      setEditBoardDesc('');
      setEditBoardColor('');
      setShowBoardPicker(false);
    } catch (err) {
      console.error('[KanbanPanel] Update board failed:', err);
    } finally {
      setSavingBoard(false);
    }
  }, [editBoardTarget, editBoardName, editBoardDesc, editBoardColor]);

  // Phase B1: 加载统计
  useEffect(() => {
    if (showStats) {
      getKanbanStats(currentBoard).then(data => {
        setBoardStats(data?.stats || data || null);
      }).catch(() => setBoardStats(null));
    }
  }, [showStats, currentBoard]);

  // Phase B2: 加载负责人列表
  useEffect(() => {
    if (showAssigneeFilter) {
      getKanbanAssignees(currentBoard).then(data => {
        const list = data?.assignees || data || [];
        setAssigneeList(Array.isArray(list) ? list : []);
      }).catch(() => setAssigneeList([]));
    }
  }, [showAssigneeFilter, currentBoard]);

  // Phase B5: 重分配
  const handleReassign = useCallback(async () => {
    if (!selectedTask?.id || !reassignProfile.trim()) return;
    setReassigning(true);
    try {
      await reassignKanbanTask(selectedTask.id, reassignProfile.trim(), reassignReclaim, '', currentBoard);
      await loadBoard();
      setShowReassign(false);
      setReassignProfile('');
      setReassignReclaim(false);
    } catch (err) {
      console.error('[KanbanPanel] Reassign failed:', err);
    } finally {
      setReassigning(false);
    }
  }, [selectedTask, reassignProfile, reassignReclaim, currentBoard, loadBoard]);

  // 全局键盘快捷键 — Trail 风格
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 忽略输入框内的按键
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setCreatingIn('triage'); }
      if (e.key === '/' ) { e.preventDefault(); (document.querySelector('[data-kanban-search]') as HTMLElement)?.focus(); }
      // 🔴 对齐 Hermes board.tsx L1147-1161：Esc 仅在有选中集时清空选中
      //   （抽屉关闭由抽屉自身 Esc 处理，不再全局连带关抽屉）
      if (e.key === 'Escape') {
        setCheckedIds(prev => {
          if (!prev || prev.size === 0) return prev;
          return new Set();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
    apiTasks,
    setApiTasks,
    // 🔴 SSE 事件 tick：详情抽屉监听后秒级重拉（对齐 Hermes socket 失效）
    detailRefreshTick,
    loading,
    setLoading,
    error,
    setError,
    loadingId,
    setLoadingId,
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
    newSkills,
    setNewSkills,
    newParent,
    setNewParent,
    newGoalMode,
    setNewGoalMode,
    newGoalMaxTurns,
    setNewGoalMaxTurns,
    searchQuery,
    setSearchQuery,
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
    groupRunning,
    toggleGroupRunning,
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
    handleReassign,
  };

}

