/**
 * Kanban 类型定义 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 * 单一权威源：本文件导出全部 Kanban 数据模型
 */
// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface RunRecord {
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

export interface CommentRecord {
  author?: string;
  created_at?: string | number | null;
  body?: string;
}

export interface AttachmentRecord {
  id?: string;
  filename?: string;
  name?: string;
  size?: number;
}

export interface WorkerRecord {
  profile?: string;
  assignee?: string;
  task_id?: string;
  run_id?: string;
}

export interface DispatchResult {
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

export interface BoardListRecord {
  slug?: string;
  name?: string;
  description?: string;
  color?: string;
}

export interface KanbanTask {
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
  /** 租户（后端 Task.tenant）— 顶栏租户筛选的匹配字段（对齐 Hermes task.tenant） */
  tenant: string;
  runs: RunRecord[];
  comments: CommentRecord[];
  child_done: number | null;
  child_total: number | null;
}

export interface ColumnDef {
  key: string;
  label: string;
  dotColor: string;
  emptyText: string;
  canCreate: boolean;
}

export interface StaleThresholds {
  [key: string]: [number, number];
}

/** SSE / 轮询事件（task_id + kind + 可选 payload） */
export interface KanbanEvent {
  task_id: string;
  kind: string;
  payload?: { summary?: string; reason?: string };
}
