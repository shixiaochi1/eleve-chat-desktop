/**
 * workspace-events — 工作区变化信号（完整移植 Hermes store/workspace-events.ts）
 *
 * 事件驱动的"工作区树变了"信号——替代轮询（Hermes 明确：event-driven is the
 * smart replacement for polling）。Agent 只经工具改文件 → tool.complete（带
 * inline_diff 或写文件类工具名）是精准触发；spot editor 保存文件同样触发。
 *
 * 消费方：文件树自动刷新（非破坏——保留展开状态，增量更新数据）。
 *
 * 精准失效（dirs/full）：notifyWorkspaceChanged(changedPath) 携带绝对路径 →
 * 记录其父目录到 pendingDirs，消费方只重读已加载的变更目录；无路径/相对路径/
 * 无法锚定（terminal 等不透明变更）→ pendingFull，消费方全量 reconcile。
 * 与 Hermes store/workspace-events.ts 完全同构。
 */

import { createAtomStore } from './store-factory';

const MIN_INTERVAL_MS = 500;
let lastFired = 0;
let trailing: number | null = null;
// 🔴 2026-09-01 收敛：手写 listeners/emit/subscribe 样板 → createAtomStore（tick 计数器）
const tickStore = createAtomStore<number>(0);

function fire(): void {
  lastFired = Date.now();
  tickStore.set((t) => t + 1);
}

// ── 精准失效负载（对齐 Hermes pendingDirs/pendingFull）──

let pendingDirs = new Set<string>();
let pendingFull = false;

/** 消费自上次以来的变更（消费方 drain；对齐 Hermes consumeWorkspaceChange） */
export function consumeWorkspaceChange(): { dirs: string[]; full: boolean } {
  const change = { dirs: [...pendingDirs], full: pendingFull };
  pendingDirs = new Set();
  pendingFull = false;
  return change;
}

/** 绝对路径的父目录（POSIX 或 `C:/…`）；相对路径无法锚定 → null（消费方全量重扫） */
function dirOf(path: string): string | null {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const absolute = p.startsWith('/') || /^[a-z]:\//i.test(p);
  const slash = p.lastIndexOf('/');
  return absolute && slash >= 0 ? p.slice(0, slash) : null;
}

/** @param changedPath 工具触碰的绝对路径；省略（或相对/不可知路径）→ 全量重扫 */
export function notifyWorkspaceChanged(changedPath?: string): void {
  const dir = changedPath ? dirOf(changedPath) : null;

  if (dir) {
    pendingDirs.add(dir);
  } else {
    pendingFull = true;
  }

  const since = Date.now() - lastFired;
  if (since >= MIN_INTERVAL_MS) {
    if (trailing !== null) {
      clearTimeout(trailing);
      trailing = null;
    }
    fire();
  } else if (trailing === null) {
    trailing = window.setTimeout(() => {
      trailing = null;
      fire();
    }, MIN_INTERVAL_MS - since);
  }
}

/** 订阅 tick（消费方：文件树自动刷新） */
export function useWorkspaceTick(): number {
  return tickStore.useAtom();
}

/** 后端 workspace.changed 事件入口（外部文件变更权威源）
 * 与 notifyWorkspaceChanged 同源合并：dirs → pendingDirs / full → pendingFull，
 * 复用 500ms 去抖 fire()。消费端 consumeWorkspaceChange 零改动。 */
export function notifyExternalChange(change: { root?: string; dirs?: string[]; full?: boolean }): void {
  if (change.full) {
    pendingFull = true;
  }
  for (const dir of change.dirs ?? []) {
    if (dir) pendingDirs.add(dir);
  }
  fire();
}

// 写文件类工具名（Hermes MUTATING_TOOL_RE 移植）：terminal/shell 等隐式写文件
// 工具无 inline_diff，名字匹配兜底。无裸 `file` 词元（会误匹配只读工具）。
const MUTATING_TOOL_RE =
  /terminal|shell|exec|bash|command|write|edit|patch|replace|apply|create|delete|remove|move|rename|mkdir|format/i;

/** 工具完成事件是否可能改了文件（带 diff，或其名字暗示文件系统/终端变更） */
export function toolMayMutateFiles(payload: Record<string, unknown>): boolean {
  if (typeof payload.inline_diff === 'string' && payload.inline_diff.trim()) {
    return true;
  }
  const name = String(payload.tool ?? payload.name ?? '');
  return MUTATING_TOOL_RE.test(name);
}

// 单文件写入/移动工具的目标参数键（对齐 Hermes PATH_ARG_KEYS）。
// 命中 → 树精准刷新该目录；未命中（terminal/多路径/异构 schema）→ 全量重扫。
const PATH_ARG_KEYS = ['path', 'file_path', 'filename', 'file', 'target_file', 'new_path', 'dest', 'destination'];

/** 从工具 args 提取 best-effort 目标绝对路径；无（→ 全量重扫）时返回 undefined */
export function toolChangedPath(payload: { args?: unknown; arguments?: unknown }): string | undefined {
  const args = payload.args ?? payload.arguments;
  if (!args || typeof args !== 'object') {
    return undefined;
  }

  const record = args as Record<string, unknown>;
  for (const key of PATH_ARG_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}
