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
import type { KanbanTask } from './types';
import { COLUMNS, COLUMN_STATUS, updateStaleConfig } from './constants';
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
  const [newWorkspaceKind, setNewWorkspaceKind] = useState('scratch');
  const [newWorkspacePath, setNewWorkspacePath] = useState('');
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
      setApiTasks(normalizeBoardData(result));
    } catch (err) {
      console.error('[KanbanPanel] Failed to load board:', err);
      setError('加载看板失败');
    } finally {
      setLoading(false);
    }
  }, [currentBoard]);

  useEffect(() => { loadBoard(); }, [loadBoard]);
  useKanbanSSE(currentBoard, setApiTasks, loadBoard);

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

  // Phase 4: 加载诊断 & Worker & 编排 & Profile
  useEffect(() => {
    if (showDiagnostics) {
      getKanbanDiagnostics(currentBoard).then(data => setDiagnostics(data)).catch(() => setDiagnostics(null));
      getKanbanOrchestration().then(data => setOrchestration(data?.orchestration || data || null)).catch(() => setOrchestration(null));
      getKanbanProfiles().then(data => setProfiles(data?.profiles || data || [])).catch(() => setProfiles([]));
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
  const runningLanes = useMemo(() => {
    const runningTasks = grouped.running || [];
    if (runningTasks.length === 0) return [];
    const laneMap = new Map();
    for (const t of runningTasks) {
      const key = t.assignee || '未分配';
      if (!laneMap.has(key)) laneMap.set(key, []);
      laneMap.get(key).push(t);
    }
    return Array.from(laneMap.entries());
  }, [grouped.running]);

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

    // 锁定列：running/scheduled 列级已拒绝（dropEffect none），此处兜底防穿透
    if (newStatus === 'running' || newStatus === 'scheduled') {
      alert(newStatus === 'running'
        ? '不能直接拖入「进行中」：running 由调度器 claim 启动（对齐 Hermes：只能 promote 到 ready）。'
        : '不能直接拖入「已排期」：scheduled 需要定时唤醒时间，请使用抽屉/操作栏的「滞留」显式执行。');
      return;
    }

    // 源状态门控（对齐后端 complete_task/block_task 的 WHERE 子句）
    const ALLOWED_FROM: Record<string, string[]> = {
      done: ['ready', 'running', 'blocked'],
      blocked: ['running', 'ready'],
    };
    if (ALLOWED_FROM[newStatus] && task && !ALLOWED_FROM[newStatus].includes(from)) {
      alert(`无法移动到「${newStatus}」：当前状态「${from}」不允许该转换（后端门控，对齐 Hermes）。`);
      return;
    }

    if (newStatus === 'done') {
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
      } catch (err) {
        console.error('[KanbanPanel] Drag drop failed, rolling back:', err);
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
    } catch (err) {
      console.error('[KanbanPanel] Drag drop failed, rolling back:', err);
      await loadBoard(); // 回滚：重新加载真实数据
    }
  }, [loadBoard, apiTasks, currentBoard]);

  // 创建任务 → 从创建抽屉提交
  const resetCreateForm = useCallback(() => {
    setNewTitle(''); setNewBody(''); setNewAssignee(''); setNewPriority('');
    setNewSkills(''); setNewParent(''); setNewGoalMode(false); setNewGoalMaxTurns('20');
    setNewWorkspaceKind('scratch'); setNewWorkspacePath('');
  }, []);

  // 创建 ready 任务后 400ms 防抖立即触发一次调度（对齐 Hermes nudgeDispatcher）：
  // 任务不等后端 30s tick 就被 claim+spawn；fire-and-forget，失败由 tick 兜底。
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeDispatch = useCallback((board: string) => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => {
      nudgeTimerRef.current = null;
      dispatchKanbanTasks({ board, dry_run: false }).catch(() => { /* tick 兜底 */ });
    }, 400);
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      // Eleve 仪表盘对齐：不发送 status 字段，只发 triage 标志，让后端决定状态
      const payload: Record<string, unknown> = { title: newTitle.trim(), board: currentBoard };
      if (newBody.trim()) payload.body = newBody.trim();
      // assignee: 用户指定 > default_assignee > 'default'
      // 🔴 修复：get_kanban_orchestration 返回 { ok, config }，default 键是
      //   config.default_assignee（此前读 orchestration.default_profile 恒 undefined，
      //   创建任务永远落 'default'）
      const effectiveAssignee = newAssignee.trim()
        || orchestration?.config?.default_assignee
        || 'default';
      payload.assignee = effectiveAssignee;
      if (Number(newPriority)) payload.priority = Number(newPriority);
      if (newSkills.trim()) payload.skills = newSkills.trim();
      if (newParent) payload.parents = [newParent];
      if (newGoalMode) { payload.goal_mode = true; payload.goal_max_turns = Number(newGoalMaxTurns) || 20; }
      // 工作区类型/路径（后端 create_task 校验 workspace_kind ∈ scratch/dir/worktree；
      // 路径仅 dir/worktree 生效，scratch 忽略）
      payload.workspace_kind = newWorkspaceKind || 'scratch';
      if (newWorkspaceKind !== 'scratch' && newWorkspacePath.trim()) {
        payload.workspace_path = newWorkspacePath.trim();
      }
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
      // todo/review 列内联创建会落错列——transition_status 对这些列直通
      // set_status_direct（合法），创建成功后补一次 patch 到目标列。
      const createdStatus = result?.task?.status || result?.status;
      if (newId && creatingIn && createdStatus && createdStatus !== creatingIn
        && ['todo', 'ready', 'review'].includes(creatingIn)) {
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
  }, [currentBoard, creatingIn, newTitle, newBody, newAssignee, newPriority, newSkills, newParent, newGoalMode, newGoalMaxTurns, newWorkspaceKind, newWorkspacePath, loadBoard, orchestration, nudgeDispatch]);

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
          const task = apiTasks.find(t => t.id === taskId);
          if (task && !['ready', 'running', 'blocked'].includes(task.status)) {
            alert(`无法完成该任务：当前状态为「${task.status}」。只有 ready/running/blocked 状态的任务可直接完成（对齐 Hermes complete_task 门控）。`);
            break;
          }
          const summary = prompt('请输入完成摘要（必填）：');
          if (summary === null) break;
          if (!summary.trim()) { alert('完成摘要不能为空，操作已取消。'); break; }
          await updateKanbanTask(taskId, { status: 'done', result: summary.trim(), summary: summary.trim() }, currentBoard);
          break;
        }
        case 'block': await updateKanbanTask(taskId, { status: 'blocked' }, currentBoard); break;
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
    } catch (err) {
      console.error(`[KanbanPanel] Action ${action} failed:`, err);
    } finally {
      setLoadingId(null);
    }
  }, [loadBoard, apiTasks, currentBoard]);

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
      if (action === 'delete') {
        // 🔴 修复：后端 bulk 端点无 delete 语义——逐个删除（对齐 Hermes bulkDelete 扇出）
        await Promise.allSettled(ids.map(id => deleteKanbanTask(id, currentBoard)));
      } else if (action === 'complete') {
        // 🔴 修复：后端 bulk_update_tasks 读顶层 status/archive/priority 等字段，
        //   此前发送 { ids, data: { action } } 形状恒被忽略 → 批量操作静默失效
        await bulkUpdateKanbanTasks(ids, { status: 'done' }, currentBoard);
      } else if (action === 'archive') {
        await bulkUpdateKanbanTasks(ids, { archive: true }, currentBoard);
      } else {
        await bulkUpdateKanbanTasks(ids, {}, currentBoard);
      }
      setCheckedIds(new Set());
      await loadBoard();
    } catch (err) {
      console.error('[KanbanPanel] Bulk action failed:', err);
    }
  }, [checkedIds, currentBoard, loadBoard]);

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
    } catch (err) {
      console.error('[KanbanPanel] Bulk reassign failed:', err);
    }
  }, [checkedIds, bulkReassignProfile, currentBoard, loadBoard]);

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
    } catch (err) {
      console.error('[KanbanPanel] Bulk priority failed:', err);
    }
  }, [checkedIds, bulkPriority, currentBoard, loadBoard]);

  // 删除任务
  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteKanbanTask(taskId, currentBoard);
      setSelectedTask(null);
      loadBoard();
    } catch (err) {
      console.error('[KanbanPanel] Delete task failed:', err);
    }
  }, [currentBoard, loadBoard]);

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
      if (e.key === 'Escape') { setSelectedTask(null); setCheckedIds(new Set()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
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
    handleReassign,
  };

}

