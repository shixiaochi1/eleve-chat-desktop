/**
 * Preview console store — 移植 Hermes preview-console-state.ts（per-pane 语义）
 *
 * 每个 PreviewWebPane 实例一个（挂载时 createPreviewConsoleState），
 * tab 切换/关闭随组件生命周期销毁，天然 per-tab 隔离（对齐 Hermes per-pane consoleState）。
 *
 * 存储模式对齐 ELEVE store/preview.ts：useSyncExternalStore + 事件订阅，零新机制。
 * 200 条展示上限（对齐 Hermes slice(-199) + 1）。
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

  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
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
      logs = [...logs.slice(-199), { ...entry, id: ++nextLogId }]
      emit()
    },
    replace(entries: ConsoleEntryInput[]): void {
      // snapshot 补拉：全量替换（id 重新编号，选中态清空——对齐 Hermes reset 语义）
      let id = 0
      logs = entries.map((e) => ({ ...e, id: ++id }))
      nextLogId = id
      selectedLogIds = new Set()
      emit()
    },
    clear(): void {
      logs = []
      selectedLogIds = new Set()
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
