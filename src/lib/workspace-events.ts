/**
 * workspace-events — 工作区变化信号（移植 Hermes store/workspace-events.ts 核心）
 *
 * 事件驱动的"工作区树变了"信号——替代轮询（Hermes 明确：event-driven is the
 * smart replacement for polling）。Agent 只经工具改文件 → tool.complete（带
 * inline_diff 或写文件类工具名）是精准触发；spot editor 保存文件同样触发。
 *
 * 消费方：文件树自动刷新（非破坏——保留展开状态，重载数据）。webview 预览
 * 刷新走独立链路（preview-events.ts requestPreviewReload），不重复。
 *
 * 与 Hermes 差异（架构干净：只移植有消费方的面）：
 * - 去 dirs/full 精准失效（Hermes 供大仓库树精准子树刷新；ELEVE 树规模小，
 *   消费方统一全刷，不预置无消费方的复杂度）
 * - 保留 Hermes throttle 语义（500ms leading+trailing 合并 burst：连续编辑
 *   一次 tick，首击即时反馈、尾部补发收尾）
 */

import { useSyncExternalStore } from 'react';

const MIN_INTERVAL_MS = 500;
let tick = 0;
let lastFired = 0;
let trailing: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function fire(): void {
  lastFired = Date.now();
  tick += 1;
  emit();
}

/** 工作区变化信号（Agent 写文件 / spot editor 保存）。burst 合并：leading 即时 + trailing 收尾 */
export function notifyWorkspaceChanged(): void {
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
  return useSyncExternalStore(subscribe, () => tick);
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
