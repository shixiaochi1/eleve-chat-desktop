/**
 * worktree 视觉 lane 合并（对齐 Hermes workspace-groups.ts mergeRepoWorktreeGroups）
 *
 * 项目钻取视图：git.worktree_list 结果与后端 lane（projects.project_sessions）合并——
 * 1. linked worktree lane relabel 成 live branch / 路径修复（git truth 优先）
 * 2. 注入空视觉 lane：git 里有 worktree 但无会话 → 也显示（点击可进该目录开发）
 * 3. kanban task worktree（<repo>/.worktrees/t_*）不散列（折叠进 ::kanban lane）
 * 4. 按 id/path/label 去重
 *
 * 注意：主 checkout 不折叠 home lane（保持 ELEVE 后端 lane 结构，不改变现有行为）；
 * 注入只针对 linked worktree。
 */
import type { HermesGitWorktree } from './git';

/** 路径归一（去尾分隔符 + 正斜杠）——比较键用 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 路径最后一段 */
function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] ?? '';
}

/** `.worktrees/t_<hex>` task worktree 判定（对齐 Hermes kanbanWorktreeDir） */
const KANBAN_DIR_RE = /^(.*[/\\]\.worktrees)[/\\]t_[0-9a-f]+[/\\]?$/;

export function kanbanWorktreeDir(path: string): string | null {
  const m = path.match(KANBAN_DIR_RE);
  return m ? m[1] : null;
}

export interface WorktreeLane<S = { id: string }> {
  id: string;
  label: string;
  path: string;
  isMain: boolean;
  isKanban: boolean;
  sessions: S[];
}

export function mergeWorktreeLanes<S = { id: string }>(
  groups: WorktreeLane<S>[],
  worktrees: HermesGitWorktree[],
  dismissedPaths?: ReadonlySet<string>,
): WorktreeLane<S>[] {
  if (!worktrees.length) return groups;

  // git truth 映射：path → live branch / branch → 唯一 worktree path
  const liveBranchByPath = new Map<string, string>();
  const livePathByBranch = new Map<string, string>();
  for (const wt of worktrees) {
    const wtPath = normalizePath(wt.path);
    const branch = wt.branch?.trim();
    if (wtPath && branch && !wt.detached) {
      liveBranchByPath.set(wtPath, branch);
      livePathByBranch.set(branch.toLowerCase(), wt.path.trim());
    }
  }

  // 1. 修复 linked worktree lane（label 用 live branch；路径漂移重新锚定）
  const reconciled = groups.map(g => {
    if (g.isMain || g.isKanban || !g.path) return g;
    const branchForPath = liveBranchByPath.get(normalizePath(g.path));
    if (branchForPath && branchForPath !== g.label) return { ...g, label: branchForPath };
    const livePath = livePathByBranch.get(g.label.toLowerCase());
    if (livePath && normalizePath(livePath) !== normalizePath(g.path)) {
      return { ...g, id: livePath, path: livePath };
    }
    return g;
  });

  const seenIds = new Set(reconciled.map(g => g.id));
  const seenPaths = new Set(reconciled.filter(g => g.path).map(g => normalizePath(g.path)));
  const seenLabels = new Set(reconciled.map(g => g.label.toLowerCase()));
  const merged = [...reconciled];

  // 2. 注入空视觉 lane（有 worktree 无会话；dismissed 跳过；kanban 排除；去重）
  for (const wt of worktrees) {
    const wtPath = wt.path?.trim();
    if (!wtPath || wt.isMain) continue;
    if (kanbanWorktreeDir(wtPath)) continue;
    if (dismissedPaths?.has(wtPath)) continue;

    const label = wt.branch?.trim() || baseName(wtPath) || wtPath;
    const id = wtPath;
    if (seenIds.has(id) || seenLabels.has(label.toLowerCase()) || seenPaths.has(normalizePath(wtPath))) {
      continue;
    }
    merged.push({ id, label, path: wtPath, isMain: false, isKanban: false, sessions: [] as S[] });
    seenIds.add(id);
    seenPaths.add(normalizePath(wtPath));
    seenLabels.add(label.toLowerCase());
  }

  return merged;
}
