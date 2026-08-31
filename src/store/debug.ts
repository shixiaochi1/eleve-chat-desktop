/**
 * Debug/monitor atomic store — 调试事件 / 工具调用 / 监控状态独立存储
 *
 * 对齐 store/messages.ts 模式：模块级 state + listeners + useSyncExternalStore。
 * 背景：App 根持有 debugEvents/debugToolCalls/monitorState 三个 useState，
 * 每个网关事件（tool 开始/结束、模型切换、审批等）都触发 App 级 setState → 整树重渲染。
 * 下沉后只重渲染实际消费方（DebugPanel / StatusBar / ModelContext 派生点）。
 *
 * 写入方：useMessageStream 回调（addDebugEvent / setDebugToolCalls / setMonitor）
 * 消费方：DebugPanel（debugEvents/debugToolCalls）、App 派生（modelName/tokens/sessionStartedAt）
 *
 * 🔴 2026-09-01 收敛：手写 listeners/emit/subscribe 样板 → lib/store-factory
 * createAtomStore（三值合并为单一 DebugState——与原实现共享同一 listeners Set 的
 * 通知语义等价：任一 set 触发所有 hook 的 getSnapshot，primitive selector 值未变
 * 则 React bail out，订阅粒度不变）。
 */

import { useSyncExternalStore } from 'react'
import { createAtomStore } from '../lib/store-factory'

export interface DebugEvent {
  ts: number
  type: string
  detail: string
}

export interface DebugToolCall {
  name: string
  status: string
  callId?: string
  args?: string
  result?: string
  error?: boolean
  [k: string]: unknown
}

export interface MonitorState {
  modelName: string | null
  delegateTasks: Record<string, unknown>
  tokensIn?: number
  tokensOut?: number
  sessionStartedAt?: number | null
}

/** 🔴 2026-08-15 编排对齐（③ 前端子 Agent 监控）：delegateTasks 条目结构 */
export interface DelegateTask {
  id: string
  goal?: string
  eventType?: string
  status?: string
  depth?: number
  parentId?: string
  model?: string
  childSessionId?: string
  /** 🔴 2026-08-17 审计 E-F3：父会话 sid（事件携带；监控按会话过滤渲染） */
  sessionId?: string
  toolName?: string
  thinkingText?: string
  progressSummary?: string
  toolCount?: number
  durationSeconds?: number
  summary?: string
  inputTokens?: number
  outputTokens?: number
  apiCalls?: number
  exitReason?: string
  /** 过程轨迹（工具名/进度/文本 delta，按到达序，cap 60） */
  trace?: string[]
  /** 最近一次文本 delta（子 Agent 输出过程） */
  lastText?: string
  [k: string]: unknown
}

// ── Internal state ──

interface DebugState {
  events: DebugEvent[]
  toolCalls: DebugToolCall[]
  monitor: MonitorState
}

const debugStore = createAtomStore<DebugState>({
  events: [],
  toolCalls: [],
  monitor: { modelName: null, delegateTasks: {} },
})

// tokens 派生快照缓存（useSyncExternalStore 需要稳定引用，值不变则引用不变）
let tokensSnapshot: { tokensIn?: number; tokensOut?: number } = {}
function getTokensSnapshot(): { tokensIn?: number; tokensOut?: number } {
  const m = debugStore.get().monitor
  if (tokensSnapshot.tokensIn !== m.tokensIn || tokensSnapshot.tokensOut !== m.tokensOut) {
    tokensSnapshot = { tokensIn: m.tokensIn, tokensOut: m.tokensOut }
  }
  return tokensSnapshot
}

// ── Writes（签名兼容 React Dispatch<SetStateAction>，useMessageStream 零改动调用形式）──

/** 追加调试事件（保留最近 200 条，裁剪到 150） */
export function addDebugEvent(type: string, detail: string): void {
  debugStore.set((s) => {
    let events = [...s.events, { ts: Date.now(), type, detail }]
    if (events.length > 200) events = events.slice(-150)
    return { ...s, events }
  })
}

// 🔴 2026-09-01 内存修复（审查 P0-2）：debugToolCalls 此前无任何裁剪——
// 每个工具调用的完整 args/result 字符串（如 write_file 的文件全文）跨会话、
// 跨 turn 永驻内存，重工具场景线性增长（对比 addDebugEvent 有 200→150 裁剪）。
// DebugPanel 消费仅为 <pre> 展示（无复制完整内容功能），截断无功能损失。
const TOOL_CALLS_MAX = 200
const TOOL_CALLS_PRUNE_TO = 150
/** 单条 args/result 字符上限：4KB 足够调试查看，防 write_file 全文级条目 */
const TOOL_PAYLOAD_MAX_CHARS = 4096

function clampToolCall(t: DebugToolCall): DebugToolCall {
  const args = typeof t.args === 'string' && t.args.length > TOOL_PAYLOAD_MAX_CHARS
    ? t.args.slice(0, TOOL_PAYLOAD_MAX_CHARS) + ` …(截断，原 ${t.args.length} 字符)`
    : t.args
  const result = typeof t.result === 'string' && t.result.length > TOOL_PAYLOAD_MAX_CHARS
    ? t.result.slice(0, TOOL_PAYLOAD_MAX_CHARS) + ` …(截断，原 ${t.result.length} 字符)`
    : t.result
  return args === t.args && result === t.result ? t : { ...t, args, result }
}

/** 设置工具调用列表（函数式/直接值均可）。写入时统一裁剪（数量 + 单条载荷） */
export function setDebugToolCalls(updater: React.SetStateAction<DebugToolCall[]>): void {
  debugStore.set((s) => {
    const next =
      typeof updater === 'function'
        ? (updater as (prev: DebugToolCall[]) => DebugToolCall[])(s.toolCalls)
        : updater
    return {
      ...s,
      toolCalls: (next.length > TOOL_CALLS_MAX ? next.slice(-TOOL_CALLS_PRUNE_TO) : next).map(clampToolCall),
    }
  })
}

/** 更新 monitor 状态（函数式/直接值均可） */
export function setMonitor(updater: React.SetStateAction<MonitorState>): void {
  debugStore.set((s) => ({
    ...s,
    monitor:
      typeof updater === 'function'
        ? (updater as (prev: MonitorState) => MonitorState)(s.monitor)
        : updater,
  }))
}

// ── Subscriptions（useSyncExternalStore，primitive/缓存引用稳定）──

export function useDebugEvents(): DebugEvent[] {
  return debugStore.useSelector((s) => s.events)
}

export function useDebugToolCalls(): DebugToolCall[] {
  return debugStore.useSelector((s) => s.toolCalls)
}

export function useMonitorModelName(): string | null {
  return debugStore.useSelector((s) => s.monitor.modelName)
}

export function useMonitorTokens(): { tokensIn?: number; tokensOut?: number } {
  return useSyncExternalStore(debugStore.subscribe, getTokensSnapshot, getTokensSnapshot)
}

export function useMonitorSessionStartedAt(): number | null | undefined {
  return debugStore.useSelector((s) => s.monitor.sessionStartedAt)
}

/** 🔴 2026-08-15 编排对齐（③ 前端子 Agent 监控）：delegateTasks 只写不读
 * 的死状态修复——导出订阅 hook 供 SubagentMonitor 消费。 */
export function useMonitorDelegateTasks(): Record<string, unknown> {
  return debugStore.useSelector((s) => s.monitor.delegateTasks)
}
