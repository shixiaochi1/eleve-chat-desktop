/**
 * session-dot-state.ts — 会话状态点解析（对齐 Hermes session-row-state.ts）
 *
 * 纯函数：互斥展示态优先级解析。Hermes 原注释：
 * "Resolve the sidebar dot's mutually-exclusive display state by priority."
 * 6 态全对齐：needs-input > working/stalled > background > unread > idle。
 * background 数据源 = process.list 全量轮询（store/session-status.ts），
 * Hermes 用 per-session 轮询，ELEVE 单点全量（同语义更省请求）。
 */

export type SessionDotState = 'needs-input' | 'working' | 'stalled' | 'background' | 'unread' | 'idle';

export interface SessionRowState {
  hasBackground: boolean;
  isStalled: boolean;
  isUnread: boolean;
  isWorking: boolean;
  needsInput: boolean;
}

export function sessionDotState({
  hasBackground,
  isStalled,
  isUnread,
  isWorking,
  needsInput,
}: SessionRowState): SessionDotState {
  if (needsInput) {
    return 'needs-input';
  }

  if (isWorking) {
    return isStalled ? 'stalled' : 'working';
  }

  if (hasBackground) {
    return 'background';
  }

  return isUnread ? 'unread' : 'idle';
}

/** 安静轮仍在权威运行：只有阻塞式 prompt（needsInput）才抑制行 arc（对齐 Hermes） */
export function sessionShowsRunningArc({
  isWorking,
  needsInput,
}: Pick<SessionRowState, 'isWorking' | 'needsInput'>): boolean {
  return isWorking && !needsInput;
}
