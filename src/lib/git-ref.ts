/**
 * git ref 消毒工具（对齐 Hermes lib/sanitize.ts gitRef + electron/git-worktree-ops.ts
 * sanitizeBranch/slugify）。前端实时消毒 + 后端 rpc_git.rs 双保险。
 */

/** git-ref 安全的分支名（空格→"-"，去非法字符，收尾去分隔符）；空 → "" */
export function sanitizeBranch(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w./-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-./]+|[-./]+$/g, '');
}

/** worktree 目录 slug（小写 40 字符，兜底 'work'） */
export function slugify(name: string): string {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  return slug || 'work';
}
