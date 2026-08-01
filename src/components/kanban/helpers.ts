/**
 * Kanban 工具函数 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 */
import type { KanbanTask, StaleThresholds, RunRecord, CommentRecord, KanbanEvent } from './types';
import { staleConfig } from './constants';

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

export function taskColumn(task: KanbanTask): string {
  const s = (task.status || '').toLowerCase();
  if (s === 'triage') return 'triage';
  if (s === 'scheduled') return 'scheduled';
  if (s === 'ready') return 'ready';
  if (s === 'running') return 'running';
  if (s === 'blocked') return 'blocked';
  if (s === 'review') return 'review';
  if (['completed', 'done', 'success', 'finished', 'ok'].includes(s)) return 'done';
  return 'todo';
}

export function isBlocked(task: KanbanTask): boolean { return (task.status || '').toLowerCase() === 'blocked'; }
export function isDone(task: KanbanTask): boolean { return ['completed','done','success','finished','ok'].includes((task.status||'').toLowerCase()); }

export function fmtAge(ts: string | number | null | undefined): string {
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

export function fmtDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分`;
  return `${Math.floor(min / 60)}时${min % 60}分`;
}

export function priorityStyle(p: string | number | null | undefined): Record<string, string> | null {
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
export function getStaleness(task: KanbanTask): string | null {
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

export function normalizeTask(raw: Record<string, unknown>): KanbanTask {
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

export function normalizeBoardData(boardResult: Record<string, unknown> | null | undefined): KanbanTask[] {
  if (!boardResult) return [];
  const columns = (boardResult.columns || []) as Record<string, unknown>[];
  const tasks: KanbanTask[] = [];
  for (const col of columns) {
    const items = (col.tasks || col.items || []) as Record<string, unknown>[];
    for (const t of items) tasks.push(normalizeTask(t));
  }
  return tasks;
}

export function mergeTasks(apiTasks: KanbanTask[], sseTasks: Record<string, unknown>): KanbanTask[] {
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

/**
 * 应用单个 kanban 事件到任务列表（SSE 与轮询共用，收敛重复逻辑）。
 * 返回新数组；归档/不匹配事件的任务条目被过滤。
 */
export function applyKanbanEvent(tasks: KanbanTask[], evt: KanbanEvent): KanbanTask[] {
  return tasks.map(t => {
    if (t.id !== evt.task_id) return t;
    const task: KanbanTask = { ...t };
    switch (evt.kind) {
      case 'completed': task.status = 'done'; if (evt.payload?.summary) task.summary = evt.payload.summary; return task;
      case 'blocked': task.status = 'blocked'; task.blocked = true; if (evt.payload?.reason) task.block_reason = evt.payload.reason; return task;
      case 'claimed': task.status = 'running'; return task;
      case 'unblocked': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
      case 'promoted': case 'promoted_manual': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
      case 'recomputed_ready': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
      case 'scheduled': task.status = 'scheduled'; task.blocked = false; task.block_reason = ''; return task;
      case 'archived': return null;
      case 'spawn_failed': case 'gave_up': case 'crashed': case 'timed_out': task.status = 'ready'; return task;
      default: return null;
    }
  }).filter((t): t is KanbanTask => t !== null);
}
