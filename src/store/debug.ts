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
 */

import { useSyncExternalStore } from 'react'

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
  lastSent?: string
  sessionStartedAt?: number | null
  statusText?: string
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
let debugEvents: DebugEvent[] = []
let debugToolCalls: DebugToolCall[] = []
let monitor: MonitorState = { modelName: null, delegateTasks: {} }

// tokens 派生快照缓存（useSyncExternalStore 需要稳定引用，值不变则引用不变）
let tokensSnapshot: { tokensIn?: number; tokensOut?: number } = {}
function getTokensSnapshot(): { tokensIn?: number; tokensOut?: number } {
  if (tokensSnapshot.tokensIn !== monitor.tokensIn || tokensSnapshot.tokensOut !== monitor.tokensOut) {
    tokensSnapshot = { tokensIn: monitor.tokensIn, tokensOut: monitor.tokensOut }
  }
  return tokensSnapshot
}

let listeners = new Set<() => void>()
function emit(): void {
  listeners.forEach((cb) => cb())
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

// ── Writes（签名兼容 React Dispatch<SetStateAction>，useMessageStream 零改动调用形式）──

/** 追加调试事件（保留最近 200 条，裁剪到 150） */
export function addDebugEvent(type: string, detail: string): void {
  debugEvents = [...debugEvents, { ts: Date.now(), type, detail }]
  if (debugEvents.length > 200) debugEvents = debugEvents.slice(-150)
  emit()
}

/** 设置工具调用列表（函数式/直接值均可） */
export function setDebugToolCalls(updater: React.SetStateAction<DebugToolCall[]>): void {
  debugToolCalls =
    typeof updater === 'function'
      ? (updater as (prev: DebugToolCall[]) => DebugToolCall[])(debugToolCalls)
      : updater
  emit()
}

/** 更新 monitor 状态（函数式/直接值均可） */
export function setMonitor(updater: React.SetStateAction<MonitorState>): void {
  monitor =
    typeof updater === 'function'
      ? (updater as (prev: MonitorState) => MonitorState)(monitor)
      : updater
  emit()
}

// ── Subscriptions（useSyncExternalStore，primitive/缓存引用稳定）──

export function useDebugEvents(): DebugEvent[] {
  return useSyncExternalStore(subscribe, () => debugEvents, () => debugEvents)
}

export function useDebugToolCalls(): DebugToolCall[] {
  return useSyncExternalStore(subscribe, () => debugToolCalls, () => debugToolCalls)
}

export function useMonitorModelName(): string | null {
  return useSyncExternalStore(subscribe, () => monitor.modelName, () => monitor.modelName)
}

export function useMonitorTokens(): { tokensIn?: number; tokensOut?: number } {
  return useSyncExternalStore(subscribe, getTokensSnapshot, getTokensSnapshot)
}

export function useMonitorSessionStartedAt(): number | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => monitor.sessionStartedAt,
    () => monitor.sessionStartedAt
  )
}

/** 🔴 2026-08-15 编排对齐（③ 前端子 Agent 监控）：delegateTasks 只写不读
 * 的死状态修复——导出订阅 hook 供 SubagentMonitor 消费。 */
export function useMonitorDelegateTasks(): Record<string, unknown> {
  return useSyncExternalStore(
    subscribe,
    () => monitor.delegateTasks,
    () => monitor.delegateTasks
  )
}
