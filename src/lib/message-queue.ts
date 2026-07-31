/**
 * message-queue.ts — 消息排队持久化模块（对齐 Hermes composer-queue.ts）
 *
 * 设计原则（对齐 Hermes）：
 * - 100% 前端驱动，无后端事件
 * - localStorage 持久化（跨刷新/重连存活）
 * - Per-profile 键控（Agent 维度，session 重置不影响队列）
 * - 重试上限（MAX_DRAIN_ATTEMPTS），超限 toast 提示，条目留队等手动
 * - edge-independent 出队（不依赖 busy→idle 边沿，重连 remount 不吞触发）
 */

export interface QueuedMessage {
  id: string;
  text: string;
  modelOpts?: { model?: string; provider?: string };
  queuedAt: number;
}

const STORAGE_KEY = 'eleve.message.queue.v1';

// ── 内部工具 ──

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

// ── 公开 API ──

/** 入队（排队时已乐观上屏，此处只管持久化） */
export function enqueue(profile: string, msg: { text: string; modelOpts?: { model?: string; provider?: string } }): QueuedMessage {
  const state = load();
  const entry: QueuedMessage = { id: nextId(), text: msg.text, modelOpts: msg.modelOpts, queuedAt: Date.now() };
  state[profile] = [...(state[profile] ?? []), entry];
  save(state);
  return entry;
}

/** 出队（FIFO，取队首） */
export function dequeue(profile: string): QueuedMessage | null {
  const state = load();
  const queue = state[profile];
  if (!queue || queue.length === 0) return null;
  const [head, ...rest] = queue;
  if (rest.length === 0) {
    delete state[profile];
  } else {
    state[profile] = rest;
  }
  save(state);
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

/** 清空指定 profile 队列 */
export function clearQueue(profile: string): void {
  const state = load();
  if (profile in state) {
    delete state[profile];
    save(state);
  }
}

/** 移除指定条目（用户手动取消） */
export function removeEntry(profile: string, id: string): boolean {
  const state = load();
  const queue = state[profile];
  if (!queue) return false;
  const next = queue.filter(e => e.id !== id);
  if (next.length === queue.length) return false;
  if (next.length === 0) {
    delete state[profile];
  } else {
    state[profile] = next;
  }
  save(state);
  return true;
}

/** 获取完整队列（UI 展示用） */
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
 * 重连/remount 重置 busy ref 不会吞掉触发。
 */
export function shouldAutoDrain(isBusy: boolean, profile: string): boolean {
  return !isBusy && getQueueLength(profile) > 0;
}
