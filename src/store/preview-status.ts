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
  const current = bySession[sid] ?? []
  if (current.some((item) => item.id === target)) return
  const label = target.split(/[\\/]/).filter(Boolean).pop() || target
  const next = [...current, { id: target, label, target, cwd }]
  while (next.length > MAX_PER_SESSION) next.shift()
  bySession = { ...bySession, [sid]: next }
  emit()
}

/** 移除一条（状态行 dismiss 按钮） */
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
  emit()
}

/** 清空会话 feed（发送新消息时——对齐 Hermes clearPreviewArtifacts） */
export function clearPreviewArtifacts(sid: string): void {
  if (!bySession[sid]) return
  const { [sid]: _dropped, ...rest } = bySession
  bySession = rest
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
