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
  /** 🔴 2026-08-29 对齐 Hermes previewKind：内容形态——渲染分派优先消费，
   *  缺省回退扩展名推导（localPreviewTarget 按扩展名填充） */
  previewKind?: 'binary' | 'html' | 'image' | 'pdf' | 'text'
  /** 🔴 2026-08-29 对齐 Hermes mimeType：MIME 类型（扩展名映射；后端嗅探后可覆盖） */
  mimeType?: string
  /** 🔴 2026-08-29 对齐 Hermes binary：二进制文件（嗅探命中，禁编辑走专用渲染） */
  binary?: boolean
  /** 🔴 2026-08-29 对齐 Hermes byteSize：字节大小 */
  byteSize?: number
  /** 🔴 2026-08-29 对齐 Hermes large：大文件（>512KB——预览需确认，编辑禁用） */
  large?: boolean
  /** 🔴 2026-08-29 对齐 Hermes transient：一次性目标（不持久化） */
  transient?: boolean
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
  /** 🔴 2026-08-29 对齐 Hermes $browserPages：每个 Browser tab 的当前页面地址。
   *  运行时与 target.url 分离（页面内导航不销毁 webview，SPA 状态保留）；
   *  落盘时 merge 进 target.url（对齐 Hermes commitBrowserTabLocation 手递手
   *  回写持久化 tab）——切走再切回 / 重启后恢复到上次页面而非初始地址。 */
  browserPages: Record<string, string>
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
    // 🔴 2026-08-29 多 Browser tab 化（对齐 Hermes decodePreviewTabs）：URL tab
    // 保留原 id（url:browser-<rand>），不再合并单例；旧存储的 'url:browser'
    // 单例 id 合法直接保留。file/artifact 按 previewTabId 重键。
    const rekeyed = tabs.map((t) => ({
      ...t,
      id:
        t.target.kind === 'url'
          ? t.id.startsWith('url:')
            ? t.id
            : mintBrowserTabId()
          : previewTabId(t.target),
    }))
    const activeId =
      typeof parsed.activeId === 'string' && rekeyed.some((t) => t.id === parsed.activeId)
        ? parsed.activeId
        : (rekeyed[0]?.id ?? null)
    return { tabs: rekeyed, activeId }
  } catch {
    return fallback
  }
}

function persistTabs(): void {
  try {
    // 🔴 2026-08-29 对齐 Hermes preview encode（store/preview.ts:120-144）：
    // artifact tab 不落盘——其内容在内存注册表，刷新后无法还原（tab 不能比
    // 它的内容源活得久）；file/url tab 可从磁盘/网络重读，保留。
    const persistable = state.tabs.filter(
      (t) => t.target.kind !== 'artifact' && !t.target.transient,
    )
    if (persistable.length === 0) {
      localStorage.removeItem(PREVIEW_STORAGE_KEY)
      return
    }
    const activeId = persistable.some((t) => t.id === state.activeId)
      ? state.activeId
      : (persistable[0]?.id ?? null)
    // 🔴 对齐 Hermes commitBrowserTabLocation：页面地址手递手回写持久化 tab——
    // 重启后恢复到"上次在哪"而非 tab 打开时的初始地址
    const serialized = persistable.map((t) =>
      t.target.kind === 'url' && state.browserPages[t.id]
        ? { ...t, target: { ...t.target, url: state.browserPages[t.id] } }
        : t,
    )
    localStorage.setItem(
      PREVIEW_STORAGE_KEY,
      JSON.stringify({ tabs: serialized, activeId }),
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
  browserPages: {},
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
  // 仅 tab 组成/页面地址变化时落盘（reloadRequest/restart 是运行时态）
  if ('tabs' in patch || 'activeId' in patch || 'browserPages' in patch) persistTabs()
  notify()
}

/** tab 标签：取 URL/路径末段（对齐 Hermes tabLabelFor） */
function labelFor(target: PreviewTarget): string {
  const value = target.label || target.name || target.url
  const tail = value.split(/[\\/]/).filter(Boolean).at(-1)
  return tail || value || '预览'
}

// ── Actions ──

/** 🔴 2026-08-29 多 Browser tab 化（对齐 Hermes mintBrowserTabId）：新 Browser
 *  tab id = `url:browser-<rand>`——"the tab names the SURFACE (Browser)" */
function mintBrowserTabId(): string {
  return `url:browser-${Math.random().toString(36).slice(2, 10)}`
}

/** 🔴 2026-08-29 多 Browser tab 化（对齐 Hermes browserTabId）：URL target 归属
 *  "当前活跃的 Browser"——激活 Browser 就导航它，否则用最后一个 Browser，
 *  都没有才 mint 新 Browser。file/artifact 仍按身份各自成 tab。
 *  （用户主动要新 tab 走 newBrowserTab，不走此归属决策） */
function browserTabId(): string {
  const active = state.tabs.find((t) => t.id === state.activeId)
  if (active?.target.kind === 'url') return active.id
  const lastUrl = [...state.tabs].reverse().find((t) => t.target.kind === 'url')
  return lastUrl?.id ?? mintBrowserTabId()
}

export function previewTabId(target: PreviewTarget): string {
  return target.kind === 'url' ? browserTabId() : `${target.kind}:${target.url}`
}

/** 🔴 2026-08-31 用户定制：Browser surface 无历史 tab 时的默认落地页——
 *  DeepSeek（网页窗口按钮一点即达，可登录使用）。 */
export const BROWSER_DEFAULT_HOME = 'https://chat.deepseek.com/'

/** 🔴 2026-08-31 对齐 Hermes openBrowserTab（store/preview.ts L400-403）：
 *  Show the Browser — **the surface, not a page**。已有 Browser tab 则前置它
 *  （保留上次页面——再次唤起不清空）；没有则落默认主页（用户定制：DeepSeek，
 *  覆盖 Hermes 的 about:blank 空态）。消费方：网页窗口按钮主点击。 */
export function openBrowserTab(): string {
  const id = browserTabId()
  const current = state.tabs.find((t) => t.id === id)
  if (current) {
    update({ activeId: current.id })
    requestPaneOpen()
    return current.id
  }
  return openPreview({ kind: 'url', url: BROWSER_DEFAULT_HOME, label: '浏览器' }, 'manual')
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
  if (withSource.kind !== 'file' || withSource.renderMode === 'source') {
    return withSource
  }
  // 🔴 2026-08-29 对齐 Hermes 判定（previewKind === 'html' 优先，扩展名回退）：
  // mimeType 为 text/html 但扩展名非 .html 的文件也能正确执行渲染
  const isHtml = withSource.previewKind
    ? withSource.previewKind === 'html'
    : isHtmlPath(withSource.url)
  if (!isHtml) return withSource
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

/** 🔴 2026-08-29 对齐 Hermes newBrowserTab（store/preview.ts:409-415）：工具栏
 *  "+"永远开新 Browser tab——"新 tab 是用户主动要的"，不走 browserTabId
 *  归属决策。初始 about:blank（PreviewWebPane 空态，等用户输入地址）。 */
export function newBrowserTab(): string {
  const id = mintBrowserTabId()
  const tab: PreviewTab = {
    id,
    target: { kind: 'url', url: 'about:blank', label: '新标签页' },
    label: '新标签页',
  }
  update({ tabs: [...state.tabs, tab], activeId: id })
  requestPaneOpen()
  return id
}

/** Browser tab 地址回写：仅 about:blank 新 tab 首次输入地址时回写 target.url
 *  （webview 创建 effect 依赖 target.url——无 webview 时必须改 target 才能触发
 *  创建）；已有真实 URL 的 tab 不回写（页面内导航不销毁 webview，SPA 状态保留） */
export function commitBrowserTabUrl(tabId: string, url: string): void {
  update({
    tabs: state.tabs.map((t) =>
      t.id === tabId && t.target.kind === 'url' && t.target.url === 'about:blank' && t.target.url !== url
        ? { ...t, target: { ...t.target, url }, label: labelFor({ kind: 'url', url }) }
        : t,
    ),
  })
}

/** 🔴 2026-08-29 对齐 Hermes $browserPages / commitBrowserTabLocation：
 *  记录 Browser tab 的当前页面地址（导航完成后回写）。运行时与 target.url
 *  分离——页面内导航不销毁 webview；落盘时才 merge 进 target.url。 */
export function commitBrowserPage(tabId: string, url: string): void {
  if (state.browserPages[tabId] === url) return
  update({ browserPages: { ...state.browserPages, [tabId]: url } })
}

/** 读取 Browser tab 的恢复地址（切走再切回 / PreviewWebPane 重挂载时用） */
export function getBrowserPage(tabId: string): string | null {
  return state.browserPages[tabId] ?? null
}

/** 🔴 2026-08-29 对齐 Hermes noteBrowserPage + page-title-updated：页面标题
 *  回写 tab 标签（用户看到的 tab 名跟随真实页面，而非初始 URL 末段） */
export function setTabLabel(tabId: string, title: string): void {
  const trimmed = title.trim()
  if (!trimmed) return
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab || tab.label === trimmed) return
  update({ tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, label: trimmed } : t)) })
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
  const browserPages = { ...state.browserPages }
  delete browserPages[id]
  update({ tabs, activeId, browserPages })
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
