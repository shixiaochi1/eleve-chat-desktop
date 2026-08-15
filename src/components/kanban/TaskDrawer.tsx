/**
 * 任务详情抽屉 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 * 含 StatusDot / AddLinkForm / MetaRow / ActionButton（仅本文件使用）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, ChevronDown, Edit3, Save, GitBranch, Paperclip, Download, Trash2,
  FileText, Radio, BellOff, Bell, Send, Play, Ban, Clock, CheckCircle2,
  ArrowLeftFromLine, Archive, Zap, Loader, Plus, AlertTriangle, Eye, Gauge,
  MoreHorizontal, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readFileAsDataURL, base64FromDataURL } from '@/utils/file';
import { getWsActiveProfile } from '@/services/ws-client';
import {
  getKanbanRun, getKanbanTask, getKanbanAttachments, addKanbanComment,
  updateKanbanTask, uploadKanbanAttachment, deleteKanbanAttachment,
  deleteKanbanLink, createKanbanLink, getKanbanTaskLog, getKanbanDiagnostics,
  getApiBase, getKanbanProfiles, reassignKanbanTask, estimateKanbanTaskById,
} from '@/utils/api';
import type { KanbanTask, CommentRecord, AttachmentRecord, RunRecord, KanbanEvent } from './types';
import { isBlocked, isDone, fmtAge, fmtDuration } from './helpers';
import { COLUMNS, LOCKED_DROP_COLUMNS } from './constants';
import { notify } from '../../utils/notifications';

// ═══════════════════════════════════════════════════════════════
// 子组件
// ═══════════════════════════════════════════════════════════════

/**
 * 事件 → 人类可读行（对齐 Hermes drawer eventText）：后端写机器 payload，
 * 已知 kind 转中文语义 + payload 细节；未知 kind 回退 kind + 键值摘要。
 */
function eventText(kind: string, payloadRaw: unknown): { detail?: string; label: string } {
  let p: Record<string, unknown> = {};
  if (typeof payloadRaw === 'string' && payloadRaw) {
    try { p = JSON.parse(payloadRaw) as Record<string, unknown>; } catch { return { label: kind.replace(/_/g, ' '), detail: payloadRaw }; }
  } else if (payloadRaw && typeof payloadRaw === 'object') {
    p = payloadRaw as Record<string, unknown>;
  }
  const str = (key: string): null | string => {
    const v = p[key];
    return typeof v === 'string' && v ? v : null;
  };
  switch (kind) {
    case 'created': return { label: `创建任务${str('status') ? `（状态 ${str('status')}）` : ''}` };
    case 'completed': return { label: '任务完成' };
    case 'blocked': return { label: '阻塞', detail: str('reason') ?? undefined };
    case 'unblocked': return { label: '解除阻塞' };
    case 'promoted': return { label: '提升为就绪' };
    case 'archived': return { label: '已归档' };
    case 'assigned': return { label: str('assignee') ? `分配给 ${str('assignee')}` : '重新分配' };
    case 'status': return { label: `状态变更 → ${str('status') ?? '?'}` };
    case 'claimed': return { label: '已被调度器认领' };
    case 'reclaimed': return { label: '已回收', detail: str('reason') ?? undefined };
    // 🔴 对齐 Hermes eventText 专案（此前回退英文 kind 直出）
    case 'spawned': return { label: 'worker 启动', detail: str('pid') ? `PID ${str('pid')}` : undefined };
    case 'reprioritized': return { label: '优先级变更', detail: str('priority') ?? undefined };
    case 'commented': return { label: '评论', detail: str('author') ?? undefined };
    case 'scheduled': return { label: '已排期', detail: str('reason') ?? undefined };
    case 'edited': return { label: '字段已编辑' };
    case 'heartbeat': return { label: 'worker 心跳' };
    case 'spawn_failed': return { label: 'worker 启动失败' };
    case 'gave_up': return { label: 'worker 放弃' };
    case 'crashed': return { label: 'worker 崩溃' };
    case 'timed_out': return { label: '运行超时' };
    case 'dependency_wait': return { label: '依赖等待', detail: str('reason') ?? undefined };
    case 'block_loop_detected': return { label: '阻塞循环检测', detail: `${str('reason') ?? ''} ×${p.recurrences ?? ''}` };
    case 'attached': case 'attachment_removed': return { label: '附件更新' };
    // 🔴 对齐 Hermes 2026-08 一等评审生命周期事件（review_requested /
    //   changes_requested / review_reopened）
    case 'review_requested': return {
      label: '提交评审',
      detail: [
        str('reviewer') ? `评审人 ${str('reviewer')}` : null,
        str('summary') ? str('summary') : null,
      ].filter(Boolean).join(' · ') || undefined,
    };
    case 'changes_requested': return { label: '评审退回返工', detail: str('reason') ?? undefined };
    case 'review_reopened': return {
      label: '评审重开',
      detail: str('implementer') ? `回到实现者 ${str('implementer')}` : undefined,
    };
    default: {
      const detail = Object.entries(p)
        .filter(([, v]) => v != null && typeof v !== 'object')
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ');
      return { label: kind.replace(/_/g, ' '), detail: detail || undefined };
    }
  }
}

/** 诊断恢复动作（对齐 Hermes DiagnosticAction） */
interface TaskDiagAction {
  kind: string;
  label: string;
  payload?: Record<string, unknown>;
  suggested?: boolean;
}
/** 结构化任务诊断（对齐 Hermes Diagnostic） */
interface TaskDiag {
  task_id: string;
  severity: string;
  title: string;
  detail: string;
  count?: number;
  actions?: TaskDiagAction[];
}

function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const s = (status || '').toLowerCase();
  const colorMap: Record<string, string> = {
    triage: 'var(--ui-purple)', todo: 'var(--ui-text-tertiary)',
    scheduled: 'var(--ui-cyan)', ready: 'var(--ui-yellow)', running: 'var(--ui-green)',
    blocked: 'var(--ui-red)', review: 'var(--ui-orange)',
    done: 'var(--ui-blue)', completed: 'var(--ui-blue)', archived: 'var(--ui-text-quaternary)',
  };
  return <span className="shrink-0 rounded-full" style={{ width: size, height: size, backgroundColor: colorMap[s] || colorMap.todo }} />;
}

// ── 添加依赖表单 ──
function AddLinkForm({ taskId, direction, onSubmit }: { taskId: string; direction: 'parent' | 'child'; onSubmit: (id: string) => Promise<void> }) {
  const [otherId, setOtherId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const label = direction === 'parent' ? '添加上游' : '添加下游';
  const placeholder = direction === 'parent' ? '父任务 ID' : '子任务 ID';
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = otherId.trim();
    if (!id) return;
    setSubmitting(true);
    try {
      await onSubmit(id);
      setOtherId('');
    } catch {}
    setSubmitting(false);
  };
  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5 mb-2">
      <span className="text-[0.7rem] text-[var(--ui-text-tertiary)] shrink-0">{label}</span>
      <input value={otherId} onChange={e => setOtherId(e.target.value)} placeholder={placeholder}
        className="flex-1 text-[0.7rem] px-2 py-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
      <button type="submit" disabled={submitting || !otherId.trim()}
        className="text-[0.7rem] px-2 py-1 rounded-md border border-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        <Plus size={11} strokeWidth={1.5} />
      </button>
    </form>
  );
}

// ── 详情抽屉（含评论+运行历史+附件+可编辑描述）──
interface TaskDrawerProps {
  task: KanbanTask | null;
  onClose: () => void;
  onAction: (action: string, taskId: string) => void;
  loadingId: string | null;
  onRefresh: () => void;
  homeChannels: Array<{ platform?: string } | string>;
  /** 当前看板 slug（🔴 修复：详情/评论/附件/链接 API 均需按板路由，缺省恒 default 错板） */
  board?: string;
  /** 点击依赖链接跳转到目标任务（对齐 Hermes drawer onOpen） */
  onOpenTask?: (id: string) => void;
  /** 外壳变体：'drawer'（默认，全屏遮罩 + 右侧滑出，主看板用）/
   *  'overlay'（容器内覆盖层圆角卡片，侧边栏用，与 CreateTaskDrawer overlay 一致） */
  variant?: 'drawer' | 'overlay';
  /** 状态下拉移动（对齐 Hermes StatusMenu；传 null/undefined 则头部仅静态色点）。
   *  调用方通常传 useKanban.handleDrop（含锁定/门控/摘要/确认/乐观更新） */
  onMoveStatus?: (status: string) => void;
  /** 🔴 SSE 事件 tick（对齐 Hermes socket 帧失效）：任一事件到达时递增，
   *   抽屉秒级重拉 detail——评论/回收/状态变更不等 30s 轮询（审查 d4-1） */
  detailRefreshTick?: number;
}

export function TaskDrawer({ task, onClose, onAction, loadingId, onRefresh, homeChannels, board = 'default', onOpenTask, variant = 'drawer', onMoveStatus, detailRefreshTick }: TaskDrawerProps) {
  const busy = loadingId === task?.id;
  const [detail, setDetail] = useState<any>(null);
  const [commentInput, setCommentInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [workerLog, setWorkerLog] = useState<string | Record<string, unknown> | null>(null);
  // 🔴 对齐 Hermes：日志截断标识（tail 扩大至 400 行 + truncated 提示）
  const [logTruncated, setLogTruncated] = useState(false);
  const [diags, setDiags] = useState<TaskDiag[]>([]);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingPriority, setEditingPriority] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [editingModel, setEditingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState('');
  const [providerDraft, setProviderDraft] = useState('');
  const [effortDraft, setEffortDraft] = useState('');
  const [assigneeDraft, setAssigneeDraft] = useState('');
  // 🔴 对齐 Hermes AssigneeMenu（drawer.tsx L236-275）：负责人改为 roster 下拉
  //   （profiles），运行中重分配 reclaim_first: true——此前自由文本 + 无 reclaim，
  //   运行卡改负责人后 worker 继续跑旧任务直至超时（审查 d4-9）
  const [profileRoster, setProfileRoster] = useState<Array<{ name: string }>>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null); // Phase B7: Run 详情展开
  const [expandedRunData, setExpandedRunData] = useState<RunRecord | null>(null);
  const [expandedRunLoading, setExpandedRunLoading] = useState(false);
  // 🔴 P0-4b：抽屉工作量估算状态（对齐 Hermes drawer EstimateSection）
  const [estimating, setEstimating] = useState(false);
  const [estimateResult, setEstimateResult] = useState<{ estTokens: number; complexity: string; rationale: string } | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🔴 修复：评论/运行历史/依赖统一来自 detail 端点（get_kanban_task 返回
  //   { task, comments, events, runs, links }）——board 列表的任务对象不含
  //   runs/parents/children（它们在关联表），此前「运行」与「依赖」区恒为空。
  //   顺带修正非 default 看板下 getKanbanTask 缺省 board 参数导致的错板读取。
  const comments: CommentRecord[] = detail?.comments || [];
  const runs: RunRecord[] = detail?.runs || [];
  const events: KanbanEvent[] = detail?.events || [];
  const links: { parents: string[]; children: string[] } = detail?.links || { parents: [], children: [] };

  // Phase B7: 展开/收起 Run 详情
  const handleToggleRunDetail = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      setExpandedRunData(null);
      return;
    }
    setExpandedRunId(runId);
    setExpandedRunLoading(true);
    setExpandedRunData(null);
    try {
      const data = await getKanbanRun(runId, board);
      setExpandedRunData(data?.run || data || null);
    } catch {
      setExpandedRunData(null);
    }
    setExpandedRunLoading(false);
  }, [expandedRunId, board]);

  // 加载详情（评论/事件/运行/链接）+ 附件
  // 🔴 P0-4b：抽屉估算（对齐 Hermes EstimateSection：永不抛错，失败内联提示）
  const runTaskEstimate = async () => {
    if (!task?.id || estimating) return;
    setEstimating(true);
    setEstimateError(null);
    try {
      const res = await estimateKanbanTaskById(task.id, board);
      if (res?.ok) {
        setEstimateResult({
          estTokens: Number(res.est_tokens ?? 0),
          complexity: res.complexity ?? 'M',
          rationale: res.rationale ?? '',
        });
      } else {
        setEstimateResult(null);
        setEstimateError(res?.reason ?? '估算失败');
      }
    } catch (err) {
      setEstimateResult(null);
      setEstimateError(err instanceof Error ? err.message : String(err));
    } finally {
      setEstimating(false);
    }
  };

  // 🔴 对齐 Hermes drawer refetchInterval 30s：此前一次性拉取，抽屉打开期间
  //   事件/评论/运行/依赖/附件恒旧；改为 30s 轮询自动刷新
  const fetchDetail = useCallback(() => {
    if (!task?.id) return;
    getKanbanTask(task.id, board).then(data => setDetail(data)).catch(() => setDetail(null));
    getKanbanAttachments(task.id, board).then(data => {
      setAttachments(data?.attachments || data || []);
    }).catch(() => {});
  }, [task?.id, board]);

  useEffect(() => {
    if (!task?.id) { setDetail(null); setAttachments([]); return; }
    let alive = true;
    const fetchDetailAlive = () => {
      getKanbanTask(task.id, board).then(data => { if (alive) setDetail(data); }).catch(() => { if (alive) setDetail(null); });
      getKanbanAttachments(task.id, board).then(data => {
        if (alive) setAttachments(data?.attachments || data || []);
      }).catch(() => {});
    };
    fetchDetailAlive();
    const interval = window.setInterval(fetchDetailAlive, 30000);
    // 切换任务时重置 Run 展开态（避免上一个任务的展开残留）
    setExpandedRunId(null);
    setExpandedRunData(null);
    return () => { alive = false; window.clearInterval(interval); };
  }, [task?.id, board]);

  // 🔴 对齐 Hermes socket 帧失效（drawer.tsx L556-561）：SSE 事件到达即重拉
  //   detail——评论/回收/状态变更秒级反映（审查 d4-1）
  const lastTickRef = useRef(detailRefreshTick ?? 0);
  useEffect(() => {
    if ((detailRefreshTick ?? 0) === lastTickRef.current) return;
    lastTickRef.current = detailRefreshTick ?? 0;
    if (task?.id) fetchDetail();
  }, [detailRefreshTick, task?.id, fetchDetail]);

  // 🔴 对齐 Hermes AssigneeMenu roster 数据源：profiles 挂载即加载
  useEffect(() => {
    let alive = true;
    getKanbanProfiles().then(data => {
      if (alive) setProfileRoster(data?.profiles || data || []);
    }).catch(() => { if (alive) setProfileRoster([]); });
    return () => { alive = false; };
  }, []);

  // 🔴 对齐 Hermes 抽屉诊断区：board 级 /diagnostics 按 task_id 过滤展示
  useEffect(() => {
    if (!task?.id) { setDiags([]); return; }
    let alive = true;
    getKanbanDiagnostics(board).then(data => {
      if (!alive) return;
      const list = (data?.diagnostics || []) as TaskDiag[];
      setDiags(list.filter(d => d.task_id === task.id));
    }).catch(() => { if (alive) setDiags([]); });
    return () => { alive = false; };
  }, [task?.id, board]);

  // 🔴 对齐 Hermes worker log 自动轮询：running 3s / 其他 15s（手动按钮变"立即刷新"）
  const runningNow = task?.status === 'running';
  useEffect(() => {
    if (!task?.id) { setWorkerLog(null); return; }
    let alive = true;
    const fetchLog = () => {
      getKanbanTaskLog(task.id, 400, board).then(data => {
        if (alive) { setWorkerLog(data?.log || data || '无日志'); setLogTruncated(Boolean(data?.truncated)); }
      }).catch(() => { if (alive) setWorkerLog('加载日志失败'); });
    };
    fetchLog();
    const interval = window.setInterval(fetchLog, runningNow ? 3000 : 15000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [task?.id, board, runningNow]);

  const handleShadeClick = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const blocked = isBlocked(task);
  const done = isDone(task);
  const running = task.status === 'running';
  const scheduled = (task.status || '').toLowerCase() === 'scheduled';
  const review = (task.status || '').toLowerCase() === 'review';

  // 发送评论 → 调 addKanbanComment → 刷新详情
  const handleSendComment = async () => {
    if (!commentInput.trim()) return;
    try {
      await addKanbanComment(task.id, commentInput.trim(), 'user', board);
      setCommentInput('');
      const data = await getKanbanTask(task.id, board);
      setDetail(data);
    } catch (err) {
      console.error('[KanbanPanel] Comment failed:', err);
    }
  };

  // 🔴 对齐 Hermes CommentComposer "Note & requeue"（drawer.tsx L345-353）：
  //   running 任务"附言重跑"= 评论 + reclaim 一键——worker 上下文带上注记
  //   重跑，替代 block→comment→unblock 三步舞
  const [requeueing, setRequeueing] = useState(false);
  const handleRequeue = async () => {
    if (!commentInput.trim() || requeueing) return;
    setRequeueing(true);
    try {
      await addKanbanComment(task.id, commentInput.trim(), 'user', board);
      setCommentInput('');
      onAction('reclaim', task.id);
    } catch (err) {
      console.error('[KanbanPanel] Requeue failed:', err);
    } finally {
      setRequeueing(false);
    }
  };

  // 保存标题 → 行内编辑
  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) { setEditingTitle(false); return; }
    if (trimmed === (task.title || '')) { setEditingTitle(false); return; }
    try {
      await updateKanbanTask(task.id, { title: trimmed }, board);
      setEditingTitle(false);
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save title failed:', err);
    }
  };

  // 保存 Priority → 行内下拉
  const handleSavePriority = async (newPriority: string) => {
    setEditingPriority(false);
    const current = task.priority ? String(task.priority).replace(/^p/i, '') : '';
    if (newPriority === current) return;
    try {
      await updateKanbanTask(task.id, { priority: newPriority ? Number(newPriority) : null }, board);
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save priority failed:', err);
    }
  };

  // 保存 Assignee → 行内编辑
  // 🔴 对齐 Hermes AssigneeMenu：roster 下拉选择；运行中重分配恒 reclaim_first:true
  //   （回收旧 worker 立即生效）——此前自由文本 PATCH 无 reclaim，运行卡改负责人
  //   后 worker 继续跑旧任务直至超时（审查 d4-9）
  const saveAssigneeTo = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === (task.assignee || '')) return;
    try {
      if (task.status === 'running') {
        await reassignKanbanTask(task.id, trimmed || 'default', true, 'drawer assignee change', board);
      } else {
        await updateKanbanTask(task.id, { assignee: trimmed || null }, board);
      }
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save assignee failed:', err);
    }
  };
  const handleSaveAssignee = async () => {
    setEditingAssignee(false);
    await saveAssigneeTo(assigneeDraft);
  };

  // 保存模型覆盖三元组（对齐 Hermes ModelOverrideField：model/provider/effort；
  //   空串 = 清除该项覆盖，回退继承 profile）
  const handleSaveModel = async () => {
    setEditingModel(false);
    const m = modelDraft.trim();
    const p = providerDraft.trim();
    const r = effortDraft.trim();
    if (m === (task.model_override || '') && p === (task.provider_override || '') && r === (task.reasoning_effort || '')) return;
    try {
      // 🔴 对齐 Hermes clear 语义（审查 d2-10）：空串 = 显式清除（后端写 NULL
      //   回退继承）——此前发 null 被后端 as_str() 吞成 None，「清空模型」静默失败
      await updateKanbanTask(task.id, {
        model_override: m,
        provider_override: m && p ? p : '',
        reasoning_effort: r,
      }, board);
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save model override failed:', err);
    }
  };

  // 保存描述 → 调 updateKanbanTask → 刷新
  const handleSaveBody = async () => {
    try {
      await updateKanbanTask(task.id, { body: bodyDraft }, board);
      setEditingBody(false);
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save body failed:', err);
    }
  };

  // 上传附件 → 调 uploadKanbanAttachment → 刷新附件列表
  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      const base64 = base64FromDataURL(dataUrl);
      await uploadKanbanAttachment(task.id, file.name, base64, board);
      const data = await getKanbanAttachments(task.id, board);
      setAttachments(data?.attachments || data || []);
    } catch (err) {
      console.error('[KanbanPanel] Upload failed:', err);
    }
  };

  // Run 结果颜色
  const runBorderColor = (outcome: string | undefined): string => {
    if (['crashed','timed_out','gave_up','spawn_failed'].includes(outcome || '')) return 'var(--ui-red)';
    if (outcome === 'reclaimed') return 'var(--ui-yellow)';
    if (outcome === 'completed') return 'var(--ui-blue)';
    if (outcome === 'blocked') return 'var(--ui-red)';
    return 'var(--ui-stroke-tertiary)';
  };

  const panel = (
    <>
        {/* 抽屉头 — 状态菜单（对齐 Hermes StatusMenu）+ ID + ⋯菜单 + 关闭 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ui-stroke-tertiary)]">
          <div className="flex items-center gap-2">
            {onMoveStatus ? (
              <StatusMenuButton status={task.status} onMove={onMoveStatus} />
            ) : (
              <StatusDot status={task.status} size={10} />
            )}
            <span className="font-mono text-[0.8rem] text-[var(--ui-text-quaternary)]">#{typeof task.id === 'string' ? task.id.slice(0, 8) : task.id}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <MoreMenuButton task={task} onAction={onAction} />
            <button onClick={onClose} className="text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] transition-colors p-1"><X size={18} strokeWidth={1.5} /></button>
          </div>
        </div>

        {/* 🔴 对齐 Hermes ready 未分配 Callout（drawer.tsx L789-793，审查 d4-11）：
            就绪但无负责人 → 不会被调度器运行，提示分配 profile */}
        {task.status === 'ready' && !task.assignee && (
          <div className="mx-5 mb-2 px-3 py-2 rounded-md border border-warning/25 bg-warning/5 text-[0.72rem] text-warning flex items-center gap-1.5">
            <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0" />
            任务已就绪但未分配负责人——分配 profile 后调度器才会运行它
          </div>
        )}

        {/* 标题 — 行内可编辑 */}
        <div className="px-5 pt-4 pb-2">
          {editingTitle ? (
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              onBlur={handleSaveTitle} autoFocus
              className="w-full text-base font-semibold leading-snug px-2 py-1 -mx-2 rounded-md border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none" />
          ) : (
            <h3 onClick={() => { setEditingTitle(true); setTitleDraft(task.title || ''); }}
              className="text-base font-semibold text-[var(--ui-text-primary)] leading-snug cursor-pointer rounded-md px-2 -mx-2 py-1 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] transition-colors"
              title="点击编辑标题">
              {task.title || '(无描述)'}
            </h3>
          )}
        </div>

        {/* 抽屉体 — 折叠面板 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col">
          {/* ── 详情 ── */}
          <div>
            <button onClick={() => setCollapsedSections((prev: Record<string, boolean>) => ({...prev, details: !prev.details}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.details && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">详情</span>
            </button>
            {!collapsedSections.details && (
              <div className="py-3 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[color-mix(in_srgb,var(--ui-text-primary)_4%,transparent)] text-[0.8rem]">
                  <MetaRow label="状态" value={task.status} />
                  {/* 优先级 — 行内可编辑 */}
                  <div className="flex gap-3">
                    <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">优先级</span>
                    {editingPriority ? (
                      <select value={String(task.priority || '').replace(/^p/i, '')} autoFocus
                        onChange={(e) => handleSavePriority(e.target.value)}
                        onBlur={() => setEditingPriority(false)}
                        className="text-[var(--ui-text-primary)] bg-transparent border border-[var(--kanban-hover-bg)] rounded px-1 py-0.5 -my-0.5 text-[0.8rem] focus:outline-none cursor-pointer">
                        <option value="">—</option>
                        <option value="0">P0</option>
                        <option value="1">P1</option>
                        <option value="2">P2</option>
                        <option value="3">P3</option>
                      </select>
                    ) : (
                      <span onClick={() => setEditingPriority(true)}
                        className="text-[var(--ui-text-primary)] cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors break-words"
                        title="点击编辑优先级">
                        {task.priority ? `P${String(task.priority).replace(/^p/i, '')}` : '—'}
                      </span>
                    )}
                  </div>
                  {/* 负责人 — 行内可编辑（roster 下拉，对齐 Hermes AssigneeMenu） */}
                  <div className="flex gap-3">
                    <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">负责人</span>
                    {editingAssignee ? (
                      <select value={assigneeDraft}
                        onChange={(e) => { const v = e.target.value; setAssigneeDraft(v); void saveAssigneeTo(v); }}
                        onBlur={() => setEditingAssignee(false)}
                        autoFocus
                        className="flex-1 text-[0.8rem] px-1 py-0.5 -my-0.5 rounded border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] focus:outline-none cursor-pointer"
                        title="运行中任务重分配将立即回收旧 worker（reclaim_first）">
                        <option value="">未分配</option>
                        {profileRoster.map(p => (
                          <option key={p.name} value={p.name}>{p.name}{p.name === task.assignee ? '（当前）' : ''}</option>
                        ))}
                      </select>
                    ) : (
                      <span onClick={() => { setEditingAssignee(true); setAssigneeDraft(task.assignee || ''); }}
                        className="text-[var(--ui-text-primary)] cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors break-words"
                        title="点击编辑负责人">
                        {task.assignee || '未分配'}
                      </span>
                    )}
                  </div>
                  <MetaRow label="创建时间" value={task.startTs ? fmtAge(task.startTs) : '—'} />
                  {/* 🔴 对齐 Hermes drawer L759-787：补元信息行 tenant/工作区/
                      创建者/worker PID（detail 为原始后端数据，含未 normalize 字段） */}
                  {task.tenant && <MetaRow label="租户" value={task.tenant} />}
                  {(detail?.task?.workspace_kind || detail?.task?.workspace_path) && (
                    <MetaRow label="工作区"
                      value={`${detail?.task?.workspace_kind || ''}${detail?.task?.workspace_path ? `: ${detail?.task?.workspace_path}` : ''}`} />
                  )}
                  {detail?.task?.created_by && <MetaRow label="创建者" value={String(detail.task.created_by)} />}
                  {running && detail?.task?.worker_pid != null && (
                    <MetaRow label="Worker PID" value={String(detail.task.worker_pid)} />
                  )}
                  {/* 模型覆盖三元组 — 行内可编辑（对齐 Hermes ModelOverrideField） */}
                  <div className="flex gap-3 items-start">
                    <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">模型</span>
                    {editingModel ? (
                      <div className="flex-1 flex flex-col gap-1 min-w-0">
                        <input value={modelDraft} onChange={(e) => setModelDraft(e.target.value)}
                          placeholder="模型（留空继承）"
                          className="w-full text-[0.8rem] px-1 py-0.5 rounded border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none" />
                        <div className="flex gap-1">
                          <input value={providerDraft} onChange={(e) => setProviderDraft(e.target.value)}
                            placeholder="Provider"
                            className="flex-1 text-[0.8rem] px-1 py-0.5 rounded border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none" />
                          <input value={effortDraft} onChange={(e) => setEffortDraft(e.target.value)}
                            placeholder="推理深度"
                            className="flex-1 text-[0.8rem] px-1 py-0.5 rounded border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none" />
                        </div>
                        <div className="flex gap-2 text-[0.68rem]">
                          <button onClick={handleSaveModel} className="text-[var(--kanban-hover-bg)] hover:underline">保存</button>
                          <button onClick={() => setEditingModel(false)} className="text-[var(--ui-text-tertiary)] hover:underline">取消</button>
                        </div>
                      </div>
                    ) : (
                      <span onClick={() => { setEditingModel(true); setModelDraft(task.model_override || ''); setProviderDraft(task.provider_override || ''); setEffortDraft(task.reasoning_effort || ''); }}
                        className="text-[var(--ui-text-primary)] cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors break-words"
                        title="点击编辑模型覆盖">
                        {task.model_override
                          ? `${task.model_override}${task.provider_override ? ` @ ${task.provider_override}` : ''}${task.reasoning_effort ? ` · ${task.reasoning_effort}` : ''}`
                          : '继承 profile'}
                      </span>
                    )}
                  </div>
                  {blocked && task.block_reason && <MetaRow label="阻塞原因" value={task.block_reason} />}
                </div>

                {/* 描述（点击正文区域直接编辑） */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--color-muted-foreground)]">描述</span>
                    {!editingBody && task.body && (
                      <button onClick={() => { setEditingBody(true); setBodyDraft(task.body || ''); }} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors">
                        <Edit3 size={12} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                  {editingBody ? (
                    <div className="flex flex-col gap-2">
                      <textarea value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingBody(false); }}
                        className="w-full min-h-[6rem] text-[0.82rem] px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] resize-y focus:outline-none focus:border-[var(--color-ring)]" />
                      <div className="flex gap-2">
                        <button onClick={handleSaveBody} className="inline-flex items-center gap-1 text-[0.7rem] px-2 py-1 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90 transition-colors"><Save size={11} /> 保存</button>
                        <button onClick={() => setEditingBody(false)} className="text-[0.7rem] px-2 py-1 rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">取消</button>
                      </div>
                    </div>
                  ) : (
                    task.body
                      ? <p onClick={() => { setEditingBody(true); setBodyDraft(task.body || ''); }}
                          className="text-[0.82rem] text-[var(--color-foreground)] leading-relaxed whitespace-pre-wrap cursor-pointer rounded px-2 py-1.5 -mx-2 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_5%,transparent)] transition-colors"
                          title="点击编辑描述">{task.body}</p>
                      : <p onClick={() => { setEditingBody(true); setBodyDraft(''); }}
                          className="text-[0.82rem] text-[var(--color-muted-foreground)] italic cursor-pointer rounded px-2 py-1.5 -mx-2 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_5%,transparent)] transition-colors"
                          title="点击添加描述">点击此处添加描述</p>
                  )}
                </div>

                {/* 概要 */}
                {task.summary && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">概要</span>
                    <p className="text-[0.82rem] text-[var(--ui-text-primary)] leading-relaxed whitespace-pre-wrap">{task.summary}</p>
                  </div>
                )}

                {/* 依赖（🔴 修复：来自 detail.links，board 任务对象无 parents/children；
                    点击可跳转目标任务，对齐 Hermes drawer onOpen） */}
                {(links.parents?.length > 0 || links.children?.length > 0) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">依赖关系</span>
                    <div className="flex flex-wrap gap-1.5">
                      {links.parents.map((p: string) => (
                        <button key={p} type="button" onClick={() => onOpenTask?.(p)}
                          className="font-mono text-[0.68rem] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-secondary)] hover:bg-[var(--chrome-action-hover)] hover:text-foreground transition-colors" title="打开父任务">
                          ↑ {typeof p === 'string' ? p.slice(0, 6) : p}
                        </button>
                      ))}
                      {links.children.map((c: string) => (
                        <button key={c} type="button" onClick={() => onOpenTask?.(c)}
                          className="font-mono text-[0.68rem] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-secondary)] hover:bg-[var(--chrome-action-hover)] hover:text-foreground transition-colors" title="打开子任务">
                          ↓ {typeof c === 'string' ? c.slice(0, 6) : c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 诊断（🔴 对齐 Hermes drawer Diagnostics：board 级诊断按任务过滤，
              恢复动作一键执行）── */}
          {diags.length > 0 && (
            <div>
              <button onClick={() => setCollapsedSections(prev => ({...prev, diags: !prev.diags}))}
                className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
                <ChevronDown size={12} strokeWidth={1.5}
                  className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.diags && 'rotate-180')} />
                <span className="text-[0.72rem] font-semibold tracking-wide text-warning">诊断 ({diags.length})</span>
              </button>
              {!collapsedSections.diags && (
                <div className="py-3 flex flex-col gap-2">
                  {diags.map(d => {
                    const tone = d.severity === 'warning' ? '#fbbf24' : 'var(--ui-red)';
                    return (
                      <div key={`${d.task_id}-${d.title}`} className="flex flex-col gap-1.5 rounded-md p-2.5 text-[0.75rem]"
                        style={{ backgroundColor: `color-mix(in srgb, ${tone} 7%, transparent)`, borderLeft: `2px solid ${tone}` }}>
                        <div className="flex items-center gap-1.5 font-medium" style={{ color: tone }}>
                          <AlertTriangle size={12} strokeWidth={1.5} className="shrink-0" />
                          {d.title}{d.count && d.count > 1 ? ` ×${d.count}` : ''}
                        </div>
                        {d.detail && <p className="leading-relaxed text-[var(--ui-text-secondary)]">{d.detail}</p>}
                        {/* 🔴 对齐 Hermes Diagnostics：渲染全部动作（此前只取首个
                            reclaim|unblock，comment/reassign 等恢复动作不可达） */}
                        {(d.actions || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {(d.actions || []).map((a, ai) => {
                              const isAction = a.kind === 'reclaim' || a.kind === 'unblock' || a.kind === 'reassign';
                              // 🔴 对齐 Hermes 诊断动作（drawer.tsx L184-231）：cli_hint
                              //   渲染为可点复制按钮（payload.command ?? label），notify
                              //   提示——此前禁用无复制，恢复命令不可执行（审查 d4-8）；
                              //   suggested 动作用 secondary 变体强调
                              const isCliHint = a.kind === 'cli_hint';
                              const cmd = isCliHint
                                ? String(a.payload?.command ?? a.label ?? '')
                                : null;
                              const handleClick = () => {
                                if (isCliHint && cmd) {
                                  void navigator.clipboard?.writeText(cmd);
                                  notify({ kind: 'info', title: '命令已复制', message: cmd });
                                  return;
                                }
                                if (!isAction) return;
                                onAction(a.kind, task.id);
                              };
                              return (
                                <button key={ai} onClick={handleClick}
                                  className={cn('self-start text-[0.7rem] px-2 py-1 rounded border transition-colors',
                                    isCliHint || isAction
                                      ? (a.suggested ? 'font-semibold hover:brightness-110' : 'hover:brightness-110')
                                      : 'opacity-60 cursor-not-allowed')}
                                  style={{ borderColor: `color-mix(in srgb, ${tone} 40%, transparent)`, color: tone }}
                                  title={
                                    isCliHint && cmd
                                      ? `点击复制: ${cmd}`
                                      : isAction
                                        ? a.label
                                        : `${a.label}（当前无对应操作入口）`
                                  }>
                                  {a.suggested && '★ '}{a.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── 评论 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, comments: !prev.comments}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.comments && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">评论{comments.length > 0 ? ` (${comments.length})` : ''}</span>
            </button>
            {!collapsedSections.comments && (
              <div className="py-3 flex flex-col gap-3">
                {comments.length === 0 ? (
                  <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] text-center py-6">暂无评论</p>
                ) : (
                  comments.map((c: CommentRecord, i: number) => (
                    <div key={i} className="border-l-2 border-[color-mix(in_srgb,var(--kanban-hover-bg)_35%,transparent)] pl-3 flex flex-col gap-0.5">
                      <div className="flex gap-2 text-[0.7rem]">
                        <span className="font-semibold text-[var(--ui-text-primary)]">{c.author || '匿名'}</span>
                        <span className="text-[var(--ui-text-tertiary)]">{c.created_at ? fmtAge(c.created_at) : ''}</span>
                      </div>
                      <p className="text-[0.8rem] text-[var(--ui-text-primary)] leading-relaxed">{c.body}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 活动（🔴 对齐 Hermes drawer Activity：task_events 人类可读流）── */}
          {events.length > 0 && (
            <div>
              <button onClick={() => setCollapsedSections(prev => ({...prev, activity: !prev.activity}))}
                className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
                <ChevronDown size={12} strokeWidth={1.5}
                  className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.activity && 'rotate-180')} />
                <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">活动 ({events.length})</span>
              </button>
              {!collapsedSections.activity && (
                <div className="py-3">
                  <ul className="flex flex-col gap-1.5 max-h-[11rem] overflow-y-auto pr-1">
                    {[...events].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)).map((evt, idx) => {
                      const { detail: extra, label } = eventText(evt.kind, evt.payload);
                      return (
                        <li key={evt.id ?? idx} className="flex items-baseline gap-2 text-[0.7rem]">
                          <span className="shrink-0 text-[var(--ui-text-secondary)]">{label}</span>
                          {extra && (
                            <span className="min-w-0 truncate text-[0.65rem] text-[var(--ui-text-quaternary)]" title={extra}>{extra}</span>
                          )}
                          <span className="ml-auto shrink-0 text-[var(--ui-text-quaternary)]">{fmtAge(evt.created_at)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── 运行历史 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, runs: !prev.runs}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.runs && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">运行</span>
            </button>
            {!collapsedSections.runs && (
              <div className="py-3 flex flex-col gap-2">
                {runs.length === 0 ? (
                  <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] text-center py-6">暂无运行记录</p>
                ) : (
                  runs.map((run: RunRecord, i: number) => (
                    <div key={i} className="border-l-2 pl-3 py-1.5 rounded-r-md bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)]"
                      style={{ borderLeftColor: runBorderColor(run.outcome || run.status) }}>
                      <div className="flex items-center gap-3 text-[0.7rem]">
                        <span className="font-mono font-semibold tracking-wide text-[var(--ui-text-primary)]">{run.outcome || run.status || '—'}</span>
                        {run.profile && <span className="text-[var(--ui-text-tertiary)]">{run.profile}</span>}
                        {/* 🔴 修复：后端 Run 结构无 elapsed_seconds 字段（有
                            started_at/ended_at epoch 秒），原字段恒缺失 → 时长
                            永不显示，改为按起止时间计算 */}
                        {run.ended_at != null && run.started_at != null && (Number(run.ended_at) - Number(run.started_at)) > 0 && (
                          <span className="tabular-nums text-[var(--ui-text-tertiary)]">{fmtDuration((Number(run.ended_at) - Number(run.started_at)) * 1000)}</span>
                        )}
                        {run.ended_at && <span className="ml-auto text-[var(--ui-text-tertiary)]">{fmtAge(run.ended_at)}</span>}
                        {run.id && <button onClick={() => handleToggleRunDetail(run.id!)}
                          className="text-[var(--kanban-hover-bg)] hover:text-[var(--kanban-hover-bg)] transition-colors ml-1"
                          title={expandedRunId === run.id ? '收起详情' : '查看详情'}>
                          <ChevronDown size={11} strokeWidth={1.5} className={cn('transition-transform', expandedRunId === run.id && 'rotate-180')} />
                        </button>}
                      </div>
                      {run.summary && <p className="text-[0.8rem] text-[var(--ui-text-primary)] leading-relaxed mt-1">{run.summary}</p>}
                      {run.error && <p className="text-[0.7rem] text-[var(--ui-red)] font-mono mt-0.5">{run.error}</p>}
                      {/* Phase B7: Run 展开详情 */}
                      {expandedRunId === run.id && (
                        <div className="mt-2 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[color-mix(in_srgb,var(--ui-text-primary)_2%,transparent)] p-2.5 space-y-1.5 text-[0.72rem]">
                          {expandedRunLoading && <span className="text-[var(--ui-text-tertiary)]">加载中...</span>}
                          {expandedRunData && (
                            <>
                              {expandedRunData.task_id && <div><span className="text-[var(--ui-text-tertiary)]">Task: </span><span className="font-mono">{expandedRunData.task_id}</span></div>}
                              {expandedRunData.assignee && <div><span className="text-[var(--ui-text-tertiary)]">Assignee: </span>{expandedRunData.assignee}</div>}
                              {expandedRunData.started_at && <div><span className="text-[var(--ui-text-tertiary)]">开始: </span>{expandedRunData.started_at}</div>}
                              {expandedRunData.ended_at && <div><span className="text-[var(--ui-text-tertiary)]">结束: </span>{expandedRunData.ended_at}</div>}
                              {expandedRunData.result != null && <div><span className="text-[var(--ui-text-tertiary)]">结果: </span><span className="font-mono text-[0.68rem] whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto block">{typeof expandedRunData.result === 'string' ? expandedRunData.result : JSON.stringify(expandedRunData.result, null, 2)}</span></div>}
                              {expandedRunData.metadata && <div><span className="text-[var(--ui-text-tertiary)]">元数据: </span><span className="font-mono text-[0.68rem] whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto block">{typeof expandedRunData.metadata === 'string' ? expandedRunData.metadata : JSON.stringify(expandedRunData.metadata, null, 2)}</span></div>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 依赖 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, links: !prev.links}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.links && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">依赖</span>
            </button>
            {!collapsedSections.links && (
              <div className="py-3 flex flex-col gap-3">
                {/* 上游依赖 (parents) — 🔴 修复：来自 detail.links，且删除/添加按 board 路由 */}
                <div>
                  <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">上游依赖（父任务）</span>
                  {links.parents.length === 0 && <p className="text-[0.7rem] text-[var(--ui-text-quaternary)] mt-1">无</p>}
                  {links.parents.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {links.parents.map((p: string) => (
                        <div key={p} className="flex items-center gap-2 text-[0.75rem]">
                          <GitBranch size={11} strokeWidth={1.5} className="text-[var(--ui-text-quaternary)] shrink-0" />
                          <button type="button" onClick={() => onOpenTask?.(p)}
                            className="font-mono text-[var(--ui-text-primary)] hover:text-[var(--kanban-hover-bg)] transition-colors" title="打开父任务">
                            {typeof p === 'string' ? p.slice(0, 8) : p}
                          </button>
                          <button onClick={async () => { try { await deleteKanbanLink(p, task.id, board); onRefresh(); } catch {} }}
                            className="ml-auto text-[var(--ui-text-quaternary)] hover:text-danger transition-colors"><X size={11} strokeWidth={1.5} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 下游依赖 (children) */}
                <div>
                  <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">下游依赖（子任务）</span>
                  {links.children.length === 0 && <p className="text-[0.7rem] text-[var(--ui-text-quaternary)] mt-1">无</p>}
                  {links.children.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {links.children.map((c: string) => (
                        <div key={c} className="flex items-center gap-2 text-[0.75rem]">
                          <GitBranch size={11} strokeWidth={1.5} className="text-[var(--ui-text-quaternary)] shrink-0" />
                          <button type="button" onClick={() => onOpenTask?.(c)}
                            className="font-mono text-[var(--ui-text-primary)] hover:text-[var(--kanban-hover-bg)] transition-colors" title="打开子任务">
                            {typeof c === 'string' ? c.slice(0, 8) : c}
                          </button>
                          <button onClick={async () => { try { await deleteKanbanLink(task.id, c, board); onRefresh(); } catch {} }}
                            className="ml-auto text-[var(--ui-text-quaternary)] hover:text-danger transition-colors"><X size={11} strokeWidth={1.5} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 添加依赖 */}
                <div className="border-t border-[var(--ui-stroke-tertiary)] pt-2.5">
                  <AddLinkForm taskId={task.id} direction="parent" onSubmit={async (otherId: string) => { await createKanbanLink(otherId, task.id, board); onRefresh(); }} />
                  <AddLinkForm taskId={task.id} direction="child" onSubmit={async (otherId: string) => { await createKanbanLink(task.id, otherId, board); onRefresh(); }} />
                </div>
              </div>
            )}
          </div>

          {/* ── 附件 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, attachments: !prev.attachments}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.attachments && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">附件{attachments.length > 0 ? ` (${attachments.length})` : ''}</span>
            </button>
            {!collapsedSections.attachments && (
              <div className="py-3 flex flex-col gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-[0.7rem] px-2.5 py-1.5 rounded-md border border-dashed border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] hover:border-[var(--kanban-hover-bg)] transition-colors self-start">
                  <Paperclip size={11} /> 上传附件
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleUploadAttachment} />
                {attachments.length === 0 ? (
                  <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] text-center py-4">暂无附件</p>
                ) : (
                  attachments.map((a: AttachmentRecord, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[0.8rem] px-3 py-2 rounded border border-[var(--ui-stroke-tertiary)]">
                      <Paperclip size={12} className="shrink-0 text-[var(--ui-text-tertiary)]" />
                      <span className="truncate text-[var(--ui-text-primary)]">{a.filename || a.name || `附件 ${i + 1}`}</span>
                      {a.size && <span className="text-[0.65rem] text-[var(--ui-text-quaternary)] ml-auto">{(a.size / 1024).toFixed(1)}KB</span>}
                      <button onClick={() => { const base = getApiBase(); const p = getWsActiveProfile(); const prefix = p ? `/p/${p}` : ''; window.open(`${base}${prefix}/api/kanban/attachments/${a.id}?board=${encodeURIComponent(board)}`, '_blank'); }} title="下载附件"
                        className="text-[var(--kanban-hover-bg)] hover:text-[var(--kanban-hover-bg)] transition-colors ml-1"><Download size={11} strokeWidth={1.5} /></button>
                      <button onClick={async () => { try { await deleteKanbanAttachment(a.id!, board); const data = await getKanbanAttachments(task.id, board); setAttachments(data?.attachments || data || []); } catch {} }} title="删除附件"
                        className="text-danger/70 hover:text-danger transition-colors ml-1"><Trash2 size={11} /></button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 工作量估算（🔴 P0-4b：对齐 Hermes drawer EstimateSection L476-538——
              辅助模型估 token+复杂度，可重估；d4-2 闭合）── */}
          {!['done', 'completed', 'archived'].includes((task.status || '').toLowerCase()) && (
            <div>
              <button onClick={() => setCollapsedSections(prev => ({...prev, estimate: !prev.estimate}))}
                className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
                <ChevronDown size={12} strokeWidth={1.5}
                  className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.estimate && 'rotate-180')} />
                <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">工作量估算</span>
              </button>
              {!collapsedSections.estimate && (
                <div className="py-2.5 flex flex-col gap-1.5">
                  {estimating ? (
                    <span className="flex items-center gap-1.5 text-[0.75rem] text-[var(--ui-text-tertiary)]">
                      <Loader size={11} strokeWidth={1.5} className="animate-spin" /> 估算中…
                    </span>
                  ) : estimateResult ? (
                    <span className="text-[0.75rem] text-[var(--ui-text-secondary)]">
                      ~{estimateResult.estTokens.toLocaleString()} tok · <span className="font-medium">{estimateResult.complexity}</span>
                      {estimateResult.rationale && <span className="text-[var(--ui-text-tertiary)]"> — {estimateResult.rationale}</span>}
                    </span>
                  ) : estimateError ? (
                    <span className="text-[0.7rem] text-danger">{estimateError}</span>
                  ) : null}
                  <button onClick={() => void runTaskEstimate()}
                    className="self-start flex items-center gap-1.5 text-[0.7rem] px-2 py-1 rounded border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">
                    <Gauge size={11} strokeWidth={1.5} />
                    {estimateResult ? '重新估算' : '估算'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── 日志（🔴 对齐 Hermes：running 3s / 其他 15s 自动轮询，按钮=立即刷新）── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, log: !prev.log}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.log && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">日志</span>
            </button>
            {!collapsedSections.log && (
              <div className="py-3 flex flex-col gap-2">
                <button onClick={() => {
                  getKanbanTaskLog(task.id, 400, board).then(data => {
                    setWorkerLog(data?.log || data || '无日志');
                    setLogTruncated(Boolean(data?.truncated));
                  }).catch(() => setWorkerLog('加载日志失败'));
                }} className="inline-flex items-center gap-1.5 text-[0.7rem] px-2.5 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors self-start">
                  <FileText size={11} /> 立即刷新
                </button>
                {logTruncated && (
                  <span className="text-[0.65rem] text-[var(--ui-text-quaternary)]">日志过长，仅显示末尾 400 行</span>
                )}
                {workerLog ? (
                  <pre className="text-[0.7rem] font-mono leading-relaxed p-3 rounded-md bg-[color-mix(in_srgb,var(--ui-text-primary)_4%,transparent)] border border-[var(--ui-stroke-tertiary)] overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto text-[var(--ui-text-primary)]">
                    {typeof workerLog === 'string' ? workerLog : JSON.stringify(workerLog, null, 2)}
                  </pre>
                ) : (
                  <p className="text-[0.75rem] text-[var(--ui-text-quaternary)]">加载中...</p>
                )}
              </div>
            )}
          </div>

          {/* ── 订阅 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, subscribe: !prev.subscribe}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.subscribe && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">订阅</span>
            </button>
            {!collapsedSections.subscribe && (
              <div className="py-3 flex flex-col gap-3">
                <p className="text-[0.8rem] text-[var(--ui-text-tertiary)]">状态变更时推送通知到指定频道</p>
                {homeChannels.length > 0 ? (
                  homeChannels.map((ch, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[0.8rem] px-3 py-2 rounded border border-[var(--ui-stroke-tertiary)]">
                      <Radio size={12} className="text-[var(--kanban-hover-bg)]" />
                      <span className="text-[var(--ui-text-primary)]">{typeof ch === 'string' ? ch : String((ch as Record<string, unknown>).platform ?? ch)}</span>
                      <button onClick={() => onAction('unsubscribe', task.id)} className="ml-auto text-danger/70 hover:text-danger transition-colors"><BellOff size={13} /></button>
                    </div>
                  ))
                ) : (
                  <button onClick={() => onAction('subscribe', task.id)} className="inline-flex items-center gap-1.5 text-[0.7rem] px-2.5 py-1.5 rounded-md border border-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)] transition-colors self-start">
                    <Bell size={12} /> 订阅微信通知
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 评论输入框（评论区展开时显示）——running 时提供"附言重跑"（对齐
            Hermes CommentComposer Note & requeue） */}
        {!collapsedSections.comments && (
          <div className="flex gap-2 px-5 py-3 border-t border-[var(--ui-stroke-tertiary)]">
            <input value={commentInput} onChange={(e) => setCommentInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
              placeholder={running ? '给 worker 的注记…（可附言重跑）' : '输入评论...'} className="flex-1 text-[0.8rem] px-3 py-1.5 rounded border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
            <button onClick={handleSendComment} disabled={!commentInput.trim()} title="发表评论"
              className={cn('p-2 rounded-md transition-colors', commentInput.trim() ? 'text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]' : 'text-[var(--ui-text-quaternary)] pointer-events-none')}>
              <Send size={14} strokeWidth={1.5} />
            </button>
            {running && (
              <button onClick={handleRequeue} disabled={!commentInput.trim() || requeueing} title="附言重跑：评论 + 回收重新调度"
                className={cn('flex items-center gap-1 text-[0.7rem] px-2.5 py-1.5 rounded-md border transition-colors shrink-0',
                  commentInput.trim() && !requeueing ? 'border-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]' : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] pointer-events-none')}>
                {requeueing ? <Loader size={11} strokeWidth={1.5} className="animate-spin" /> : <ArrowLeftFromLine size={11} strokeWidth={1.5} />}
                附言重跑
              </button>
            )}
          </div>
        )}

        {/* 操作栏 — 对齐 Hermes 生命周期语义 */}
        <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-[var(--ui-stroke-tertiary)]">
          {/* triage/todo → 推进到 Ready（由 dispatcher 自动 claim 启动） */}
          {!running && !done && !blocked && !scheduled && !review && (
            <ActionButton icon={Play} label="推进" color="accent" onClick={() => onAction('promote', task.id)} busy={busy} />
          )}
          {/* blocked/scheduled → 恢复到 Ready */}
          {(blocked || scheduled) && (
            <ActionButton icon={Play} label="恢复" color="accent" onClick={() => onAction('unblock', task.id)} busy={busy} />
          )}
          {/* 🔴 对齐 Hermes StatusMenu：ready/blocked 也可直接完成（后端
              complete_task 门控 IN ('running','ready','blocked')，此前只给
              running 渲染完成按钮，抽屉入口与后端门控不一致） */}
          {blocked && (
            <ActionButton icon={CheckCircle2} label="完成" color="green" onClick={() => onAction('complete', task.id)} busy={busy} />
          )}
          {/* ready → 可完成/阻塞/滞留 */}
          {!running && !done && !blocked && !scheduled && !review && task.status === 'ready' && (
            <>
              <ActionButton icon={CheckCircle2} label="完成" color="green" onClick={() => onAction('complete', task.id)} busy={busy} />
              <ActionButton icon={Ban} label="阻塞" color="amber" onClick={() => onAction('block', task.id)} busy={busy} />
              <ActionButton icon={Clock} label="滞留" color="muted" onClick={() => onAction('schedule', task.id)} busy={busy} />
            </>
          )}
          {running && (
            <>
              <ActionButton icon={CheckCircle2} label="完成" color="green" onClick={() => onAction('complete', task.id)} busy={busy} />
              <ActionButton icon={Ban} label="阻塞" color="amber" onClick={() => onAction('block', task.id)} busy={busy} />
              <ActionButton icon={Clock} label="滞留" color="muted" onClick={() => onAction('schedule', task.id)} busy={busy} />
              <ActionButton icon={ArrowLeftFromLine} label="回收" color="muted" onClick={() => onAction('reclaim', task.id)} busy={busy} />
              {/* 🔴 对齐 Hermes request_review：运行中提交评审（需 force 覆盖确认，
                  防清活 worker claim） */}
              <ActionButton icon={Eye} label="提交评审" color="accent" onClick={() => onAction('requestReview', task.id)} busy={busy} />
              {/* 🔴 修复死代码：handleAction 有 terminate 分支但无 UI 入口——
                  补终止按钮（参数为 run_id，对齐 Worker 面板既有用法） */}
              {detail?.task?.run_id != null && (
                <ActionButton icon={X} label="终止" color="red" onClick={() => onAction('terminate', String(detail?.task?.run_id))} busy={busy} />
              )}
            </>
          )}
          {/* review — 🔴 对齐 Hermes 2026-08 一等评审生命周期：
              complete_task 门控含 review（人工可直接『通过』，免摘要后端合成）；
              恢复 = reopen（review→ready/todo，回实现者重跑）。
              评审退回返工（request_changes）由评审 run 的评论区操作。 */}
          {review && (
            <>
              <ActionButton icon={CheckCircle2} label="通过" color="green" onClick={() => onAction('complete', task.id)} busy={busy} />
              <ActionButton icon={ArrowLeftFromLine} label="恢复" color="muted" onClick={() => onAction('promote', task.id)} busy={busy} />
            </>
          )}
          {done && (
            <>
              <ActionButton icon={Archive} label="归档" color="muted" onClick={() => onAction('archive', task.id)} busy={busy} />
              <ActionButton icon={Trash2} label="删除" color="red" onClick={() => onAction('delete', task.id)} busy={busy} />
            </>
          )}
          {/* 分解/指定/重分配 */}
          {!done && (
            <>
              <ActionButton icon={GitBranch} label="分解" color="muted" onClick={() => onAction('decompose', task.id)} busy={busy} />
              <ActionButton icon={Zap} label="指定" color="accent" onClick={() => onAction('specify', task.id)} busy={busy} />
              <ActionButton icon={Radio} label="重分配" color="muted" onClick={() => { onAction('reassign', task.id); }} busy={busy} />
            </>
          )}
        </div>
    </>
  );

  // overlay 变体（侧边栏）：容器内覆盖层圆角卡片，与 CreateTaskDrawer overlay 一致
  if (variant === 'overlay') {
    return (
      <div
        className="absolute inset-0 z-50 flex flex-col bg-[var(--ui-bg-elevated)] border border-[var(--ui-stroke-tertiary)] rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {panel}
      </div>
    );
  }

  // drawer 变体（默认，主看板）：全屏遮罩 + 右侧滑出
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-overlay/40" onClick={handleShadeClick} style={{ animation: 'fadeIn 150ms ease-out' }}>
      <div className="flex flex-col h-full border-l border-[var(--kanban-col-border)] bg-[var(--color-background)]" onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 88vw)', animation: 'slideInRight 180ms ease-out' }}>
        {panel}
      </div>
    </div>
  );
}


function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">{label}</span>
      <span className="text-[var(--ui-text-primary)] break-words">{value}</span>
    </div>
  );
}

// ── 状态菜单按钮（对齐 Hermes StatusMenu）：头部彩色状态按钮 + 下拉切换状态。
//    锁定列（running/scheduled）不出现在菜单中；点击当前状态项 = 关闭。 ──
function StatusMenuButton({ status, onMove }: { status: string; onMove: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const col = COLUMNS.find(c => c.key === status);
  const tone = col?.dotColor || 'var(--ui-text-tertiary)';
  const label = col?.label || status;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide transition-colors hover:bg-[var(--ui-bg-quinary)]"
        style={{ color: tone }}
        title="切换任务状态"
      >
        <span className="size-1.5 rounded-full" style={{ backgroundColor: tone }} />
        {label}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 min-w-[130px] py-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-elevated)] shadow-lg z-50">
            {COLUMNS.filter(c => c.key === status || !LOCKED_DROP_COLUMNS.includes(c.key)).map(c => (
              <button
                key={c.key}
                onClick={() => { setOpen(false); onMove(c.key); }}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors"
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: c.dotColor }} />
                {c.label}
                {c.key === status && <Check size={12} strokeWidth={2} className="ml-auto text-[var(--ui-accent)]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── 头部 ⋯ 菜单（对齐 Hermes drawer）：复制任务 ID / 复制标题 / 归档 / 删除 ──
function MoreMenuButton({ task, onAction }: { task: KanbanTask; onAction: (action: string, taskId: string) => void }) {
  const [open, setOpen] = useState(false);

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    // 🔴 对齐 Hermes 复制后 notify（drawer.tsx host.notify，审查 d4-5）——
    //   此前静默复制无反馈
    notify({ kind: 'info', title: `已复制${label}`, message: text.slice(0, 80) });
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1 rounded-md text-[var(--ui-text-tertiary)] hover:bg-[var(--ui-bg-quinary)] hover:text-[var(--ui-text-primary)] transition-colors"
        title="任务操作"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 min-w-[130px] py-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-elevated)] shadow-lg z-50">
            <button onClick={() => copy(task.id, '任务 ID')} className="w-full text-left px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors">复制任务 ID</button>
            <button onClick={() => copy(task.title || task.id, '标题')} className="w-full text-left px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors">复制标题</button>
            <div className="border-t border-[var(--ui-stroke-tertiary)] my-1" />
            <button onClick={() => { setOpen(false); onAction('archive', task.id); }} className="w-full text-left px-3 py-1.5 text-[0.75rem] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-quinary)] transition-colors">归档</button>
            <button onClick={() => { setOpen(false); onAction('delete', task.id); }} className="w-full text-left px-3 py-1.5 text-[0.75rem] text-danger hover:bg-[color-mix(in_srgb,var(--ui-red)_12%,transparent)] transition-colors">删除</button>
          </div>
        </>
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label, color, onClick, busy }: { icon: React.FC<{ size?: number; strokeWidth?: number }>; label: string; color: string; onClick: () => void; busy: boolean }) {
  const colorMap: Record<string, string> = {
    accent: 'text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)] border-[var(--kanban-hover-bg)]',
    green: 'text-success hover:bg-success/10 border-success/25',
    amber: 'text-warning hover:bg-warning/10 border-warning/25',
    red: 'text-danger hover:bg-danger/10 border-danger/25',
    muted: 'text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] border-[var(--ui-stroke-tertiary)]',
  };
  return (
    <button disabled={busy} onClick={onClick} className={cn('inline-flex items-center gap-1.5 text-[0.75rem] px-2.5 py-1.5 rounded-md border transition-colors', colorMap[color] || colorMap.muted, busy && 'opacity-50 pointer-events-none')}>
      {busy ? <Loader size={12} strokeWidth={1.5} className="animate-spin" /> : <Icon size={12} strokeWidth={1.5} />}
      <span>{label}</span>
    </button>
  );
}
