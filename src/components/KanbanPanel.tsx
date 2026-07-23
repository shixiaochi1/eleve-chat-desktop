/**
 * KanbanPanel v3 — 看板全功能版
 *
 * 对齐 Eleve Dashboard 全部交互：
 *   - 6列 (triage/todo/ready/running/blocked/done)
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readFileAsDataURL, base64FromDataURL } from '@/utils/file';
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
  getKanbanTaskLog,
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

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

interface RunRecord {
  id?: string;
  task_id?: string;
  assignee?: string;
  outcome?: string;
  status?: string;
  profile?: string;
  elapsed_seconds?: number | null;
  ended_at?: string | number | null;
  started_at?: string | number | null;
  summary?: string;
  error?: string;
  result?: string | Record<string, unknown> | null;
  metadata?: string | Record<string, unknown> | null;
}

interface CommentRecord {
  author?: string;
  created_at?: string | number | null;
  body?: string;
}

interface AttachmentRecord {
  id?: string;
  filename?: string;
  name?: string;
  size?: number;
}

interface WorkerRecord {
  profile?: string;
  assignee?: string;
  task_id?: string;
  run_id?: string;
}

interface DispatchResult {
  error?: string;
  message?: string;
  result?: {
    claimed?: string[];
    reclaimed?: number;
    stale?: string[];
    timed_out?: string[];
    promoted?: number;
    dry_run?: boolean;
  };
}

interface BoardListRecord {
  slug?: string;
  name?: string;
  description?: string;
  color?: string;
}

interface KanbanTask {
  id: string;
  title: string;
  assignee: string;
  status: string;
  startTs: number | null;
  duration: number | null;
  summary: string;
  blocked: boolean;
  block_reason: string;
  body: string;
  priority: string | number;
  updated_at: string | number | null;
  parents: string[];
  children: string[];
  tags: string[];
  runs: RunRecord[];
  comments: CommentRecord[];
  child_done: number | null;
  child_total: number | null;
}

interface ColumnDef {
  key: string;
  label: string;
  dotColor: string;
  emptyText: string;
  canCreate: boolean;
}

interface StaleThresholds {
  [key: string]: [number, number];
}

// ═══════════════════════════════════════════════════════════════
// 常量配置
// ═══════════════════════════════════════════════════════════════

const COLUMNS: ColumnDef[] = [
  { key: 'triage',  label: 'Triage',  dotColor: 'var(--ui-purple)', emptyText: '暂无待甄别任务', canCreate: true },
  { key: 'todo',    label: 'Todo',    dotColor: 'var(--ui-text-tertiary)', emptyText: '暂无待办任务', canCreate: false },
  { key: 'ready',   label: 'Ready',   dotColor: 'var(--ui-yellow)', emptyText: '暂无就绪任务', canCreate: false },
  { key: 'running', label: 'Running', dotColor: 'var(--ui-green)', emptyText: '暂无运行中任务', canCreate: false },
  { key: 'blocked', label: 'Blocked', dotColor: 'var(--ui-red)', emptyText: '暂无阻塞任务', canCreate: false },
  { key: 'done',    label: 'Done',    dotColor: 'var(--ui-blue)', emptyText: '暂无已完成任务', canCreate: false },
];

// 列 key → 合法 status 映射
const COLUMN_STATUS: Record<string, string> = {
  triage: 'triage', todo: 'todo', ready: 'ready',
  running: 'running', blocked: 'blocked', done: 'done',
};

// ── 陈旧度阈值（秒）— [amber, red]，可被 getKanbanConfig 覆盖 ──
let staleConfig: Record<string, [number, number]> = {
  ready:   [3600, 86400],    // 1h / 24h
  running: [600, 3600],      // 10m / 60m
  blocked: [3600, 86400],    // 1h / 24h
  todo:    [604800, 2592000],// 7d / 30d
};

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function taskColumn(task: KanbanTask): string {
  const s = (task.status || '').toLowerCase();
  if (s === 'triage') return 'triage';
  if (s === 'ready') return 'ready';
  if (s === 'running') return 'running';
  if (s === 'blocked') return 'blocked';
  if (['completed', 'done', 'success', 'finished', 'ok'].includes(s)) return 'done';
  return 'todo';
}

function isBlocked(task: KanbanTask): boolean { return (task.status || '').toLowerCase() === 'blocked'; }
function isDone(task: KanbanTask): boolean { return ['completed','done','success','finished','ok'].includes((task.status||'').toLowerCase()); }

function fmtAge(ts: string | number | null | undefined): string {
  if (!ts) return '';
  try {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    if (isNaN(d.getTime())) return '';
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return '刚刚';
    if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
    return `${Math.floor(sec / 86400)}天前`;
  } catch { return ''; }
}

function fmtDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分`;
  return `${Math.floor(min / 60)}时${min % 60}分`;
}

function priorityStyle(p: string | number | null | undefined): Record<string, string> | null {
  if (!p) return null;
  const lvl = String(p).replace(/^p/i, '');
  switch (lvl) {
    case '0': return { bg: 'color-mix(in srgb, var(--ui-red) 15%, transparent)', border: 'color-mix(in srgb, var(--ui-red) 40%, transparent)', text: 'var(--ui-red)' };
    case '1': return { bg: 'color-mix(in srgb, var(--ui-yellow) 15%, transparent)', border: 'color-mix(in srgb, var(--ui-yellow) 40%, transparent)', text: 'var(--ui-yellow)' };
    case '2': return { bg: 'color-mix(in srgb, var(--ui-blue) 12%, transparent)', border: 'color-mix(in srgb, var(--ui-blue) 35%, transparent)', text: 'var(--ui-blue)' };
    case '3': return { bg: 'color-mix(in srgb, var(--ui-text-tertiary) 10%, transparent)', border: 'color-mix(in srgb, var(--ui-text-tertiary) 30%, transparent)', text: 'var(--ui-text-tertiary)' };
    default: return null;
  }
}

// 陈旧度计算：返回 'amber' | 'red' | null
function getStaleness(task: KanbanTask): string | null {
  const col = taskColumn(task) as keyof StaleThresholds;
  const thresholds = staleConfig[col];
  if (!thresholds) return null;
  const ts = task.updated_at || task.startTs;
  if (!ts) return null;
  try {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    if (isNaN(d.getTime())) return null;
    const elapsedSec = (Date.now() - d.getTime()) / 1000;
    if (elapsedSec >= thresholds[1]) return 'red';
    if (elapsedSec >= thresholds[0]) return 'amber';
  } catch {}
  return null;
}

function normalizeTask(raw: Record<string, unknown>): KanbanTask {
  const isKanban = raw.title !== undefined;
  const s = (v: unknown, fallback = ''): string => (v as string) || fallback;
  const n = (v: unknown): number | null => typeof v === 'number' ? v : null;
  const b = (v: unknown, fallback = false): boolean => typeof v === 'boolean' ? v : fallback;
  const arr = (v: unknown) => Array.isArray(v) ? v : [];
  return {
    id: s(raw.id),
    title: isKanban ? s(raw.title) : s(raw.goal),
    assignee: isKanban ? s(raw.assignee) : s(raw.model),
    status: s(raw.status, 'ready'),
    startTs: isKanban ? (typeof raw.created_at === 'number' ? raw.created_at * 1000 : null) : n(raw.startTs),
    duration: n(raw.duration),
    summary: s(raw.summary),
    blocked: b(raw.blocked),
    block_reason: s(raw.block_reason),
    body: s(raw.body),
    priority: String(raw.priority ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    parents: arr(raw.parents) as string[],
    children: arr(raw.children) as string[],
    tags: arr(raw.tags) as string[],
    runs: arr(raw.runs) as RunRecord[],
    comments: arr(raw.comments) as CommentRecord[],
    child_done: n(raw.child_done) ?? n(raw.children_done),
    child_total: n(raw.child_total) ?? n(raw.children_total),
  };
}

function normalizeBoardData(boardResult: Record<string, unknown> | null | undefined): KanbanTask[] {
  if (!boardResult) return [];
  const columns = (boardResult.columns || []) as Record<string, unknown>[];
  const tasks: KanbanTask[] = [];
  for (const col of columns) {
    const items = (col.tasks || col.items || []) as Record<string, unknown>[];
    for (const t of items) tasks.push(normalizeTask(t));
  }
  return tasks;
}

function mergeTasks(apiTasks: KanbanTask[], sseTasks: Record<string, unknown>): KanbanTask[] {
  if (!sseTasks || Object.keys(sseTasks).length === 0) return apiTasks;
  const apiMap = new Map(apiTasks.map(t => [t.id, t]));
  for (const [id, sseTask] of Object.entries(sseTasks)) {
    const n = normalizeTask(sseTask as Record<string, unknown>);
    if (apiMap.has(id)) {
      const ex = apiMap.get(id)!;
      apiMap.set(id, { ...ex, status: n.status || ex.status, summary: n.summary || ex.summary, duration: n.duration ?? ex.duration });
    } else if (n.status !== 'archived') {
      apiMap.set(id, n);
    }
  }
  return Array.from(apiMap.values()).filter(t => t.status !== 'archived');
}

// ═══════════════════════════════════════════════════════════════
// 子组件
// ═══════════════════════════════════════════════════════════════

function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  const s = (status || '').toLowerCase();
  const colorMap: Record<string, string> = {
    triage: 'var(--ui-purple)', todo: 'var(--ui-text-tertiary)',
    ready: 'var(--ui-yellow)', running: 'var(--ui-green)', blocked: 'var(--ui-red)',
    done: 'var(--ui-blue)', completed: 'var(--ui-blue)', archived: 'var(--ui-text-quaternary)',
  };
  return <span className="shrink-0 rounded-full" style={{ width: size, height: size, backgroundColor: colorMap[s] || colorMap.todo }} />;
}

// ── 任务卡片（Trail 极简风格 + 删除按钮）──
function TaskCard({ task, onSelect, isSelected, onDragStart, checked, onCheck, justCreated, isDragging, onDelete }: { task: KanbanTask; onSelect: (task: KanbanTask) => void; isSelected: boolean; onDragStart: (id: string) => void; checked: boolean; onCheck: (id: string) => void; justCreated: boolean; isDragging: boolean; onDelete?: (id: string) => void }) {
  const blocked = isBlocked(task);
  const done = isDone(task);
  const running = task.status === 'running';
  const staleness = getStaleness(task);
  const hasProgress = (task.child_total ?? 0) > 0;
  const progressFull = hasProgress && task.child_done === task.child_total;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hovered, setHovered] = useState(false);

  const priorityLevel = task.priority ? String(task.priority).replace(/^p/i, '') : null;
  const showBar = isSelected || (priorityLevel !== null && ['0', '1', '2', '3'].includes(priorityLevel));

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.stopPropagation();
      onCheck?.(task.id);
    } else {
      onSelect(task);
    }
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
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(task.id);
      }}
      onClick={handleClick}
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
          {task.updated_at && <span className="tabular-nums whitespace-nowrap">{fmtAge(task.updated_at)}</span>}
          <span className="font-mono text-[0.6rem] tracking-wide text-[var(--ui-text-quaternary)] ml-auto shrink-0">
            #{typeof task.id === 'string' ? task.id.slice(0, 6) : task.id}
          </span>
        </div>
      </div>
    </div>
  );
}

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
}

function KanbanColumn({ column, tasks, onSelect, selectedId, onDragStart, onDrop, creatingIn, onCreateStart, onCreateCancel, checkedIds, onCheck, runningLanes, justCreatedIds, draggingTaskId, onCreateSubmit, newTitle, setNewTitle, onDelete }: KanbanColumnProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const taskId = e.dataTransfer.getData('text/plain'); if (taskId) onDrop(column.key, taskId); };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col shrink-0 min-w-0 min-h-0 rounded-lg border transition-colors duration-150',
        'border-[var(--kanban-col-border)] bg-[var(--kanban-col-bg)]',
        dragOver && 'border-[var(--kanban-card-selected-bar)] border-dashed bg-[color-mix(in_srgb,var(--kanban-card-selected-bar)_5%,var(--kanban-col-bg))]',
      )}
      style={{ flex: '1 1 0%' }}
    >
      {/* 列头 — 状态小色条 + 标题 + 计数 */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="shrink-0 rounded-[var(--kanban-col-header-bar-radius)]" style={{ width: 24, height: 3, backgroundColor: column.dotColor, borderRadius: 'var(--kanban-col-header-bar-radius)' }} />
        <span className="text-[0.85rem] font-semibold text-[var(--ui-text-primary)] flex-1 tracking-[0.01em]">{column.label}</span>
        <span className="text-[0.75rem] tabular-nums text-[var(--ui-text-tertiary)] font-medium">{tasks.length}</span>
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
                    checked={checkedIds?.has(task.id)} onCheck={onCheck} justCreated={justCreatedIds?.has(task.id)} isDragging={draggingTaskId === task.id} onDelete={onDelete} />
                ))}
              </div>
            </div>);
          })
        ) : (
          tasks.map((task: KanbanTask) => (
            <TaskCard key={task.id} task={task} onSelect={onSelect} isSelected={selectedId === task.id} onDragStart={onDragStart}
              checked={checkedIds?.has(task.id)} onCheck={onCheck} justCreated={justCreatedIds?.has(task.id)} isDragging={draggingTaskId === task.id} onDelete={onDelete} />
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
  onViewLog: (taskId: string) => void;
  workerLog: string | Record<string, unknown> | null;
  homeChannels: Array<{ platform?: string } | string>;
}

function TaskDrawer({ task, onClose, onAction, loadingId, onRefresh, onViewLog, workerLog, homeChannels }: TaskDrawerProps) {
  const busy = loadingId === task?.id;
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingPriority, setEditingPriority] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null); // Phase B7: Run 详情展开
  const [expandedRunData, setExpandedRunData] = useState<RunRecord | null>(null);
  const [expandedRunLoading, setExpandedRunLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const data = await getKanbanRun(runId);
      setExpandedRunData(data?.run || data || null);
    } catch {
      setExpandedRunData(null);
    }
    setExpandedRunLoading(false);
  }, [expandedRunId]);

  // 加载评论
  useEffect(() => {
    if (!task?.id) return;
    getKanbanTask(task.id).then(data => {
      setComments(data?.comments || []);
    }).catch(() => {});
  }, [task?.id]);

  // 加载附件
  useEffect(() => {
    if (!task?.id) return;
    getKanbanAttachments(task.id).then(data => {
      setAttachments(data?.attachments || data || []);
    }).catch(() => {});
  }, [task?.id]);

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

  // 发送评论 → 调 addKanbanComment → 刷新评论列表
  const handleSendComment = async () => {
    if (!commentInput.trim()) return;
    try {
      await addKanbanComment(task.id, commentInput.trim(), 'user');
      setCommentInput('');
      const data = await getKanbanTask(task.id);
      setComments(data?.comments || []);
    } catch (err) {
      console.error('[KanbanPanel] Comment failed:', err);
    }
  };

  // 保存标题 → 行内编辑
  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) { setEditingTitle(false); return; }
    if (trimmed === (task.title || '')) { setEditingTitle(false); return; }
    try {
      await updateKanbanTask(task.id, { title: trimmed });
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
      await updateKanbanTask(task.id, { priority: newPriority ? Number(newPriority) : null });
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save priority failed:', err);
    }
  };

  // 保存 Assignee → 行内编辑
  const handleSaveAssignee = async () => {
    setEditingAssignee(false);
    const trimmed = assigneeDraft.trim();
    if (trimmed === (task.assignee || '')) return;
    try {
      await updateKanbanTask(task.id, { assignee: trimmed || null });
      onRefresh?.();
    } catch (err) {
      console.error('[KanbanPanel] Save assignee failed:', err);
    }
  };

  // 保存描述 → 调 updateKanbanTask → 刷新
  const handleSaveBody = async () => {
    try {
      await updateKanbanTask(task.id, { body: bodyDraft });
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
      await uploadKanbanAttachment(task.id, file.name, base64);
      const data = await getKanbanAttachments(task.id);
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-overlay/40" onClick={handleShadeClick} style={{ animation: 'fadeIn 150ms ease-out' }}>
      <div className="flex flex-col h-full border-l border-[var(--kanban-col-border)] bg-[var(--color-background)]" onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 88vw)', animation: 'slideInRight 180ms ease-out' }}>
        {/* 抽屉头 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ui-stroke-tertiary)]">
          <div className="flex items-center gap-2">
            <StatusDot status={task.status} size={10} />
            <span className="font-mono text-[0.8rem] text-[var(--ui-text-quaternary)]">#{typeof task.id === 'string' ? task.id.slice(0, 8) : task.id}</span>
          </div>
          <button onClick={onClose} className="text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] transition-colors p-1"><X size={18} strokeWidth={1.5} /></button>
        </div>

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
                  {/* 负责人 — 行内可编辑 */}
                  <div className="flex gap-3">
                    <span className="w-16 shrink-0 text-[var(--ui-text-tertiary)]">负责人</span>
                    {editingAssignee ? (
                      <input value={assigneeDraft} onChange={(e) => setAssigneeDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAssignee(); if (e.key === 'Escape') setEditingAssignee(false); }}
                        onBlur={handleSaveAssignee} autoFocus
                        placeholder="留空自动分配"
                        className="flex-1 text-[0.8rem] px-1 py-0.5 -my-0.5 rounded border border-[var(--kanban-hover-bg)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none" />
                    ) : (
                      <span onClick={() => { setEditingAssignee(true); setAssigneeDraft(task.assignee || ''); }}
                        className="text-[var(--ui-text-primary)] cursor-pointer rounded px-1 -mx-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors break-words"
                        title="点击编辑负责人">
                        {task.assignee || '未分配'}
                      </span>
                    )}
                  </div>
                  <MetaRow label="创建时间" value={task.startTs ? fmtAge(task.startTs) : '—'} />
                  <MetaRow label="耗时" value={task.duration ? fmtDuration(task.duration) : '—'} />
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

                {/* 依赖 */}
                {(task.parents?.length > 0 || task.children?.length > 0) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">依赖关系</span>
                    <div className="flex flex-wrap gap-1.5">
                      {task.parents.map((p: string) => <span key={p} className="font-mono text-[0.68rem] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] border border-[var(--ui-stroke-tertiary)]">↑ {typeof p === 'string' ? p.slice(0, 6) : p}</span>)}
                      {task.children.map((c: string) => <span key={c} className="font-mono text-[0.68rem] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] border border-[var(--ui-stroke-tertiary)]">↓ {typeof c === 'string' ? c.slice(0, 6) : c}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

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
                {(!task.runs || task.runs.length === 0) ? (
                  <p className="text-[0.8rem] text-[var(--ui-text-tertiary)] text-center py-6">暂无运行记录</p>
                ) : (
                  task.runs.map((run: RunRecord, i: number) => (
                    <div key={i} className="border-l-2 pl-3 py-1.5 rounded-r-md bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)]"
                      style={{ borderLeftColor: runBorderColor(run.outcome || run.status) }}>
                      <div className="flex items-center gap-3 text-[0.7rem]">
                        <span className="font-mono font-semibold tracking-wide text-[var(--ui-text-primary)]">{run.outcome || run.status || '—'}</span>
                        {run.profile && <span className="text-[var(--ui-text-tertiary)]">{run.profile}</span>}
                        {run.elapsed_seconds != null && <span className="tabular-nums text-[var(--ui-text-tertiary)]">{fmtDuration(run.elapsed_seconds * 1000)}</span>}
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
                {/* 上游依赖 (parents) */}
                <div>
                  <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">上游依赖（父任务）</span>
                  {(!task.parents || task.parents.length === 0) && <p className="text-[0.7rem] text-[var(--ui-text-quaternary)] mt-1">无</p>}
                  {task.parents?.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {task.parents.map((p: string) => (
                        <div key={p} className="flex items-center gap-2 text-[0.75rem]">
                          <GitBranch size={11} strokeWidth={1.5} className="text-[var(--ui-text-quaternary)] shrink-0" />
                          <span className="font-mono text-[var(--ui-text-primary)]">{typeof p === 'string' ? p.slice(0, 8) : p}</span>
                          <button onClick={async () => { try { await deleteKanbanLink(p, task.id); onRefresh(); } catch {} }}
                            className="ml-auto text-[var(--ui-text-quaternary)] hover:text-danger transition-colors"><X size={11} strokeWidth={1.5} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 下游依赖 (children) */}
                <div>
                  <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">下游依赖（子任务）</span>
                  {(!task.children || task.children.length === 0) && <p className="text-[0.7rem] text-[var(--ui-text-quaternary)] mt-1">无</p>}
                  {task.children?.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {task.children.map((c: string) => (
                        <div key={c} className="flex items-center gap-2 text-[0.75rem]">
                          <GitBranch size={11} strokeWidth={1.5} className="text-[var(--ui-text-quaternary)] shrink-0" />
                          <span className="font-mono text-[var(--ui-text-primary)]">{typeof c === 'string' ? c.slice(0, 8) : c}</span>
                          <button onClick={async () => { try { await deleteKanbanLink(task.id, c); onRefresh(); } catch {} }}
                            className="ml-auto text-[var(--ui-text-quaternary)] hover:text-danger transition-colors"><X size={11} strokeWidth={1.5} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* 添加依赖 */}
                <div className="border-t border-[var(--ui-stroke-tertiary)] pt-2.5">
                  <AddLinkForm taskId={task.id} direction="parent" onSubmit={async (otherId: string) => { await createKanbanLink(otherId, task.id); onRefresh(); }} />
                  <AddLinkForm taskId={task.id} direction="child" onSubmit={async (otherId: string) => { await createKanbanLink(task.id, otherId); onRefresh(); }} />
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
                      <button onClick={() => { const base = getApiBase(); window.open(`${base}/api/kanban/attachments/${a.id}?board=default`, '_blank'); }} title="下载附件"
                        className="text-[var(--kanban-hover-bg)] hover:text-[var(--kanban-hover-bg)] transition-colors ml-1"><Download size={11} strokeWidth={1.5} /></button>
                      <button onClick={async () => { try { await deleteKanbanAttachment(a.id!); const data = await getKanbanAttachments(task.id); setAttachments(data?.attachments || data || []); } catch {} }} title="删除附件"
                        className="text-danger/70 hover:text-danger transition-colors ml-1"><Trash2 size={11} /></button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── 日志 ── */}
          <div>
            <button onClick={() => setCollapsedSections(prev => ({...prev, log: !prev.log}))}
              className="flex items-center gap-2 w-full text-left py-2.5 px-1 border-b border-[var(--ui-stroke-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_3%,transparent)] transition-colors">
              <ChevronDown size={12} strokeWidth={1.5}
                className={cn('text-[var(--ui-text-tertiary)] transition-transform', !collapsedSections.log && 'rotate-180')} />
              <span className="text-[0.72rem] font-semibold tracking-wide text-[var(--ui-text-tertiary)]">日志</span>
            </button>
            {!collapsedSections.log && (
              <div className="py-3 flex flex-col gap-2">
                <button onClick={() => onViewLog?.(task.id)} className="inline-flex items-center gap-1.5 text-[0.7rem] px-2.5 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-primary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors self-start">
                  <FileText size={11} /> 加载日志
                </button>
                {workerLog && (
                  <pre className="text-[0.7rem] font-mono leading-relaxed p-3 rounded-md bg-[color-mix(in_srgb,var(--ui-text-primary)_4%,transparent)] border border-[var(--ui-stroke-tertiary)] overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto text-[var(--ui-text-primary)]">
                    {typeof workerLog === 'string' ? workerLog : JSON.stringify(workerLog, null, 2)}
                  </pre>
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

        {/* 评论输入框（评论区展开时显示） */}
        {!collapsedSections.comments && (
          <div className="flex gap-2 px-5 py-3 border-t border-[var(--ui-stroke-tertiary)]">
            <input value={commentInput} onChange={(e) => setCommentInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
              placeholder="输入评论..." className="flex-1 text-[0.8rem] px-3 py-1.5 rounded border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
            <button onClick={handleSendComment} disabled={!commentInput.trim()} className={cn('p-2 rounded-md transition-colors', commentInput.trim() ? 'text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]' : 'text-[var(--ui-text-quaternary)] pointer-events-none')}>
              <Send size={14} strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* 操作栏 */}
        <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-[var(--ui-stroke-tertiary)]">
          {!running && !done && !blocked && <ActionButton icon={Play} label="开始" color="accent" onClick={() => onAction('start', task.id)} busy={busy} />}
          {blocked && <ActionButton icon={Play} label="恢复" color="accent" onClick={() => onAction('start', task.id)} busy={busy} />}
          {running && (
            <>
              <ActionButton icon={CheckCircle2} label="完成" color="green" onClick={() => onAction('complete', task.id)} busy={busy} />
              <ActionButton icon={Ban} label="阻塞" color="amber" onClick={() => onAction('block', task.id)} busy={busy} />
              <ActionButton icon={ArrowLeftFromLine} label="回收" color="muted" onClick={() => onAction('reclaim', task.id)} busy={busy} />
            </>
          )}
          {done && (
            <>
              <ActionButton icon={Archive} label="归档" color="muted" onClick={() => onAction('archive', task.id)} busy={busy} />
              <ActionButton icon={Trash2} label="删除" color="red" onClick={() => onAction('delete', task.id)} busy={busy} />
            </>
          )}
          {/* Phase 4.3: 分解/指定 */}
          {!done && (
            <>
              <ActionButton icon={GitBranch} label="分解" color="muted" onClick={() => onAction('decompose', task.id)} busy={busy} />
              <ActionButton icon={Zap} label="指定" color="accent" onClick={() => onAction('specify', task.id)} busy={busy} />
              <ActionButton icon={Radio} label="重分配" color="muted" onClick={() => { onAction('reassign', task.id); }} busy={busy} />
            </>
          )}
        </div>
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

// ═══════════════════════════════════════════════════════════════
// 看板面板主组件
// ═══════════════════════════════════════════════════════════════

export default function KanbanPanel({ monitorState, board = 'default' }: { monitorState?: Record<string, unknown>; board?: string }) {
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
  // Phase B3: 手动调度
  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchDryRun, setDispatchDryRun] = useState(true);
  const [dispatchMaxSpawn, setDispatchMaxSpawn] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);
  // Phase B5: 重分配
  const [showReassign, setShowReassign] = useState(false);
  const [reassignProfile, setReassignProfile] = useState('');
  const [reassignReclaim, setReassignReclaim] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [workerLog, setWorkerLog] = useState<any>(null);
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
        staleConfig = { ...staleConfig, ...data.stale_thresholds };
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

  // SSE 实时推送 + pollKanbanEvents 降级轮询
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let cursor = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let sseAlive = false;

    // 处理轮询返回的事件（复用 SSE 的 same 逻辑）
    const applyEvents = (events: { task_id: string; kind: string; payload?: { summary?: string; reason?: string } }[]) => {
      if (!events?.length) return;
      const patchKinds = ['completed','blocked','claimed','unblocked','archived','spawn_failed','gave_up','crashed','timed_out','promoted','recomputed_ready'];
      const refreshKinds = ['specified','assigned','reclaimed','decomposed','created','linked','unlinked'];
      for (const evt of events) {
        setApiTasks(prev => {
                  const updated = prev.map(t => {
                    if (t.id !== evt.task_id) return t;

                    const task: KanbanTask = { ...t };
                    switch (evt.kind) {
              case 'completed': task.status = 'completed'; if (evt.payload?.summary) task.summary = evt.payload.summary; return task;
              case 'blocked': task.status = 'blocked'; task.blocked = true; if (evt.payload?.reason) task.block_reason = evt.payload.reason; return task;
              case 'claimed': task.status = 'running'; return task;
              case 'unblocked': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
              case 'promoted': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
              case 'recomputed_ready': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
              case 'archived': return null;
              case 'spawn_failed': case 'gave_up': case 'crashed': case 'timed_out': task.status = 'ready'; return task;
              default: return null;
            }
          }).filter((t): t is KanbanTask => t !== null);
          if (prev.some(t => t.id === evt.task_id) && !patchKinds.includes(evt.kind)) setTimeout(() => loadBoard(), 100);
          return updated;
        });
        if (refreshKinds.includes(evt.kind)) setTimeout(() => loadBoard(), 100);
      }
    };

    // 降级轮询：SSE 断连时每 5s 用 pollKanbanEvents 拉取
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (sseAlive) { clearInterval(pollTimer as any); pollTimer = null; return; }
        pollKanbanEvents(String(cursor), currentBoard).then(data => {
          const events = data?.events || data || [];
          if (events.length) { applyEvents(events); if (data?.cursor) cursor = data.cursor; }
        }).catch(() => {});
      }, 5000);
    };

    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    const connectSSE = () => {
      if (eventSource) { eventSource.close(); eventSource = null; }
      const baseUrl = getApiBase();
      eventSource = new EventSource(`${baseUrl}/api/kanban/events?since=${cursor}&board=${encodeURIComponent(currentBoard)}`);
      eventSource.addEventListener('kanban', (e) => {
        try {
          const evt = JSON.parse(e.data);
          const patchKinds = ['completed','blocked','claimed','unblocked','archived','spawn_failed','gave_up','crashed','timed_out','promoted','recomputed_ready'];
          const refreshKinds = ['specified','assigned','reclaimed','decomposed','created','linked','unlinked'];
          setApiTasks(prev => {
                    const updated = prev.map(t => {
                      if (t.id !== evt.task_id) return t;

                      const task: KanbanTask = { ...t };
                      switch (evt.kind) {
                case 'completed': task.status = 'completed'; if (evt.payload?.summary) task.summary = evt.payload.summary; return task;
                case 'blocked': task.status = 'blocked'; task.blocked = true; if (evt.payload?.reason) task.block_reason = evt.payload.reason; return task;
                case 'claimed': task.status = 'running'; return task;
                case 'unblocked': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
                case 'promoted': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
                case 'recomputed_ready': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
                case 'archived': return null;
                case 'spawn_failed': case 'gave_up': case 'crashed': case 'timed_out': task.status = 'ready'; return task;
                default: return null;
              }
            }).filter((t): t is KanbanTask => t !== null);
            if (prev.some(t => t.id === evt.task_id) && !patchKinds.includes(evt.kind)) setTimeout(() => loadBoard(), 100);
            return updated;
          });
          if (refreshKinds.includes(evt.kind)) setTimeout(() => loadBoard(), 100);
        } catch {}
      });
      eventSource.addEventListener('kanban_cursor', (e) => { try { cursor = JSON.parse(e.data).cursor; } catch {} });
      eventSource.onopen = () => { sseAlive = true; stopPolling(); };
      eventSource.onerror = () => {
        sseAlive = false;
        eventSource?.close();
        startPolling();
        reconnectTimer = setTimeout(connectSSE, 3000);
      };
    };
    connectSSE();
    return () => { eventSource?.close(); if (reconnectTimer) clearTimeout(reconnectTimer); stopPolling(); };
  }, [currentBoard, loadBoard]);

  useEffect(() => { const i = setInterval(() => loadBoard(), 60000); return () => clearInterval(i); }, [loadBoard]);

  const sseTasks = (monitorState?.delegateTasks || {}) as Record<string, unknown>;
  const allTasks = useMemo(() => mergeTasks(apiTasks, sseTasks), [apiTasks, sseTasks]);

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
    // 租户筛选
    if (tenantFilter.trim()) {
      const tenantQ = tenantFilter.toLowerCase();
      result = result.filter(t => (t.tags || []).some((tag: string) => String(tag).toLowerCase().includes(tenantQ)));
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
  const handleDrop = useCallback(async (columnKey: string, taskId: string) => {
    const newStatus = COLUMN_STATUS[columnKey];
    if (!newStatus) return;

    // 对齐 Eleve: done/blocked/archived 为破坏性操作，需确认
    if (newStatus === 'done') {
      // 状态门控：只有 ready/running/blocked 可完成（对齐 Eleve complete_task WHERE 条件）
      const task = apiTasks.find(t => t.id === taskId);
      if (task && !['ready', 'running', 'blocked'].includes(task.status)) {
        alert(`无法完成该任务：当前状态为「${task.status}」，必须先提升到 ready/running/blocked。\n${task.status === 'todo' ? '提示：该任务有未完成的父任务，请先完成父任务。' : task.status === 'triage' ? '提示：该任务需要先进行细化（specify/decompose）。' : ''}`);
        return;
      }
      const summary = prompt('请输入完成摘要（必填）：');
      if (summary === null) return; // 用户取消
      if (!summary.trim()) {
        alert('完成摘要不能为空，操作已取消。');
        return;
      }
      // 乐观更新
      setApiTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
      try {
        await updateKanbanTask(taskId, { status: newStatus, result: summary.trim(), summary: summary.trim() });
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
      await updateKanbanTask(taskId, { status: newStatus });
    } catch (err) {
      console.error('[KanbanPanel] Drag drop failed, rolling back:', err);
      await loadBoard(); // 回滚：重新加载真实数据
    }
  }, [loadBoard, apiTasks]);

  // 创建任务 → 从创建抽屉提交
  const resetCreateForm = useCallback(() => {
    setNewTitle(''); setNewBody(''); setNewAssignee(''); setNewPriority('');
    setNewSkills(''); setNewParent(''); setNewGoalMode(false); setNewGoalMaxTurns('20');
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      // Eleve 仪表盘对齐：不发送 status 字段，只发 triage 标志，让后端决定状态
      const payload: Record<string, unknown> = { title: newTitle.trim(), board: currentBoard };
      if (newBody.trim()) payload.body = newBody.trim();
      // assignee: 用户指定 > default_profile > 'default'（对齐 Eleve kanban_create assignee 必填）
      const effectiveAssignee = newAssignee.trim()
        || orchestration?.default_profile
        || 'default';
      payload.assignee = effectiveAssignee;
      if (Number(newPriority)) payload.priority = Number(newPriority);
      if (newSkills.trim()) payload.skills = newSkills.trim();
      if (newParent) payload.parents = [newParent];
      if (newGoalMode) { payload.goal_mode = true; payload.goal_max_turns = Number(newGoalMaxTurns) || 20; }
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
      await loadBoard();
    } catch (err) {
      console.error('[KanbanPanel] Create task failed:', err);
    }
  }, [currentBoard, creatingIn, newTitle, newBody, newAssignee, newPriority, newSkills, newParent, newGoalMode, newGoalMaxTurns, loadBoard, orchestration]);

  // 操作
  const handleAction = useCallback(async (action: string, taskId: string) => {
    setLoadingId(taskId);
    try {
      switch (action) {
        case 'start': await updateKanbanTask(taskId, { status: 'running' }); break;
        case 'complete': await updateKanbanTask(taskId, { status: 'done' }); break;
        case 'block': await updateKanbanTask(taskId, { status: 'blocked' }); break;
        case 'reclaim': await reclaimKanbanTask(taskId, 'manual reclaim'); break;
        case 'archive': await updateKanbanTask(taskId, { status: 'archived' }); break;
        case 'delete': await deleteKanbanTask(taskId); break;
        // Phase 4.3: 分解/指定
        case 'decompose': await decomposeKanbanTask(taskId, 'user'); break;
        case 'specify': await specifyKanbanTask(taskId, 'user'); break;
        // Phase 4.6: 终止 run
        case 'terminate': await terminateKanbanRun(taskId, 'manual'); break;
        // Phase 4.7: 订阅/取消订阅
        case 'subscribe': await subscribeKanbanHome(taskId, 'weixin'); break;
        case 'unsubscribe': await unsubscribeKanbanHome(taskId, 'weixin'); break;
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
  }, [loadBoard]);

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
      await bulkUpdateKanbanTasks(ids, { action });
      setCheckedIds(new Set());
      await loadBoard();
    } catch (err) {
      console.error('[KanbanPanel] Bulk action failed:', err);
    }
  }, [checkedIds, loadBoard]);

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
      await bulkUpdateKanbanTasks(ids, { action: 'priority', priority: Number(bulkPriority) });
      setCheckedIds(new Set());
      setShowBulkPriority(false);
      setBulkPriority('');
      await loadBoard();
    } catch (err) {
      console.error('[KanbanPanel] Bulk priority failed:', err);
    }
  }, [checkedIds, bulkPriority, loadBoard]);

  // Phase 4.4: Worker 日志查看
  const handleViewLog = useCallback(async (taskId: string) => {
    try {
      const data = await getKanbanTaskLog(taskId, 50, currentBoard);
      setWorkerLog(data?.log || data || '无日志');
    } catch (err) {
      setWorkerLog('加载日志失败');
    }
  }, [currentBoard]);

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

  // Phase B3: 手动调度
  const handleDispatch = useCallback(async () => {
    setDispatching(true);
    setDispatchResult(null);
    try {
      const params: Record<string, any> = { board: currentBoard, dry_run: dispatchDryRun };
      if (dispatchMaxSpawn.trim()) params.max_spawn = parseInt(dispatchMaxSpawn, 10);
      const data = await dispatchKanbanTasks(params);
      setDispatchResult(data);
      // 如果不是 dry_run，调度后刷新看板
      if (!dispatchDryRun) loadBoard();
    } catch (err) {
      setDispatchResult({ error: (err as Error).message || '调度失败' });
    } finally {
      setDispatching(false);
    }
  }, [currentBoard, dispatchDryRun, dispatchMaxSpawn, loadBoard]);

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

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0 gap-3">
        {/* Phase 4.1: Board Picker */}
        <div className="relative">
          <button onClick={() => setShowBoardPicker(v => !v)}
            className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-[var(--ui-text-primary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] px-2 py-1 rounded-md transition-colors">
            看板{currentBoard !== 'default' ? `: ${currentBoard}` : ''}
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
                      {name}
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
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader size={12} strokeWidth={1.5} className="animate-spin text-[var(--color-muted-foreground)]" />}
          {error && <span className="text-[0.7rem] text-danger">{error}</span>}
          {/* 调度按钮 */}
          <button onClick={() => { setShowDispatch(true); setDispatchResult(null); }} title="手动调度"
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
          {/* C1: 编排配置 */}
          {orchestration && (
            <div className="mt-1.5 pt-1.5 border-t border-warning/15">
              <div className="flex items-center gap-2 font-semibold text-warning mb-1"><Settings2 size={12} /> 编排配置</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.75rem]">
                <span className="text-[var(--ui-text-tertiary)]">max_concurrent</span>
                <span className="font-mono">{orchestration.max_concurrent ?? '-'}</span>
                <span className="text-[var(--ui-text-tertiary)]">auto_decompose</span>
                <span className="font-mono">{orchestration.auto_decompose ? '✓' : '✗'}</span>
                <span className="text-[var(--ui-text-tertiary)]">claim_ttl_seconds</span>
                <span className="font-mono">{orchestration.claim_ttl_seconds ?? '-'}</span>
                <span className="text-[var(--ui-text-tertiary)]">default_profile</span>
                <span className="font-mono">{orchestration.default_profile ?? '-'}</span>
              </div>
            </div>
          )}
          {/* C1: Profile 列表 */}
          {profiles.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-warning/15">
              <div className="flex items-center gap-2 font-semibold text-warning mb-1"><UserCircle size={12} /> 可用 Profile ({profiles.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {profiles.map((p, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[0.7rem] font-mono bg-warning/10 text-warning border border-warning/15">
                    {typeof p === 'string' ? p : p.name || p.profile || JSON.stringify(p)}
                  </span>
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

      {/* 6列看板 — 列等高 stretch，min-h-0 确保高度受父级约束 */}
      <div className="flex flex-1 items-stretch min-h-0 min-w-0 px-4 pb-4" style={{ gap: 'var(--kanban-col-gap)' }}>
        {COLUMNS.map(col => (
          <KanbanColumn key={col.key} column={col} tasks={col.key === 'running' ? grouped.running : grouped[col.key]}
            runningLanes={col.key === 'running' ? runningLanes : undefined}
            onSelect={setSelectedTask} selectedId={selectedTask?.id}
            onDragStart={(taskId: string) => setDraggingTaskId(taskId)}
            onDrop={handleDrop}
            creatingIn={creatingIn} onCreateStart={setCreatingIn} onCreateCancel={() => setCreatingIn(null)}
            checkedIds={checkedIds} onCheck={handleCheck} justCreatedIds={justCreatedIds} draggingTaskId={draggingTaskId}
            onCreateSubmit={handleCreateSubmit} newTitle={newTitle} setNewTitle={setNewTitle} onDelete={handleDeleteTask} />
        ))}
      </div>

      {/* 详情抽屉 */}
      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} onAction={handleAction} loadingId={loadingId} onRefresh={loadBoard}
          onViewLog={handleViewLog} workerLog={workerLog} homeChannels={homeChannels} />
      )}

      {/* 创建任务抽屉 */}
      {creatingIn && (
        <div className="fixed inset-0 z-50 flex justify-end bg-overlay/40" onClick={() => { setCreatingIn(null); resetCreateForm(); }} style={{ animation: 'fadeIn 150ms ease-out' }}>
        <div className="fixed inset-y-0 right-0 w-[420px] max-w-full z-50 flex flex-col border-l border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl animate-in slide-in-from-right duration-200" onClick={(e) => e.stopPropagation()}>
          {/* 头部 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="text-[0.95rem] font-semibold text-[var(--color-foreground)]">新建任务 → {COLUMNS.find(c => c.key === creatingIn)?.label || creatingIn}</h3>
            <button onClick={() => { setCreatingIn(null); resetCreateForm(); }} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors">
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
          {/* 表单 */}
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">标题 *</label>
              <textarea autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCreateSubmit(); } if (e.key === 'Escape') { setCreatingIn(null); resetCreateForm(); } }}
                placeholder={creatingIn === 'triage' ? '粗略想法 — AI 将细化...' : '任务标题'}
                rows={2}
                className="w-full text-[0.85rem] px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] resize-y focus:outline-none focus:border-[var(--color-ring)] min-h-[3rem]" />
            </div>
            {/* Body */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">详细描述</label>
              <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)}
                placeholder="描述任务的目标、范围、验收标准..."
                rows={5}
                className="w-full text-[0.85rem] px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] resize-y focus:outline-none focus:border-[var(--color-ring)]" />
            </div>
            {/* Assignee + Priority */}
            <div className="flex gap-4">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">{creatingIn === 'triage' ? 'Specifier' : 'Assignee'}</label>
                <input value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} placeholder="留空自动分配"
                  className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
              </div>
              <div className="w-24 flex flex-col gap-1.5">
                <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">优先级</label>
                <input type="number" value={newPriority} onChange={(e) => setNewPriority(e.target.value)} placeholder="0"
                  className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
              </div>
            </div>
            {/* Skills */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">Skills</label>
              <input value={newSkills} onChange={(e) => setNewSkills(e.target.value)} placeholder="逗号分隔，如 rust, python, devops"
                className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-ring)]" />
            </div>
            {/* Goal Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-[0.85rem] text-[var(--color-foreground)] cursor-pointer">
                <input type="checkbox" checked={newGoalMode} onChange={(e) => setNewGoalMode(e.target.checked)} className="rounded border-[var(--color-border)] w-4 h-4" />
                Goal Mode（循环执行直到判定完成）
              </label>
              {newGoalMode && (
                <div className="flex items-center gap-2 ml-6">
                  <span className="text-[0.75rem] text-[var(--color-muted-foreground)]">最大轮次</span>
                  <input type="number" value={newGoalMaxTurns} onChange={(e) => setNewGoalMaxTurns(e.target.value)}
                    className="w-20 text-[0.85rem] h-8 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)] text-center" />
                </div>
              )}
            </div>
            {/* Parent */}
            {allTasks.filter(t => t.id && t.status !== 'running').length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.8rem] font-medium text-[var(--color-foreground)]">父任务</label>
                <select value={newParent} onChange={(e) => setNewParent(e.target.value)}
                  className="w-full text-[0.85rem] h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)]">
                  <option value="">无</option>
                  {allTasks.filter(t => t.id && t.status !== 'running').slice(0, 30).map(t => (
                    <option key={t.id} value={t.id}>{t.title?.slice(0, 40) || t.id}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {/* 底部按钮 */}
          <div className="px-5 py-4 border-t border-[var(--color-border)] flex gap-3">
            <button onClick={handleCreateSubmit} disabled={!newTitle.trim()}
              className="flex-1 h-10 rounded-md bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-[0.85rem] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
              创建任务
            </button>
            <button onClick={() => { setCreatingIn(null); resetCreateForm(); }}
              className="h-10 px-4 rounded-md border border-[var(--color-border)] text-[0.85rem] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
              取消
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Phase 3: 批量重分配弹窗 */}
      {showBulkReassign && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/50" onClick={() => setShowBulkReassign(false)} style={{ animation: 'fadeIn 150ms ease-out' }}>
          <div className="flex flex-col gap-4 p-5 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-[var(--kanban-overlay)] shadow-2xl backdrop-blur-sm min-w-[280px]" onClick={e => e.stopPropagation()} style={{ animation: 'scaleIn 150ms ease-out' }}>
            <span className="text-[0.9rem] font-semibold text-[var(--ui-text-primary)]">批量重分配</span>
            <p className="text-[0.8rem] text-[var(--ui-text-tertiary)]">将 {checkedIds.size} 个任务分配到指定 Profile</p>
            <input value={bulkReassignProfile} onChange={e => setBulkReassignProfile(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') handleBulkReassign(); if (e.key === 'Escape') setShowBulkReassign(false); }}
              placeholder="Profile 名称"
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

      {/* Phase A1: 新建看板模态 */}
      {showCreateBoard && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/30 backdrop-blur-[2px]" onClick={() => setShowCreateBoard(false)}>
          <div className="w-[360px] rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-bg-card)] shadow-xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'scaleIn 0.15s ease-out' }}>
            <div className="flex items-center justify-between">
              <span className="text-[0.95rem] font-semibold text-[var(--ui-text-primary)]">新建看板</span>
              <button onClick={() => setShowCreateBoard(false)} className="p-1 rounded-md hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] text-[var(--ui-text-tertiary)]"><X size={15} strokeWidth={1.5} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">名称 *</label>
                <input value={newBoardName} onChange={e => setNewBoardName(e.target.value)} placeholder="例如：设计冲刺" autoFocus
                  className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
                <p className="mt-1 text-[0.7rem] text-[var(--ui-text-tertiary)]">slug 将自动生成</p>
              </div>
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">描述</label>
                <input value={newBoardDesc} onChange={e => setNewBoardDesc(e.target.value)} placeholder="可选"
                  className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
              </div>
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">颜色</label>
                <div className="flex items-center gap-2">
                  <input value={newBoardColor} onChange={e => setNewBoardColor(e.target.value)} placeholder="#6490C8"
                    className="flex-1 text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-hover-bg)]" />
                  {newBoardColor && <span className="w-5 h-5 rounded-full border border-[var(--ui-stroke-tertiary)]" style={{ backgroundColor: newBoardColor }} />}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowCreateBoard(false)} disabled={creatingBoard}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-tertiary)] hover:bg-[color-mix(in_srgb,var(--ui-text-primary)_8%,transparent)] transition-colors">取消</button>
              <button onClick={handleCreateBoard} disabled={creatingBoard || !newBoardName.trim()}
                className={cn('text-[0.8rem] px-4 py-1.5 rounded-md border transition-colors flex items-center gap-1.5',
                  newBoardName.trim() && !creatingBoard
                    ? 'border-[var(--kanban-hover-bg)] bg-[var(--kanban-hover-bg)] text-[var(--kanban-hover-bg)] hover:bg-[var(--kanban-hover-bg)]'
                    : 'border-[var(--ui-stroke-tertiary)] text-[var(--ui-text-quaternary)] cursor-not-allowed'
                )}>
                {creatingBoard && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
                创建并切换
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Phase B3: 手动调度模态 */}
      {showDispatch && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/30 backdrop-blur-[2px]" onClick={() => setShowDispatch(false)}>
          <div className="w-[380px] rounded-xl border border-[var(--kanban-col-border)] bg-[var(--kanban-card-bg)] shadow-xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'scaleIn 0.15s ease-out' }}>
            <div className="flex items-center justify-between">
              <span className="text-[0.95rem] font-semibold text-[var(--ui-text-primary)]">手动调度</span>
              <button onClick={() => setShowDispatch(false)} className="p-1 rounded-md hover:bg-[var(--color-accent)] text-[var(--ui-text-tertiary)]"><X size={15} strokeWidth={1.5} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">最大并发数</label>
                <input value={dispatchMaxSpawn} onChange={e => setDispatchMaxSpawn(e.target.value.replace(/\D/g, ''))} placeholder="默认不限" type="number" min="1"
                  className="w-full text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--kanban-col-border)] bg-transparent text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-quaternary)] focus:outline-none focus:border-[var(--kanban-card-selected-bar)]" />
              </div>
              <label className="flex items-center gap-2 text-[0.8rem] text-[var(--ui-text-primary)]">
                <input type="checkbox" checked={dispatchDryRun} onChange={e => setDispatchDryRun(e.target.checked)}
                  className="rounded border-[var(--kanban-col-border)] accent-[var(--kanban-card-selected-bar)]" />
                预览模式（dry_run，不实际执行）
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowDispatch(false)}
                className="text-[0.8rem] px-3 py-1.5 rounded-md border border-[var(--kanban-col-border)] text-[var(--ui-text-tertiary)] hover:bg-[var(--color-accent)] transition-colors">关闭</button>
              <button onClick={handleDispatch} disabled={dispatching}
                className="text-[0.8rem] px-4 py-1.5 rounded-md bg-[var(--kanban-card-selected-bar)] text-[var(--color-primary-foreground)] hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                {dispatching && <Loader size={12} strokeWidth={1.5} className="animate-spin" />}
                {dispatchDryRun ? '预览调度' : '执行调度'}
              </button>
            </div>
            {dispatchResult && (
              <div className={cn('rounded-md border p-3 space-y-1.5 text-[0.75rem]',
                dispatchResult.error
                  ? 'border-danger/20 bg-danger/5'
                  : 'border-[var(--kanban-col-border)] bg-[color-mix(in_srgb,var(--ui-base)_4%,transparent)]'
              )}>
                {dispatchResult.error ? (
                  <span className="text-danger">{dispatchResult.error}</span>
                ) : (
                  <>
                    <div className="font-medium text-[var(--ui-text-primary)]">{dispatchResult.message || '调度完成'}</div>
                    {dispatchResult.result && (
                      <div className="space-y-0.5 text-[var(--ui-text-tertiary)]">
                        {dispatchResult.result.claimed?.length > 0 && <div>已认领: {dispatchResult.result.claimed.join(', ')}</div>}
                        <div>回收: {dispatchResult.result.reclaimed ?? 0} · 陈旧: {dispatchResult.result.stale?.length ?? 0} · 超时: {dispatchResult.result.timed_out?.length ?? 0} · 提升: {dispatchResult.result.promoted ?? 0}</div>
                        {dispatchResult.result.dry_run && <div className="text-warning italic">* 预览模式，未实际执行</div>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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
                <label className="block text-[0.75rem] font-medium text-[var(--ui-text-tertiary)] mb-1">目标 Profile *</label>
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
