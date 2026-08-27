/**
 * Artifacts store — 对齐 Hermes store/artifacts.ts（2026-08-05 审查修正版）
 *
 * 消息里被提升的 artifact 注册表 + 版本累加 + 打开状态。
 * - 身份：一个 artifact = 一个 (sessionId, slug) 对；slug 由 kind+language+title 派生。
 *   模型在同一会话里重生成"dashboard"三次 = 一个 artifact 三个版本（像用户持续打磨的文档），
 *   不是三张卡。
 * - 版本去重：FNV-1a 内容哈希（同 slug 同 hash = no-op；同 slug 新内容 = 追加版本）
 * - 上限：每会话 24 artifacts / 每 artifact 20 版本 / 40 会话（LRU prune）
 * - 内存态：transcript 是持久副本；卡片重渲染自动重注册（重载重建注册表，不占 localStorage）
 * - 打开状态驱动浮层预览（Hermes 右栏；ELEVE 先浮层，后续可挪右栏）
 *
 * 存储模式与 store/messages.ts 一致：useSyncExternalStore + 事件订阅。
 */

import { useSyncExternalStore } from 'react'
import type { ArtifactDetection } from '@/lib/artifact-detect'
import { artifactSlug, artifactContentHash } from '@/lib/artifact-detect'
// 🔴 对齐 Hermes store/artifacts.ts:5 —— artifacts → preview 单向依赖：
// 注册表清空时关闭全部 artifact 预览 tab（tab 不能比它的内容源活得久）
import { closeArtifactPreviewTabs } from '@/store/preview'
import type { ListenerCallback, Unsubscribe } from '@/types'

export interface ArtifactVersion {
  content: string
  createdAt: number
  hash: string
}

export interface ArtifactRecord {
  createdAt: number
  id: string
  kind: ArtifactDetection['kind']
  language: string
  sessionId: string
  slug: string
  title: string
  updatedAt: number
  /** 旧 → 新；末位 = 当前版本 */
  versions: ArtifactVersion[]
}

export type ArtifactRegistry = Record<string, ArtifactRecord[]>

export interface ArtifactOpenState {
  /** artifact id（= `${sessionId}:${slug}`） */
  id: string
  versionIndex: number
}

const MAX_ARTIFACTS_PER_SESSION = 24
const MAX_VERSIONS_PER_ARTIFACT = 20
const MAX_SESSIONS = 40

function pruneRegistry(registry: ArtifactRegistry): ArtifactRegistry {
  const entries = Object.entries(registry)
    .map(([sessionId, records]) => {
      const trimmed = [...records]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_ARTIFACTS_PER_SESSION)
        .sort((a, b) => a.createdAt - b.createdAt)
      return [sessionId, trimmed] as const
    })
    .filter(([, records]) => records.length > 0)
    .sort(([, a], [, b]) => {
      const latest = (records: readonly ArtifactRecord[]) => Math.max(...records.map((record) => record.updatedAt))
      return latest(b) - latest(a)
    })
    .slice(0, MAX_SESSIONS)
  return Object.fromEntries(entries)
}

// ── Internal state ──
let registry: ArtifactRegistry = {}
let listeners = new Set<ListenerCallback>()
let openState: ArtifactOpenState | null = null
let openListeners = new Set<ListenerCallback>()

function notify(): void {
  listeners.forEach((cb) => cb())
}

function notifyOpen(): void {
  openListeners.forEach((cb) => cb())
}

function subscribe(cb: ListenerCallback): Unsubscribe {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function subscribeOpen(cb: ListenerCallback): Unsubscribe {
  openListeners.add(cb)
  return () => { openListeners.delete(cb) }
}

function getSnapshot(): ArtifactRegistry {
  return registry
}

function getOpenSnapshot(): ArtifactOpenState | null {
  return openState
}

// ── Hooks ──

export function useArtifacts(): ArtifactRegistry {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useOpenArtifact(): ArtifactOpenState | null {
  return useSyncExternalStore(subscribeOpen, getOpenSnapshot, getOpenSnapshot)
}

// ── Lookup ──

export function findArtifact(registryValue: ArtifactRegistry, artifactId: string): ArtifactRecord | null {
  for (const records of Object.values(registryValue)) {
    const found = records.find((record) => record.id === artifactId)
    if (found) return found
  }
  return null
}

export function getArtifact(artifactId: string): ArtifactRecord | null {
  return findArtifact(registry, artifactId)
}

export function findArtifactVersion(
  artifactId: string,
  versionIndex: number,
): { record: ArtifactRecord; version: ArtifactVersion } | null {
  const record = getArtifact(artifactId)
  if (!record) return null
  const version = record.versions[versionIndex] ?? record.versions[record.versions.length - 1]
  if (!version) return null
  return { record, version }
}

// ── Actions ──

export interface UpsertResult {
  artifactId: string
  record: ArtifactRecord
  /** true = 追加了新版本（vs 去重 no-op） */
  versionAdded: boolean
}

/**
 * 注册/版本化 artifact（对齐 Hermes upsertArtifact）：
 * 同 slug 同内容 hash = no-op（流式重挂载/transcript 重渲染反复调用）；
 * 同 slug 新内容 = 追加版本（截断到最近 20 版）。
 * 标题更新语义：再生成的 artifact 可能携带更精确的标题（html <title> 流式后期才到），
 * 优先采用非空新标题。
 */
export function upsertArtifact(
  sessionId: string | null | undefined,
  detection: ArtifactDetection,
  content: string,
): UpsertResult | null {
  const id = sessionId?.trim()
  const trimmed = content.trim()
  if (!id || !trimmed) return null

  const slug = artifactSlug(detection)
  const hash = artifactContentHash(trimmed)
  const records = registry[id] ?? []
  const existing = records.find((record) => record.slug === slug)
  const now = Date.now()

  if (existing) {
    const known = existing.versions.some((version) => version.hash === hash)
    if (known) {
      return { artifactId: existing.id, record: existing, versionAdded: false }
    }
    const versions = [...existing.versions, { content: trimmed, createdAt: now, hash }].slice(-MAX_VERSIONS_PER_ARTIFACT)
    const next: ArtifactRecord = {
      ...existing,
      title: detection.title || existing.title,
      updatedAt: now,
      versions,
    }
    registry = pruneRegistry({
      ...registry,
      [id]: records.map((record) => (record.id === existing.id ? next : record)),
    })
    notify()
    return { artifactId: existing.id, record: next, versionAdded: true }
  }

  const record: ArtifactRecord = {
    createdAt: now,
    id: `${id}:${slug}`,
    kind: detection.kind,
    language: detection.language,
    sessionId: id,
    slug,
    title: detection.title,
    updatedAt: now,
    versions: [{ content: trimmed, createdAt: now, hash }],
  }
  registry = pruneRegistry({ ...registry, [id]: [...records, record] })
  notify()
  return { artifactId: record.id, record, versionAdded: true }
}

/** 打开 artifact（浮层预览）；versionIndex 缺省 = 最新版。用户点击驱动，流式绝不调用。 */
export function openArtifact(artifactId: string, versionIndex?: number): void {
  const record = getArtifact(artifactId)
  if (!record) return
  openState = { id: artifactId, versionIndex: versionIndex ?? record.versions.length - 1 }
  notifyOpen()
}

export function closeArtifact(): void {
  openState = null
  notifyOpen()
}

/** 选择版本：选中 == 最新版时存 null（absent = newest，对齐 Hermes $artifactVersionSelection） */
export function selectArtifactVersion(artifactId: string, versionIndex: number): void {
  const record = getArtifact(artifactId)
  if (!record || versionIndex < 0) return
  const clamped = Math.min(record.versions.length - 1, versionIndex)
  if (clamped === record.versions.length - 1) {
    if (openState?.id === artifactId && openState.versionIndex === clamped) {
      // 最新版 = 默认态，保持显式索引即可（浮层展示等价）
      return
    }
  }
  openState = { id: artifactId, versionIndex: clamped }
  notifyOpen()
}

export function clearArtifactRegistry(): void {
  registry = {}
  openState = null
  notify()
  notifyOpen()
  // 🔴 对齐 Hermes clearArtifactRegistry（store/artifacts.ts:226）：
  // 注册表清空 → 全部 artifact 预览 tab 一并关闭（file/url tab 保留）
  closeArtifactPreviewTabs()
}
