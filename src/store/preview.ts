/**
 * Preview store — 对齐 Hermes store/preview.ts（2026-08-05）
 *
 * 多 Tab 预览中心状态：
 * - tabs：url（Web/dev server）/ file（本地文件）两种 target
 * - activeId / reloadRequest（文件变更自动刷新计数）/ restart 状态机
 * - paneOpenRequest：外部事件（open_preview 工具 / #preview 链接 / 文件树双击）
 *   请求打开预览面板（对齐 Hermes $revealInTreeRequest：事件源 → App 消费）
 *
 * 存储模式与 store/artifacts.ts 一致：useSyncExternalStore + 事件订阅，零新机制。
 */

import { useSyncExternalStore } from 'react'
import type { ListenerCallback, Unsubscribe } from '@/types'

export type PreviewTargetKind = 'url' | 'file'

export interface PreviewTarget {
  kind: PreviewTargetKind
  /** url target = 加载地址；file target = 文件绝对路径 */
  url: string
  label?: string
  /** file target 文件名（tab 标签兜底） */
  name?: string
}

export interface PreviewTab {
  id: string
  target: PreviewTarget
  label: string
}

export type PreviewRestartStatus = 'idle' | 'running' | 'success' | 'error'

export interface PreviewRestartEntry {
  text: string
  level: string
  timestamp: number
}

export interface PreviewRestartState {
  status: PreviewRestartStatus
  taskId: string
  url: string
  entries: PreviewRestartEntry[]
}

interface PreviewState {
  tabs: PreviewTab[]
  activeId: string | null
  /** 递增计数：文件变更自动刷新 / 手动 reload（对齐 Hermes $previewReloadRequest） */
  reloadRequest: number
  restart: PreviewRestartState | null
}

let state: PreviewState = {
  tabs: [],
  activeId: null,
  reloadRequest: 0,
  restart: null,
}

let listeners = new Set<ListenerCallback>()

function notify(): void {
  listeners.forEach((cb) => cb())
}

function subscribe(cb: ListenerCallback): Unsubscribe {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): PreviewState {
  return state
}

export function usePreviewStore(): PreviewState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function update(patch: Partial<PreviewState>): void {
  state = { ...state, ...patch }
  notify()
}

/** tab 标签：取 URL/路径末段（对齐 Hermes tabLabelFor） */
function labelFor(target: PreviewTarget): string {
  const value = target.label || target.name || target.url
  const tail = value.split(/[\\/]/).filter(Boolean).at(-1)
  return tail || value || '预览'
}

// ── Actions ──

/** 打开预览 tab（去重：同 kind+url 已有 → 选中）；自动请求打开预览面板（对齐 Hermes openPreview 语义） */
export function openPreview(target: PreviewTarget): string {
  const existing = state.tabs.find((t) => t.target.kind === target.kind && t.target.url === target.url)
  if (existing) {
    selectTab(existing.id)
    requestPaneOpen()
    return existing.id
  }

  const id = `${target.kind}:${target.url}`
  const tab: PreviewTab = { id, target, label: labelFor(target) }
  update({ tabs: [...state.tabs, tab], activeId: id })
  requestPaneOpen()
  return id
}

export function selectTab(id: string): void {
  if (state.activeId !== id) update({ activeId: id })
}

/** 关闭 tab；关闭的是激活 tab → 激活相邻（优先右侧，其次左侧，对齐 Hermes） */
export function closeTab(id: string): void {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  const tabs = state.tabs.filter((t) => t.id !== id)
  let activeId = state.activeId
  if (state.activeId === id) {
    activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
  }
  update({ tabs, activeId })
}

export function closeOtherTabs(id: string): void {
  const keep = state.tabs.find((t) => t.id === id)
  if (!keep) return
  update({ tabs: [keep], activeId: keep.id })
}

export function closeTabsToRight(id: string): void {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  const tabs = state.tabs.slice(0, idx + 1)
  update({
    tabs,
    activeId: state.activeId && tabs.some((t) => t.id === state.activeId) ? state.activeId : id,
  })
}

export function closeAllTabs(): void {
  update({ tabs: [], activeId: null })
}

/** 请求 iframe 重载（文件变更自动刷新 / 手动刷新）— 对齐 Hermes requestPreviewReload */
export function requestPreviewReload(): void {
  update({ reloadRequest: state.reloadRequest + 1 })
}

// ── 重启状态机（对齐 Hermes $previewServerRestart：begin/complete/progress/fail）──

export function beginPreviewRestart(taskId: string, url: string): void {
  update({ restart: { status: 'running', taskId, url, entries: [] } })
}

export function progressPreviewRestart(taskId: string, text: string): void {
  const r = state.restart
  if (!r || r.taskId !== taskId) return
  update({
    restart: { ...r, entries: [...r.entries, { text, level: 'info', timestamp: Date.now() }] },
  })
}

/** 完成：非 error 前缀/非 failed 文本 → success；否则 error。成功后由 UI 消费触发 iframe 重载 */
export function completePreviewRestart(taskId: string, text: string): void {
  const r = state.restart
  if (!r || r.taskId !== taskId) return
  const isError = text.startsWith('error:') || text.toLowerCase().includes('failed')
  update({
    restart: {
      ...r,
      status: isError ? 'error' : 'success',
      entries: [...r.entries, { text, level: isError ? 'error' : 'info', timestamp: Date.now() }],
    },
  })
}

export function failPreviewRestart(taskId: string, text: string): void {
  const r = state.restart
  if (!r || r.taskId !== taskId) return
  update({
    restart: {
      ...r,
      status: 'error',
      entries: [...r.entries, { text, level: 'error', timestamp: Date.now() }],
    },
  })
}

/** RPC 调用失败（无 task_id）：直接置 error 状态 */
export function failPreviewRestartRequest(url: string, text: string): void {
  update({
    restart: {
      status: 'error',
      taskId: '',
      url,
      entries: [{ text, level: 'error', timestamp: Date.now() }],
    },
  })
}

export function clearPreviewRestart(): void {
  update({ restart: null })
}

// ── 面板打开请求（对齐 Hermes $revealInTreeRequest：外部事件源 → App 消费）──

let paneOpenRequest = 0
let paneOpenListeners = new Set<ListenerCallback>()

function notifyPaneOpen(): void {
  paneOpenListeners.forEach((cb) => cb())
}

function subscribePaneOpen(cb: ListenerCallback): Unsubscribe {
  paneOpenListeners.add(cb)
  return () => {
    paneOpenListeners.delete(cb)
  }
}

function getPaneOpenSnapshot(): number {
  return paneOpenRequest
}

/** 外部事件请求打开预览面板（切到预览 tab + 展开右栏） */
export function requestPaneOpen(): void {
  paneOpenRequest += 1
  notifyPaneOpen()
}

export function usePaneOpenRequest(): number {
  return useSyncExternalStore(subscribePaneOpen, getPaneOpenSnapshot, getPaneOpenSnapshot)
}
