/**
 * workspace-cwd.ts — 远程工作目录记忆（对齐 Hermes workspaceCwdKey / getRememberedWorkspaceCwd）
 *
 * Hermes 语义：remote 模式按 `baseUrl+profile` 在 localStorage 记住上次工作目录，
 * 新会话（未显式指定目录）落在该目录。local 模式不记忆（ELEVE local 新会话
 * 由后端 resolve_session_cwd 决定——烙印/terminal.cwd/TERMINAL_CWD，与 Hermes
 * local DETACHED 语义一致）。
 *
 * ELEVE 实现：remote 模式下 sessionCwd 变化时持久化；sessionCreate 未传 cwd
 * 的入口（handleSend 首建 / AgentCard 新建）在 remote 模式下带 remembered。
 */
const REMOTE_PREFIX = 'eleve.workspace-cwd.remote';

export interface RemoteCwdContext {
  baseUrl: string;
  profile: string;
}

/** remote 记忆键：baseUrl + profile 隔离（对齐 Hermes workspaceCwdKey） */
export function remoteWorkspaceCwdKey(ctx: RemoteCwdContext): string {
  const base = encodeURIComponent(ctx.baseUrl || 'remote');
  const profile = encodeURIComponent(ctx.profile || 'default');
  return `${REMOTE_PREFIX}.${base}.${profile}`;
}

export function getRememberedWorkspaceCwd(ctx: RemoteCwdContext): string {
  try {
    return localStorage.getItem(remoteWorkspaceCwdKey(ctx))?.trim() || '';
  } catch {
    return '';
  }
}

export function rememberWorkspaceCwd(ctx: RemoteCwdContext, cwd: string): void {
  const trimmed = (cwd || '').trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(remoteWorkspaceCwdKey(ctx), trimmed);
  } catch {
    // 存储不可用 → 静默降级
  }
}
