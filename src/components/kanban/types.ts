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
  /** 评论数（后端 board 接口批量注入 comment_count，对齐 Hermes 卡片 footer meta） */
  comment_count?: number;
  /** 依赖链接数（后端 board 接口批量注入 link_counts，对齐 Hermes references meta） */
  link_counts?: { parents: number; children: number };
  /** 诊断提示数组（后端 board 接口注入的 blocked 原因等，对齐 Hermes warnings rollup） */
  diagnostics?: string[];
  /** 任务级模型覆盖（后端 Task.model_override，'' = 继承 profile） */
  model_override?: string;
  /** 任务级 provider 覆盖（后端 Task.provider_override，与 model_override 成对） */
  provider_override?: string;
  /** 任务级推理深度覆盖（后端 Task.reasoning_effort） */
  reasoning_effort?: string;
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
  id?: number;
  task_id: string;
  kind: string;
  /** SSE 路径为解析后的对象；轮询路径为 JSON 字符串（消费方统一 parsePayload） */
  payload?: { summary?: string; reason?: string; status?: string } | string | Record<string, unknown> | null;
  created_at?: number;
}
