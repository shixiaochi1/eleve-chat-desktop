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
  // 🔴 修复：archived 此前落入 default → 'todo'，归档卡片会跳进「待办」列
  if (s === 'archived') return 'archived';
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
  // 🔴 修复：后端 updated_at/created_at 是 epoch 秒（f64 数字）。此前 String()
  //   强转成字符串后 fmtAge/getStaleness 的 `ts < 1e12 ? ts*1000 : ts` 秒→毫秒
  //   判断失效（new Date("1723…") 非法），卡片时间与陈旧度永不显示。
  //   保留原始类型，由消费方（fmtAge/getStaleness）按秒/毫秒启发式换算。
  const updatedAt = (raw.updated_at ?? raw.created_at ?? null) as string | number | null;
  // 🔴 修复：progress 解析 — 后端 board 接口把 batch_progress 格式化成
  //   "3/5 children completed" 字符串（对齐 Hermes progress rollup），
  //   并非 child_done/child_total 数字，此前进度药丸恒不显示。
  let childDone = n(raw.child_done) ?? n(raw.children_done);
  let childTotal = n(raw.child_total) ?? n(raw.children_total);
  if (childDone == null && typeof raw.progress === 'string') {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(raw.progress);
    if (m) {
      childDone = Number(m[1]);
      childTotal = Number(m[2]);
    }
  }
  return {
    id: s(raw.id),
    title: isKanban ? s(raw.title) : s(raw.goal),
    assignee: isKanban ? s(raw.assignee) : s(raw.model),
    status: s(raw.status, 'ready'),
    startTs: isKanban ? (typeof raw.created_at === 'number' ? raw.created_at * 1000 : null) : n(raw.startTs),
    duration: n(raw.duration),
    // 🔴 修复：后端 board 接口在任务顶层注入 latest_summary（运行摘要，200 字符截断，
    //   对齐 Hermes `latest_summary || body`），此前只看 raw.summary（任务自身字段）恒为空。
    summary: s(raw.summary) || s(raw.latest_summary),
    blocked: b(raw.blocked),
    block_reason: s(raw.block_reason),
    body: s(raw.body),
    priority: String(raw.priority ?? ''),
    updated_at: updatedAt,
    parents: arr(raw.parents) as string[],
    children: arr(raw.children) as string[],
    tags: arr(raw.tags) as string[],
    tenant: s(raw.tenant),
    // 🔴 对齐 Hermes 卡片 footer meta：后端 board 接口已批量注入
    //   comment_count / link_counts / diagnostics（blocked 原因数组）
    comment_count: n(raw.comment_count) ?? 0,
    link_counts: (() => {
      const lc = raw.link_counts as { parents?: unknown; children?: unknown } | undefined;
      if (!lc) return undefined;
      return {
        parents: typeof lc.parents === 'number' ? lc.parents : 0,
        children: typeof lc.children === 'number' ? lc.children : 0,
      };
    })(),
    diagnostics: Array.isArray(raw.diagnostics) ? (raw.diagnostics as string[]) : undefined,
    model_override: s(raw.model_override),
    runs: arr(raw.runs) as RunRecord[],
    comments: arr(raw.comments) as CommentRecord[],
    child_done: childDone,
    child_total: childTotal,
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

/** 事件 payload 规范化：SSE 给对象、轮询给 JSON 字符串，统一成对象（对齐 Hermes eventText） */
export function parsePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string' && payload) {
    try { return JSON.parse(payload) as Record<string, unknown>; } catch { return {}; }
  }
  if (payload && typeof payload === 'object') return payload as Record<string, unknown>;
  return {};
}

/**
 * 应用单个 kanban 事件到任务列表（SSE 与轮询共用，收敛重复逻辑）。
 * 返回新数组；仅「archived」事件移除条目（对齐后端语义），
 * 其余未识别的 kind 保持任务原样返回（🔴 修复：原先 default 分支返回 null
 * 会把任务删掉——'status'/'edited'/'assigned' 等非 patch 事件不在
 * KANBAN_PATCH_KINDS 里且不触发重载时，卡片会凭空消失直到 60s 轮询兜底）。
 */
export function applyKanbanEvent(tasks: KanbanTask[], evt: KanbanEvent): KanbanTask[] {
  const p = parsePayload(evt.payload);
  return tasks.map(t => {
    if (t.id !== evt.task_id) return t;
    const task: KanbanTask = { ...t };
    switch (evt.kind) {
      case 'completed': task.status = 'done'; if (typeof p.summary === 'string' && p.summary) task.summary = p.summary; return task;
      case 'blocked': task.status = 'blocked'; task.blocked = true; if (typeof p.reason === 'string' && p.reason) task.block_reason = p.reason; return task;
      case 'claimed': task.status = 'running'; return task;
      case 'unblocked': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
      case 'promoted': case 'promoted_manual': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
      case 'recomputed_ready': task.status = 'ready'; task.blocked = false; task.block_reason = ''; return task;
      case 'scheduled': task.status = 'scheduled'; task.blocked = false; task.block_reason = ''; return task;
      case 'status': {
        // set_status_direct 写的事件：payload.status 即新状态（对齐 Hermes status event）
        const st = p.status;
        if (st && typeof st === 'string') {
          task.status = st;
          if (st === 'ready' || st === 'todo' || st === 'scheduled') { task.blocked = false; task.block_reason = ''; }
        }
        return task;
      }
      case 'archived': return null;
      case 'spawn_failed': case 'gave_up': case 'crashed': case 'timed_out': task.status = 'ready'; return task;
      default: return task;
    }
  }).filter((t): t is KanbanTask => t !== null);
}
