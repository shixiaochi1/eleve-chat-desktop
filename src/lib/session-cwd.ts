/**
 * session-cwd — 当前会话工作目录全局持有点（🔴 2026-08-28 对齐 Hermes $currentCwd）
 *
 * Hermes：store/session.ts 的 nanostores atom `$currentCwd`，全部预览目标
 * 归一化调用点（markdown #preview 链接 / preview-row / attachments / panes）
 * 都以 `$currentCwd.get()` 为 cwd 来源——相对路径链接据此 join 成绝对路径。
 *
 * ELEVE 等价物：模块级单例（点击时同步读一次即可，无需 React 订阅）。
 * 唯一写入方 = App（sessionCwd state 变化同步）；读取方：
 * - StreamBlocks / ToolEntry：消息流 markdown `#preview` / `file:` 链接点击
 * - AgentCardComposer：附件 pill 点击（对齐 Hermes attachments.tsx:137 传 cwd）
 * - PreviewCenter：空态手动输入（对齐 Hermes panes.tsx:74 传 $currentCwd）
 * - preview-events：preview.open 事件归一化（替代原 App 闭包双轨）
 *
 * 修复的 bug：旧实现 markdown 链接点击不传 cwd → 工具输出相对路径
 * `#preview/src/index.html` 生成相对 file target → 文件读取失败。
 */

import { useSyncExternalStore } from 'react';

let currentSessionCwd: string | null = null;

export function setCurrentSessionCwd(cwd: string | null | undefined): void {
  const next = cwd?.trim() ? cwd : null;
  if (next === currentSessionCwd) return;
  currentSessionCwd = next;
  cwdListeners.forEach((l) => l());
}

export function getCurrentSessionCwd(): string | null | undefined {
  return currentSessionCwd;
}

// ── 订阅（🔴 2026-09-05 Review 域新增：cwd 变更 = 审查面板的"仓库移动"边界，
// 对齐 Hermes $currentCwd.subscribe → onReviewRepoMoved。原设计"无需 React
// 订阅"对点击时读取成立，对"面板持续跟随活动会话仓库"不成立）──

const cwdListeners = new Set<() => void>();

function subscribeCwd(l: () => void): () => void {
  cwdListeners.add(l);
  return () => {
    cwdListeners.delete(l);
  };
}

function getCwdSnapshot(): string | null {
  return currentSessionCwd;
}

/** React 订阅：活动会话 cwd 变化（useSyncExternalStore；值语义 null=无活动仓库） */
export function useSessionCwd(): string | null {
  return useSyncExternalStore(subscribeCwd, getCwdSnapshot, getCwdSnapshot);
}
