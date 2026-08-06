/**
 * session-dot-state.ts — 会话状态点解析（对齐 Hermes session-row-state.ts）
 *
 * 纯函数：互斥展示态优先级解析。Hermes 原注释：
 * "Resolve the sidebar dot's mutually-exclusive display state by priority."
 * ELEVE 无 background 态（无 process→session 事件源，见 store/session-status.ts），
 * 6 态 → 5 态：needs-input > working/stalled > unread > idle。
 */

export type SessionDotState = 'needs-input' | 'working' | 'stalled' | 'unread' | 'idle';

export interface SessionRowState {
  isStalled: boolean;
  isUnread: boolean;
  isWorking: boolean;
  needsInput: boolean;
}

export function sessionDotState({
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

  return isUnread ? 'unread' : 'idle';
}

/** 安静轮仍在权威运行：只有阻塞式 prompt（needsInput）才抑制行 arc（对齐 Hermes） */
export function sessionShowsRunningArc({
  isWorking,
  needsInput,
}: Pick<SessionRowState, 'isWorking' | 'needsInput'>): boolean {
  return isWorking && !needsInput;
}
