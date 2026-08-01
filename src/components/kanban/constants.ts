/**
 * Kanban 常量配置 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 */
import type { ColumnDef } from './types';

// ═══════════════════════════════════════════════════════════════
// 常量配置
// ═══════════════════════════════════════════════════════════════

export const COLUMNS: ColumnDef[] = [
  { key: 'triage',    label: 'Triage',    dotColor: 'var(--ui-purple)', emptyText: '暂无待甄别任务', canCreate: true },
  { key: 'todo',      label: 'Todo',      dotColor: 'var(--ui-text-tertiary)', emptyText: '暂无待办任务', canCreate: false },
  { key: 'scheduled', label: 'Scheduled', dotColor: 'var(--ui-cyan)', emptyText: '暂无定时等待任务', canCreate: false },
  { key: 'ready',     label: 'Ready',     dotColor: 'var(--ui-yellow)', emptyText: '暂无就绪任务', canCreate: false },
  { key: 'running',   label: 'Running',   dotColor: 'var(--ui-green)', emptyText: '暂无运行中任务', canCreate: false },
  { key: 'blocked',   label: 'Blocked',   dotColor: 'var(--ui-red)', emptyText: '暂无阻塞任务', canCreate: false },
  { key: 'review',    label: 'Review',    dotColor: 'var(--ui-orange)', emptyText: '暂无待审任务', canCreate: false },
  { key: 'done',      label: 'Done',      dotColor: 'var(--ui-blue)', emptyText: '暂无已完成任务', canCreate: false },
];

// 列 key → 合法 status 映射
export const COLUMN_STATUS: Record<string, string> = {
  triage: 'triage', todo: 'todo', scheduled: 'scheduled', ready: 'ready',
  running: 'running', blocked: 'blocked', review: 'review', done: 'done',
};

// ── 陈旧度阈值（秒）— [amber, red]，可被 getKanbanConfig 覆盖 ──
export let staleConfig: Record<string, [number, number]> = {
  ready:     [3600, 86400],    // 1h / 24h
  running:   [600, 3600],      // 10m / 60m
  blocked:   [3600, 86400],    // 1h / 24h
  scheduled: [3600, 86400],    // 1h / 24h（对齐 blocked）
  todo:      [604800, 2592000],// 7d / 30d
};

/**
 * 合并配置覆盖（getKanbanConfig 的 stale_thresholds）。
 * ES import 绑定只读，export let 无法从外部赋值，必须经函数修改。
 */
export function updateStaleConfig(patch: Record<string, [number, number]>): void {
  staleConfig = { ...staleConfig, ...patch };
}

// ── 事件 kind 分类（对齐后端 kanban event 语义）──
/** 直接 patch 任务状态的事件（无需整板刷新） */
export const KANBAN_PATCH_KINDS: string[] = [
  'completed','blocked','claimed','unblocked','archived',
  'spawn_failed','gave_up','crashed','timed_out','promoted',
  'promoted_manual','recomputed_ready','scheduled',
];

/** 需要触发 loadBoard 全量刷新的结构性事件 */
export const KANBAN_REFRESH_KINDS: string[] = [
  'specified','assigned','reclaimed','decomposed','created','linked','unlinked',
];
