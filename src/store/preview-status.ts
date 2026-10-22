/**
 * preview-status — 会话级"可预览产物"feed（🔴 2026-08-28 对齐 Hermes
 * store/preview-status.ts + composer status-stack）
 *
 * 工具产出可预览目标（HTML 文件 / localhost dev URL / #preview 链接）时，
 * 在输入框上方显示紧凑链接行——不自动打开、不是大卡片，点击手动开。
 * 检测源 = 工具行自身（ToolEntry，与消息内 #preview 链接同一检测，
 * 检测一致性对齐 Hermes "detection parity is exact"）。
 *
 * 语义对齐：
 * - recordPreviewArtifact 幂等（工具行每次渲染重报，同 target 保槽位不重排）
 * - newest last、每会话上限 4（MAX_PER_SESSION）
 * - 检测时捕获 cwd（相对路径点击时仍可归一化——配合 lib/session-cwd）
 * - 发送新消息清空当前会话 feed（对齐 Hermes use-prompt-actions clearPreviewArtifacts）
 *
 * 存储模式对齐 ELEVE store/preview-console.ts：useSyncExternalStore，内存态。
 */

import { useSyncExternalStore } from 'react'
import { isWindowsAbsPath, joinPath } from '@/lib/local-preview'

export interface PreviewArtifact {
  /** 检测时捕获的 cwd（相对路径点击时仍可 resolve） */
  cwd: string
  /** 去重键（🔴 R2.5：规范身份——file:// 解码/反斜杠归一/相对路径按 cwd join
   *  折叠；同一文件两种写法 = 同一条 feed 条目）。dismiss 记忆同键 */
  id: string
  label: string
  /** 原始 target 串（点击归一化时用，保留原貌） */
  target: string
}

const MAX_PER_SESSION = 4

// ── 🔴 2026-10-23 S3.4 对齐 Hermes store/preview-status.ts：dismiss 持久化 +
//    双层 cap（128 session / 64 target）+ 写失败 volatile 降级 ──
// 重放历史消息不重现已关条目；重启后仍记得用户关过什么
const DISMISSED_STORAGE_KEY = 'eleve.previewDismissed.v1'
const MAX_DISMISSED_SESSIONS = 128
const MAX_DISMISSED_TARGETS = 64

function loadDismissed(): Record<string, Set<string>> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, Set<string>> = {}
    const entries = Object.entries(parsed).filter(
      ([, value]) => Array.isArray(value),
    ) as [string, unknown[]][]
    for (const [sid, value] of entries.slice(-MAX_DISMISSED_SESSIONS)) {
      const targets = value.filter((v): v is string => typeof v === 'string').slice(-MAX_DISMISSED_TARGETS)
      if (targets.length > 0) result[sid] = new Set(targets)
    }
    return result
  } catch {
    return {}
  }
}

function persistDismissed(): void {
  try {
    const sids = Object.keys(dismissedBySession)
    const out: Record<string, string[]> = {}
    for (const sid of sids.slice(-MAX_DISMISSED_SESSIONS)) {
      const targets = [...dismissedBySession[sid]].slice(-MAX_DISMISSED_TARGETS)
      if (targets.length > 0) out[sid] = targets
    }
    const keys = Object.keys(out)
    if (keys.length === 0) localStorage.removeItem(DISMISSED_STORAGE_KEY)
    else localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(out))
  } catch {
    /* 存储不可用（隐私模式等）→ volatile 降级，内存记忆仍然有效 */
  }
}

let bySession: Record<string, PreviewArtifact[]> = {}
/**
 * 🔴 2026-09-01 BUG 修复（用户报"网址条关不掉，切会话/项目一直在"）：
 * 用户 dismiss 过的 target 记忆表（per session）。ToolEntry 的上报 effect
 * 无依赖数组（每次渲染重报），dismiss 后任何重渲染都会把条目复活——
 * 记录 dismissed 后 record 端跳过，直到 clearPreviewArtifacts（发送新消息
 * = 新一轮工具输出，重新允许显示，对齐 Hermes clearPreviewArtifacts 语义）。
 * 🔴 S3.4：初值从持久化恢复（对齐 Hermes DISMISSED_PREVIEWS_KEY 落盘）。
 */
let dismissedBySession: Record<string, Set<string>> = loadDismissed()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** 🔴 2026-10-23 R2.5 对齐 Hermes previewArtifactKey（lib/preview-targets.ts）：
 *  feed 条目身份 = 规范化文件身份（file:// 解码、反斜杠归一、相对路径按 cwd
 *  join 折叠、盘符前斜杠归一）——同文件两写法（file:///C:/a.html 与 C:\a.html、
 *  ./x.html 与 x.html）不再产生两行 feed，dismiss 记忆也随之稳定 */
function canonicalArtifactKey(raw: string, cwd: string): string {
  let value = raw.trim().replace(/^`|`$/g, '')
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname)
    } catch {
      value = value.replace(/^file:\/\//i, '')
    }
  } else if (!value.startsWith('/') && !isWindowsAbsPath(value) && cwd) {
    value = joinPath(cwd, value)
  }
  return value.replace(/\\/g, '/').replace(/^\/(?=[A-Za-z]:)/, '')
}

/** 🔴 S3.5 对齐 Hermes label 去重：同会话内同名目标（两个 index.html）逐层
 *  加深路径消歧，直到唯一；新加入者加深（不动已有条目，Hermes 同款） */
function disambiguatedLabel(target: string, existing: PreviewArtifact[]): string {
  const segments = target.split(/[\\/]/).filter(Boolean)
  const name = segments.pop() || target
  if (!existing.some((item) => item.label === name)) return name
  for (let depth = 1; depth <= segments.length; depth++) {
    const candidate = [...segments.slice(-depth), name].join('/')
    if (!existing.some((item) => item.label === candidate)) return candidate
  }
  return target
}

/** 记录一条检测到的可预览目标（幂等：已存在保持槽位与顺序，不 churn） */
export function recordPreviewArtifact(sid: string, target: string, cwd: string): void {
  if (!sid || !target) return
  // 🔴 R2.5：身份 = 规范 key（两写法同文件 → 同一条）
  const id = canonicalArtifactKey(target, cwd)
  // 🔴 用户 dismiss 过的 target 不复活（重报跳过；发新消息时解除）
  if (dismissedBySession[sid]?.has(id)) return
  const current = bySession[sid] ?? []
  if (current.some((item) => item.id === id)) return
  const label = disambiguatedLabel(target, current)
  const next = [...current, { id, label, target, cwd }]
  while (next.length > MAX_PER_SESSION) next.shift()
  bySession = { ...bySession, [sid]: next }
  emit()
}

/** 移除一条（状态行 dismiss 按钮）——记入 dismissed，防 ToolEntry 重报复活 */
export function removePreviewArtifact(sid: string, id: string): void {
  const current = bySession[sid]
  if (!current?.some((item) => item.id === id)) return
  const next = current.filter((item) => item.id !== id)
  if (next.length === 0) {
    const { [sid]: _dropped, ...rest } = bySession
    bySession = rest
  } else {
    bySession = { ...bySession, [sid]: next }
  }
  // dismissed 记忆（防复活）；🔴 S3.4：cap 升至 64（对齐 Hermes 64 target）+ 落盘
  const dismissed = dismissedBySession[sid] ?? new Set<string>()
  dismissed.add(id)
  if (dismissed.size > MAX_DISMISSED_TARGETS) {
    const first = dismissed.values().next().value
    if (first !== undefined) dismissed.delete(first)
  }
  dismissedBySession[sid] = dismissed
  persistDismissed()
  emit()
}

/** 清空会话 feed（发送新消息时——对齐 Hermes clearPreviewArtifacts）；
 *  同步解除 dismissed 记忆：新一轮的工具输出重新允许显示 */
export function clearPreviewArtifacts(sid: string): void {
  const hadFeed = !!bySession[sid]
  const hadDismissed = !!dismissedBySession[sid]
  if (!hadFeed && !hadDismissed) return
  if (hadFeed) {
    const { [sid]: _dropped, ...rest } = bySession
    bySession = rest
  }
  if (hadDismissed) {
    const { [sid]: _d, ...restD } = dismissedBySession
    dismissedBySession = restD
    persistDismissed()
  }
  emit()
}

/** 🔴 2026-08-28 修复 React #185（整页无限渲染崩溃）：空会话快照必须返回
 * **模块级常量**（稳定引用）——之前 `?? []` 每次返回新空数组，React 的
 * useSyncExternalStore 渲染后比对快照 Object.is 永不相等 → 强制重渲染 →
 * 又是新数组 → 无限循环。会话无产物时 Main 界面一打开即崩（#185）。 */
const EMPTY_ARTIFACTS: PreviewArtifact[] = []

export function getPreviewArtifacts(sid: string): PreviewArtifact[] {
  return bySession[sid] ?? EMPTY_ARTIFACTS
}

/** React 订阅（状态行渲染用） */
export function usePreviewArtifacts(sid: string): PreviewArtifact[] {
  return useSyncExternalStore(
    subscribe,
    () => getPreviewArtifacts(sid),
    () => getPreviewArtifacts(sid),
  )
}
