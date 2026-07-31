/**
 * interpretSlashResult — slash 命令结果解释（单一权威源）
 *
 * 单视图 usePromptActions.handleCommand 和宫格 useGridChat.execCommand
 * 共用此纯函数解释 slash.exec RPC 的返回值，各自执行副作用。
 *
 * 消灭双份逻辑分叉：结果类型解释口径统一，副作用容器各管各。
 */

export interface SlashExecResult {
  type?: string;
  output?: string;
  message?: string;
  session_id?: string;
  confirm_id?: string;
  command?: string;
  description?: string;
}

export type SlashResultAction =
  | { kind: 'confirm'; confirmId: string; command: string; description: string }
  | { kind: 'send'; output?: string; kickoff: string }
  | { kind: 'rotate'; output: string; newSessionId: string }
  | { kind: 'output'; output: string };

/**
 * 解释 slash.exec RPC 返回值 → 结构化动作（纯函数，零副作用）
 *
 * @param result - slash.exec RPC 返回值
 * @param currentSessionId - 当前会话 ID（用于判断 session 轮换）
 */
export function interpretSlashResult(
  result: SlashExecResult | undefined | null,
  currentSessionId: string | null | undefined,
): SlashResultAction {
  // D1: 破坏性命令二次确认
  if (result?.type === 'pending_confirm' && result.confirm_id) {
    return {
      kind: 'confirm',
      confirmId: result.confirm_id,
      command: result.command || '',
      description: result.description || '',
    };
  }

  // CmdAction::Send — 确认文本 + 自动提交 kickoff（/goal set 等）
  if (result?.type === 'send' && result.message) {
    return { kind: 'send', output: result.output, kickoff: result.message };
  }

  const output = result?.output || '';

  // Session 轮换（/new 后端路径等）
  if (result?.session_id && result.session_id !== currentSessionId) {
    return { kind: 'rotate', output, newSessionId: result.session_id };
  }

  // 普通输出
  return { kind: 'output', output };
}
