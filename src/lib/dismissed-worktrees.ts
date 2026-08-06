/**
 * worktree lane「仅从侧边栏隐藏」（dismiss）— 对齐 Hermes $dismissedWorktreeIds
 * (store/layout.ts persistentAtom)。
 *
 * 语义：只隐藏注入的空视觉 lane（git worktree list 里有、后端无会话的）；
 * 后端有会话的 lane 不受影响（git 命中 wins，对齐 Hermes：git 说存在就 surface）。
 * 不删 git worktree（删除走 git.worktree_remove）。
 */

const KEY = 'eleve.dismissedWorktrees.v1';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 存储不可用 → 静默降级（本次会话内存态仍生效）
  }
}

/** 已隐藏的 worktree path 集合 */
export function getDismissedWorktrees(): Set<string> {
  return new Set(read());
}

/** 隐藏一个 worktree lane（幂等；不删 git worktree） */
export function dismissWorktree(path: string): void {
  const ids = read();
  if (!ids.includes(path)) {
    write([...ids, path]);
  }
}
