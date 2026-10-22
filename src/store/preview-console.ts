/**
 * Preview console store — 移植 Hermes preview-console-state.ts + preview-console-store.ts
 *
 * 🔴 2026-10-23 S1.2 per-tab 存活（对齐 Hermes preview-console-store.ts：
 * console 状态跨 pane 卸载存活——tab 切走再切回，日志随之回来）：console 状态
 * 从 pane useState 改为模块级 Map<tabId, state>，pane 隐藏/重挂载不销毁；
 * tab 关闭时由 store/preview.ts 调 releasePreviewConsoleState 释放。
 *
 * 🔴 2026-10-23 S1.3 截断治理（对齐 Hermes preview-console-state.ts 三级上限）：
 * 单条 message 64KB / 单条 source 4KB（UTF-8 字节，代理对安全）；总量 512KB
 * 超限从最旧逐出（条数上限 200 条先截）；被逐出条目的 selected id 同步修剪
 * （防头部「已选 N 条」虚高）。
 *
 * 存储模式对齐 ELEVE store/preview.ts：useSyncExternalStore + 事件订阅，零新机制。
 */

import { useSyncExternalStore } from 'react'

export interface ConsoleEntry {
  id: number
  level: number
  line?: number
  message: string
  source?: string
}

export interface ConsoleEntryInput {
  level: number
  line?: number
  message: string
  source?: string
}

export const DEFAULT_CONSOLE_HEIGHT = 240

// ── 截断常量（对齐 Hermes preview-console-state.ts）──
const MAX_MESSAGE_BYTES = 64 * 1024
const MAX_SOURCE_BYTES = 4 * 1024
const MAX_TOTAL_BYTES = 512 * 1024
/** 条数上限（对齐 Hermes slice(-200)） */
const MAX_ENTRIES = 200

function utf8Bytes(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    // 代理对高位按 2 计（占位），低位走 else 分支补足 2 → 代理对合计 4
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 0xd800 <= code && code <= 0xdbff ? 2 : 3
  }
  return bytes
}

/** 按码位截断到 UTF-8 字节上限（for...of 迭代 code point，代理对不切半） */
function capByUtf8Bytes(value: string, capBytes: number): string {
  if (utf8Bytes(value) <= capBytes) return value
  let out = ''
  let bytes = 0
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (bytes + size > capBytes) break
    out += ch
    bytes += size
  }
  return out
}

/** 是否贴近日志底部（自动滚底 stick 判断，对齐 Hermes isNearConsoleBottom） */
export function isNearConsoleBottom(element: HTMLDivElement | null): boolean {
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 24
}

export function createPreviewConsoleState() {
  let height = DEFAULT_CONSOLE_HEIGHT
  let logs: ConsoleEntry[] = []
  let open = false
  let selectedLogIds = new Set<number>()
  let nextLogId = 0
  let totalBytes = 0

  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }

  const recomputeBytes = () => {
    totalBytes = 0
    for (const entry of logs) {
      totalBytes += utf8Bytes(entry.message) + utf8Bytes(entry.source ?? '')
    }
  }

  /** 被逐出条目的 selected id 修剪（对齐 Hermes：append 逐出后剔除不在 logs 的选中 id） */
  const pruneSelection = () => {
    if (selectedLogIds.size === 0) return
    const live = new Set(logs.map((e) => e.id))
    let dropped = false
    const next = new Set<number>()
    for (const id of selectedLogIds) {
      if (live.has(id)) {
        next.add(id)
      } else {
        dropped = true
      }
    }
    if (dropped) selectedLogIds = next
  }

  /** 条数 + 总量双上限逐出：最旧先走（对齐 Hermes evict-from-oldest） */
  const evictOverLimit = () => {
    let start = 0
    while (logs.length - start > MAX_ENTRIES || (totalBytes > MAX_TOTAL_BYTES && logs.length - start > 1)) {
      const gone = logs[start]
      totalBytes -= utf8Bytes(gone.message) + utf8Bytes(gone.source ?? '')
      start += 1
    }
    if (start > 0) {
      logs = logs.slice(start)
      pruneSelection()
    }
  }

  return {
    getHeight: () => height,
    setHeight(next: number | ((cur: number) => number)): void {
      height = typeof next === 'function' ? next(height) : next
      emit()
    },
    getOpen: () => open,
    setOpen(next: boolean | ((cur: boolean) => boolean)): void {
      const value = typeof next === 'function' ? next(open) : next
      if (value === open) return
      open = value
      emit()
    },
    getLogs: () => logs,
    getLogCount: () => logs.length,
    getSelectedLogIds: () => selectedLogIds,
    subscribe,
    append(entry: ConsoleEntryInput): void {
      // 三级截断（对齐 Hermes）：message 64KB / source 4KB，代理对安全
      const message = capByUtf8Bytes(entry.message ?? '', MAX_MESSAGE_BYTES)
      const source = entry.source ? capByUtf8Bytes(entry.source, MAX_SOURCE_BYTES) : entry.source
      const appended: ConsoleEntry = { ...entry, message, source: source as string | undefined, id: ++nextLogId }
      logs = [...logs, appended]
      totalBytes += utf8Bytes(message) + utf8Bytes(source ?? '')
      evictOverLimit()
      emit()
    },
    replace(entries: ConsoleEntryInput[]): void {
      // snapshot 补拉：全量替换（id 重新编号，选中态清空——对齐 Hermes reset 语义）
      let id = 0
      logs = entries.map((e) => {
        const message = capByUtf8Bytes(e.message ?? '', MAX_MESSAGE_BYTES)
        const source = e.source ? capByUtf8Bytes(e.source, MAX_SOURCE_BYTES) : e.source
        return { ...e, message, source: source as string | undefined, id: ++id }
      })
      nextLogId = id
      selectedLogIds = new Set()
      recomputeBytes()
      emit()
    },
    clear(): void {
      logs = []
      selectedLogIds = new Set()
      totalBytes = 0
      emit()
    },
    clearSelection(): void {
      if (selectedLogIds.size === 0) return
      selectedLogIds = new Set()
      emit()
    },
    reset(): void {
      nextLogId = 0
      logs = []
      selectedLogIds = new Set()
      totalBytes = 0
      emit()
    },
    toggleSelection(id: number): void {
      const next = new Set(selectedLogIds)
      if (!next.delete(id)) {
        next.add(id)
      }
      selectedLogIds = next
      emit()
    },
  }
}

export type PreviewConsoleState = ReturnType<typeof createPreviewConsoleState>

// ── S1.2 per-tab 存活注册表（对齐 Hermes preview-console-store.ts）──

const tabConsoles = new Map<string, PreviewConsoleState>()

/** 取 tab 的 console 状态（首次访问惰性创建）。pane 挂载/重挂载都经它取——
 *  tab 切走再切回，日志还在 */
export function getPreviewConsoleState(tabId: string): PreviewConsoleState {
  let store = tabConsoles.get(tabId)
  if (!store) {
    store = createPreviewConsoleState()
    tabConsoles.set(tabId, store)
  }
  return store
}

/** tab 关闭时释放（store/preview.ts 的 closeTab 系列调用；防止 Map 无界增长） */
export function releasePreviewConsoleState(tabId: string): void {
  tabConsoles.delete(tabId)
}

// ── React 绑定（useSyncExternalStore，对齐 ELEVE 存储模式）──

export function useConsoleStore(store: PreviewConsoleState) {
  const height = useSyncExternalStore(store.subscribe, store.getHeight, store.getHeight)
  const open = useSyncExternalStore(store.subscribe, store.getOpen, store.getOpen)
  const logs = useSyncExternalStore(store.subscribe, store.getLogs, store.getLogs)
  const selectedLogIds = useSyncExternalStore(
    store.subscribe,
    store.getSelectedLogIds,
    store.getSelectedLogIds,
  )
  return { height, open, logs, selectedLogIds }
}
