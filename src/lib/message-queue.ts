/**
 * message-queue.ts — 消息排队持久化模块（对齐 Hermes composer-queue.ts）
 *
 * 设计原则（对齐 Hermes）：
 * - 100% 前端驱动，无后端事件
 * - localStorage 持久化（跨刷新/重连存活）
 * - Per-profile 键控（Agent 维度，session 重置不影响队列）
 * - 重试上限（MAX_DRAIN_ATTEMPTS），超限 toast 提示，条目留队等手动
 * - edge-independent 出队（不依赖 busy→idle 边沿，重连 remount 不吞触发）
 *
 * 附件归属模型（对齐 Hermes entry 级 · 适配 ELEVE session 级预附着语义）：
 * - QueuedMessage.attachments 仅存元数据（id/name/size/preview），可持久化
 * - 图片 base64 持内存 Map（entryId→dataURL[]），不进 localStorage（防 5MB 爆）
 * - 排队时不附着后端；drain 时 attachImage → 立即 submit，串行窗口保证归属
 * - 诚实降级：刷新后内存丢 → 条目降纯文本 + toast"附件已失效"
 */
import { useSyncExternalStore } from 'react';

// ── 类型 ──

/** 排队附件元数据（可持久化，不含 base64） */
export interface QueuedAttachment {
  id: string;
  name: string;
  size: number;
  /** data URL 预览（小图，持久化用；与内存 base64 独立） */
  preview: string;
}

export interface QueuedMessage {
  id: string;
  text: string;
  modelOpts?: { model?: string; provider?: string };
  /** 附件元数据（对齐 Hermes QueuedPromptEntry.attachments） */
  attachments: QueuedAttachment[];
  queuedAt: number;
}

// ── 存储 ──

const STORAGE_KEY = 'eleve.message.queue.v1';

type QueueState = Record<string, QueuedMessage[]>;

function load(): QueueState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function save(state: QueueState): void {
  try {
    if (Object.keys(state).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch { /* best-effort: storage 不可用时队列仍在内存工作 */ }
}

function nextId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── 响应式订阅（useSyncExternalStore 模式，对齐 Hermes nanostores $queuedPromptsBySession）──

const listeners = new Set<() => void>();
/** 快照缓存：每次写入后生成新引用，useSyncExternalStore 靠引用相等判断是否重渲染 */
let snapshotCache: QueueState = load();

function emitChange(): void {
  snapshotCache = load();
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot(): QueueState {
  return snapshotCache;
}

/** React hook：订阅指定 profile 的队列（仅该 profile 变化时重渲染） */
export function useQueue(profile: string): QueuedMessage[] {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return state[profile] ?? [];
}

// ── 内存附件数据（base64 dataURL，不持久化，刷新即丢）──

const attachmentDataMap = new Map<string, string[]>();

/** 排队时暂存附件 base64（drain 时取出附着后端） */
export function stashAttachmentData(entryId: string, dataURLs: string[]): void {
  if (dataURLs.length > 0) attachmentDataMap.set(entryId, dataURLs);
}

/** drain 时取出附件 base64（取后删除，一次性消费） */
export function takeAttachmentData(entryId: string): string[] | undefined {
  const data = attachmentDataMap.get(entryId);
  if (data) attachmentDataMap.delete(entryId);
  return data;
}

// ── 公开 API（对齐 Hermes composer-queue.ts 全量函数）──

/** 入队（对齐 Hermes enqueueQueuedPrompt） */
export function enqueue(
  profile: string,
  msg: { text: string; modelOpts?: { model?: string; provider?: string }; attachments?: QueuedAttachment[] },
): QueuedMessage {
  const state = load();
  const entry: QueuedMessage = {
    id: nextId(),
    text: msg.text,
    modelOpts: msg.modelOpts,
    attachments: msg.attachments ?? [],
    queuedAt: Date.now(),
  };
  state[profile] = [...(state[profile] ?? []), entry];
  save(state);
  emitChange();
  return entry;
}

/** 出队 FIFO（对齐 Hermes dequeueQueuedPrompt） */
export function dequeue(profile: string): QueuedMessage | null {
  const state = load();
  const queue = state[profile];
  if (!queue || queue.length === 0) return null;
  const [head, ...rest] = queue;
  if (rest.length === 0) { delete state[profile]; } else { state[profile] = rest; }
  save(state);
  emitChange();
  return head!;
}

/** 查看队首（不出队） */
export function peek(profile: string): QueuedMessage | null {
  const state = load();
  const queue = state[profile];
  return queue && queue.length > 0 ? queue[0]! : null;
}

/** 队列长度 */
export function getQueueLength(profile: string): number {
  const state = load();
  return state[profile]?.length ?? 0;
}

/** 清空指定 profile 队列（对齐 Hermes clearQueuedPrompts） */
export function clearQueue(profile: string): void {
  const state = load();
  if (profile in state) {
    delete state[profile];
    save(state);
    emitChange();
  }
}

/** 移除指定条目（对齐 Hermes removeQueuedPrompt） */
export function removeEntry(profile: string, id: string): boolean {
  const state = load();
  const queue = state[profile];
  if (!queue) return false;
  const next = queue.filter((e) => e.id !== id);
  if (next.length === queue.length) return false;
  if (next.length === 0) { delete state[profile]; } else { state[profile] = next; }
  save(state);
  emitChange();
  attachmentDataMap.delete(id);
  return true;
}

/** 置首（对齐 Hermes promoteQueuedPrompt：busy 时"立即发送" = 置首 + abort，轮末 auto-drain 发出） */
export function promoteEntry(profile: string, id: string): boolean {
  const state = load();
  const queue = state[profile];
  if (!queue) return false;
  const idx = queue.findIndex((e) => e.id === id);
  if (idx <= 0) return false;
  const entry = queue[idx]!;
  state[profile] = [entry, ...queue.slice(0, idx), ...queue.slice(idx + 1)];
  save(state);
  emitChange();
  return true;
}

/** 编辑条目（对齐 Hermes updateQueuedPrompt：text + attachments 可选更新） */
export function updateEntry(
  profile: string,
  id: string,
  update: { text: string; attachments?: QueuedAttachment[] },
): boolean {
  const state = load();
  const queue = state[profile];
  if (!queue) return false;
  let changed = false;
  const next = queue.map((entry) => {
    if (entry.id !== id) return entry;
    if (entry.text === update.text && !update.attachments) return entry;
    changed = true;
    return {
      ...entry,
      text: update.text,
      ...(update.attachments ? { attachments: update.attachments } : {}),
    };
  });
  if (!changed) return false;
  state[profile] = next;
  save(state);
  emitChange();
  return true;
}

/** 获取完整队列（非响应式，drain 逻辑用） */
export function getQueue(profile: string): QueuedMessage[] {
  const state = load();
  return state[profile] ?? [];
}

// ── 出队决策（对齐 Hermes shouldAutoDrain）──

/** 出队重试上限（对齐 Hermes MAX_AUTO_DRAIN_ATTEMPTS = 4） */
export const MAX_DRAIN_ATTEMPTS = 4;

/**
 * 是否应自动出队（对齐 Hermes shouldAutoDrain）
 * edge-independent：只要空闲且队列非空就出队，不依赖 busy→idle 边沿。
 */
export function shouldAutoDrain(isBusy: boolean, profile: string): boolean {
  return !isBusy && getQueueLength(profile) > 0;
}

// ── per-entry 失败计数（对齐 Hermes drainFailuresRef Map，替代旧全局计数）──

const drainFailures = new Map<string, number>();

export function getDrainFailures(entryId: string): number {
  return drainFailures.get(entryId) ?? 0;
}

export function incrementDrainFailures(entryId: string): number {
  const n = (drainFailures.get(entryId) ?? 0) + 1;
  drainFailures.set(entryId, n);
  return n;
}

export function clearDrainFailures(entryId: string): void {
  drainFailures.delete(entryId);
}

export function resetAllDrainFailures(): void {
  drainFailures.clear();
}
