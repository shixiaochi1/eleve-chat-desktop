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

export type PreviewTargetKind = 'url' | 'file' | 'artifact'

/** 🔴 2026-08-28 对齐 Hermes PreviewRecordSource：打开来源只是元数据，不是独立
 *  代码路径——唯一影响 file target 的 renderMode 首值（file-browser/manual =
 *  "看源码"；explicit-link/tool-result = "执行渲染"，对齐 Hermes
 *  isFilePreviewSource 语义） */
export type PreviewRecordSource = 'explicit-link' | 'file-browser' | 'manual' | 'tool-result'

export interface PreviewTarget {
  kind: PreviewTargetKind
  /** url target = 加载地址；file target = 文件绝对路径；artifact target = artifact registry id */
  url: string
  label?: string
  /** file target 文件名（tab 标签兜底） */
  name?: string
  /** 🔴 2026-08-20 对齐 Hermes preview-artifact：artifact target 的 registry id
   *  （= `${sessionId}:${slug}`，内容由 store/artifacts 持有） */
  artifactId?: string
  /** 🔴 2026-08-20 对齐 Hermes PreviewTarget.dataUrl：内联图片字节（粘贴/拖拽截图，
   *   磁盘副本不可靠重读时直接渲染，不持久化） */
  dataUrl?: string
  /** 🔴 2026-08-28 对齐 Hermes：打开来源（renderMode 首值依据 + closePreviewMatching
   *  候选字段） */
  source?: PreviewRecordSource
  /** 🔴 2026-08-28 对齐 Hermes renderMode：file target 的首选视图
   *  （'preview' = HTML 执行渲染；'source' = 源码。由 openPreview 按 source 定首值） */
  renderMode?: 'preview' | 'source'
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

// ── 持久化（对齐 Hermes $previewTabs persistentAtom + $rightRailActiveTabId）──
// 重启后恢复打开过的 file/url tab 与激活项；无 localStorage 环境静默降级为纯运行时

const PREVIEW_STORAGE_KEY = 'eleve.previewTabs.v1'

function isPersistableTab(value: unknown): value is PreviewTab {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  const target = r.target as Record<string, unknown> | undefined
  return (
    typeof r.id === 'string' &&
    !!target &&
    (target.kind === 'url' || target.kind === 'file') &&
    typeof target.url === 'string'
  )
}

function loadPersistedTabs(): { tabs: PreviewTab[]; activeId: string | null } {
  const fallback = { tabs: [] as PreviewTab[], activeId: null }
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeId?: unknown }
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(isPersistableTab).map((t) => ({
          id: t.id,
          target: t.target,
          label: typeof t.label === 'string' && t.label ? t.label : labelFor(t.target),
        }))
      : []
    // 🔴 对齐 Hermes preview encode：内联字节（dataUrl）不可恢复也不落盘——
    // 恢复时剥离，防大字节常驻 localStorage（消费端 PreviewFilePane 已支持
    // dataUrl 直渲染，这里只保证持久化层不带字节）
    for (const t of tabs) {
      if ('dataUrl' in t.target) {
        const { dataUrl: _stripped, ...rest } = t.target
        t.target = rest as typeof t.target
      }
    }
    // 🔴 对齐 Hermes decodePreviewTabs：id 按 previewTabId 重键（旧存储可能
    // 存在多个 url tab——Browser 单例化后 URL target 共享 'url:browser'），
    // URL tab 只保最后一个——最近打开的页面是浏览器显示的那个
    const rekeyed = tabs.map((t) => ({ ...t, id: previewTabId(t.target) }))
    let lastUrlIdx = -1
    rekeyed.forEach((t, i) => { if (t.target.kind === 'url') lastUrlIdx = i })
    const deduped = rekeyed.filter((t, i) => t.target.kind !== 'url' || i === lastUrlIdx)
    const activeId =
      typeof parsed.activeId === 'string' && deduped.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : (deduped[0]?.id ?? null)
    return { tabs: deduped, activeId }
  } catch {
    return fallback
  }
}

function persistTabs(): void {
  try {
    if (state.tabs.length === 0) {
      localStorage.removeItem(PREVIEW_STORAGE_KEY)
      return
    }
    localStorage.setItem(
      PREVIEW_STORAGE_KEY,
      JSON.stringify({ tabs: state.tabs, activeId: state.activeId }),
    )
  } catch {
    /* 存储不可用（隐私模式等），静默降级为纯运行时 */
  }
}

const restoredTabs = loadPersistedTabs()

let state: PreviewState = {
  tabs: restoredTabs.tabs,
  activeId: restoredTabs.activeId,
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

/** 非 hook 快照读取（全局快捷键等非 React 上下文用；对齐 Hermes get() 语义） */
export function getPreviewStoreState(): PreviewState {
  return state
}

function update(patch: Partial<PreviewState>): void {
  state = { ...state, ...patch }
  // 仅 tab 组成变化时落盘（reloadRequest/restart 是运行时态）
  if ('tabs' in patch || 'activeId' in patch) persistTabs()
  notify()
}

/** tab 标签：取 URL/路径末段（对齐 Hermes tabLabelFor） */
function labelFor(target: PreviewTarget): string {
  const value = target.label || target.name || target.url
  const tail = value.split(/[\\/]/).filter(Boolean).at(-1)
  return tail || value || '预览'
}

// ── Actions ──

/** 🔴 2026-08-28 对齐 Hermes previewTabId + BROWSER_TAB_ID：URL target 全部共享
 *  单一 Browser tab——"the tab names the SURFACE (Browser), not the page"。
 *  打开第二个 URL = 导航已有 Browser tab（re-front + 原位换 target），不开新 tab；
 *  file/artifact 仍按身份各自成 tab。 */
export function previewTabId(target: PreviewTarget): string {
  return target.kind === 'url' ? 'url:browser' : `${target.kind}:${target.url}`
}

// "浏览文件 = 看源码"；工具/显式链接递来的 HTML = "执行渲染"
// （对齐 Hermes isFilePreviewSource / previewTargetForSource）
function isFilePreviewSource(source: PreviewRecordSource): boolean {
  return source === 'file-browser' || source === 'manual'
}

function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path.split(/[?#]/, 1)[0] || path)
}

function previewTargetForSource(target: PreviewTarget, source: PreviewRecordSource): PreviewTarget {
  const withSource: PreviewTarget = { ...target, source }
  if (withSource.kind !== 'file' || !isHtmlPath(withSource.url) || withSource.renderMode === 'source') {
    return withSource
  }
  return { ...withSource, renderMode: isFilePreviewSource(source) ? 'source' : 'preview' }
}

/** 打开预览 tab（对齐 Hermes openPreview：open (or re-front) —— 同 id 已有
 *  → 原位刷新 target 再选中（stale label/path 不能比它指向的内容活得久）；
 *  URL target 走 Browser 单例（previewTabId）；自动请求打开预览面板） */
export function openPreview(rawTarget: PreviewTarget, source: PreviewRecordSource = 'manual'): string {
  const target = previewTargetForSource(rawTarget, source)
  const id = previewTabId(target)
  const existing = state.tabs.find((t) => t.id === id)
  if (existing) {
    update({
      tabs: state.tabs.map((t) =>
        t.id === existing.id ? { ...t, target, label: labelFor(target) } : t,
      ),
      activeId: existing.id,
    })
    requestPaneOpen()
    return existing.id
  }

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

/** 关闭全部 artifact 预览 tab（🔴 对齐 Hermes closeArtifactPreviewTabs：
 *  "Artifact tabs can't outlive the registry they read from, so clearing it
 *  closes them"——产物 tab 读的是内存注册表，注册表清空后 tab 无法再从源重读；
 *  file/url tab 可从磁盘/网络重读，保留不动）。由 store/artifacts 清空时调用。 */
export function closeArtifactPreviewTabs(): void {
  const artifactTabs = state.tabs.filter((t) => t.target.kind === 'artifact')
  if (artifactTabs.length === 0) return
  let { tabs, activeId } = state
  for (const tab of artifactTabs) tabs = tabs.filter((t) => t.id !== tab.id)
  if (activeId && !tabs.some((t) => t.id === activeId)) {
    const idx = state.tabs.findIndex((t) => t.id === activeId)
    activeId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
  }
  update({ tabs, activeId })
}

/** Close the tab showing `source`, if one is open. Returns whether it closed.
 *  （对齐 Hermes closePreviewForSource） */
export function closePreviewForSource(source: string): boolean {
  return closePreviewMatching(source)
}

/** Close the first tab whose source, url, or label matches any candidate.
 *  Empty candidates are a no-op so a missed match cannot wipe the rail —
 *  closing the whole pane is closeAllTabs.（对齐 Hermes closePreviewMatching：
 *  preview.close 事件消费用） */
export function closePreviewMatching(...candidates: string[]): boolean {
  const queries = [...new Set(candidates.map((v) => v.trim()).filter(Boolean))]
  if (queries.length === 0) return false

  const tab = state.tabs.find((item) => {
    const fields = [item.target.source, item.target.url, item.target.label, item.label]
    return queries.some((q) => fields.includes(q))
  })
  if (!tab) return false

  closeTab(tab.id)
  return true
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
