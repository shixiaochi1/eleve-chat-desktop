/**
 * Kanban 常量配置 — 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）
 */
import type { ColumnDef } from './types';

// ═══════════════════════════════════════════════════════════════
// 常量配置
// ═══════════════════════════════════════════════════════════════

// 🔴 修复（对齐 Hermes + 后端 create_task 语义）：
// canCreate 只保留 triage/todo/ready —— 后端 create_task 无 parents 时
// 默认落 'ready'（triage 标志落 'triage'），其余列只能经创建后 patch 落位，
// 而 patch 直接可设的目标仅 triage/todo/ready（transition_status 直通
// set_status_direct）；scheduled/blocked/done/archived 需结构化参数（定时时间/
// 阻塞原因/完成摘要），列内快速创建无法满足 → 不提供添加按钮（对齐 Hermes
// 锁定列不渲染 add 按钮的纪律）。
// 🔴 review 移出 canCreate（对齐 Hermes LOCKED_COLUMNS 含 review：
//   review 由 request_review/调度器独占，不直建）。
export const COLUMNS: ColumnDef[] = [
  { key: 'triage',    label: '分类',    dotColor: 'var(--ui-purple)', emptyText: '暂无待甄别任务', canCreate: true,
    help: '粗略想法先进这里，AI 将细化为可执行规格（指定/提升后进入队列）' },
  { key: 'todo',      label: '待办',    dotColor: 'var(--ui-text-tertiary)', emptyText: '暂无待办任务', canCreate: true,
    help: '依赖未满足的任务在此等待——父任务全部完成后自动提升为就绪' },
  { key: 'scheduled', label: '已排期',  dotColor: 'var(--ui-cyan)', emptyText: '暂无定时等待任务', canCreate: false,
    help: '定时唤醒任务：到 scheduled_at 自动回到队列（需「滞留」操作附唤醒时间）' },
  { key: 'ready',     label: '就绪',    dotColor: 'var(--ui-yellow)', emptyText: '暂无就绪任务', canCreate: true,
    help: '依赖已满足、等待分配负责人——分配 profile 后调度器自动运行' },
  { key: 'running',   label: '进行中',  dotColor: 'var(--ui-green)', emptyText: '暂无运行中任务', canCreate: false,
    help: '调度器独占：worker 正在执行（claim 启动），不能直接拖入' },
  { key: 'blocked',   label: '阻塞',    dotColor: 'var(--ui-red)', emptyText: '暂无阻塞任务', canCreate: false,
    help: '失败超限或人工标记：恢复（unblock）后回到就绪队列' },
  { key: 'review',    label: '评审',    dotColor: 'var(--ui-orange)', emptyText: '暂无待审任务', canCreate: false,
    help: '评审交接：实现完成后由调度器派评审 worker；可通过/恢复/退回返工' },
  { key: 'done',      label: '已完成',  dotColor: 'var(--ui-blue)', emptyText: '暂无已完成任务', canCreate: false,
    help: '任务完成（含摘要/结果/产物），可归档' },
  { key: 'archived',  label: '已归档',  dotColor: 'var(--ui-text-quaternary)', emptyText: '暂无已归档任务', canCreate: false,
    help: '归档任务（顶栏「已归档」开关控制显示）' },
];

// 列 key → 合法 status 映射
export const COLUMN_STATUS: Record<string, string> = {
  triage: 'triage', todo: 'todo', scheduled: 'scheduled', ready: 'ready',
  running: 'running', blocked: 'blocked', review: 'review', done: 'done',
  archived: 'archived',
};

// ── 锁定拖入列（对齐 Hermes LOCKED_COLUMNS=['review','running','scheduled']）──
// running：调度器 claim 独占，transition_status 显式拒绝任何直设
//   （"running (must use dispatcher/claim path)"），列级拒绝拖入。
// scheduled：需要定时唤醒时间（仅 agent/CLI 能附），裸 status 拖入
//   语义残缺（scheduled_at=0 悬挂），同样列级拒绝；需「滞留」操作显式执行。
// review：对齐 Hermes 2026-08 一等评审生命周期——评审交接只走
//   request_review（running/ready→review）/ reopen（review→ready/todo）/
//   完成（review→done），不再允许裸拖入/直建（后端 set_status_direct
//   对 review 已移除直通）。
export const LOCKED_DROP_COLUMNS: string[] = ['review', 'running', 'scheduled'];

// ── 锁定列拒绝提示文案（对齐 Hermes lockedReason / i18n locked.*）──
export const LOCKED_REASON: Record<string, string> = {
  review: '评审列由调度器独占：请用「提交评审」（运行/就绪卡）或「评审通过/退回」（评审卡）操作，不能直接拖入',
  running: '进行中列由调度器独占（worker claim），不能直接拖入',
  scheduled: '排期列需要定时唤醒时间：请用「滞留」操作或由 Agent/CLI 附 scheduled_at',
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
/** 直接 patch 任务状态的事件（本地应用，无需整板刷新；其余 kind 一律触发 loadBoard 自愈） */
// 🔴 2026-08-16（审计领域5 P0-3）：补 rate_limited/protocol_violation——
//   后端 worker 退出分类事件（timed_out/crashed/spawn_failed 已有）；
//   删 recomputed_ready（后端不发，promoted 带落点替代——死代码）
export const KANBAN_PATCH_KINDS: string[] = [
  'completed','blocked','claimed','unblocked','archived',
  'spawn_failed','gave_up','crashed','timed_out','rate_limited',
  'protocol_violation','promoted','promoted_manual','scheduled',
];
