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

export interface PreviewArtifact {
  /** 检测时捕获的 cwd（相对路径点击时仍可 resolve） */
  cwd: string
  /** 去重键 + 显示 id（原始 target） */
  id: string
  label: string
  target: string
}

const MAX_PER_SESSION = 4

let bySession: Record<string, PreviewArtifact[]> = {}
/**
 * 🔴 2026-09-01 BUG 修复（用户报"网址条关不掉，切会话/项目一直在"）：
 * 用户 dismiss 过的 target 记忆表（per session）。ToolEntry 的上报 effect
 * 无依赖数组（每次渲染重报），dismiss 后任何重渲染都会把条目复活——
 * 记录 dismissed 后 record 端跳过，直到 clearPreviewArtifacts（发送新消息
 * = 新一轮工具输出，重新允许显示，对齐 Hermes clearPreviewArtifacts 语义）。
 */
let dismissedBySession: Record<string, Set<string>> = {}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** 记录一条检测到的可预览目标（幂等：已存在保持槽位与顺序，不 churn） */
export function recordPreviewArtifact(sid: string, target: string, cwd: string): void {
  if (!sid || !target) return
  // 🔴 用户 dismiss 过的 target 不复活（重报跳过；发新消息时解除）
  if (dismissedBySession[sid]?.has(target)) return
  const current = bySession[sid] ?? []
  if (current.some((item) => item.id === target)) return
  const label = target.split(/[\\/]/).filter(Boolean).pop() || target
  const next = [...current, { id: target, label, target, cwd }]
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
  // dismissed 记忆（防复活）；上限 16 防无界增长（超出即遗忘最旧的）
  const dismissed = dismissedBySession[sid] ?? new Set<string>()
  dismissed.add(id)
  dismissedBySession[sid] = dismissed
  if (dismissed.size > 16) {
    const first = dismissed.values().next().value
    if (first !== undefined) dismissed.delete(first)
  }
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
