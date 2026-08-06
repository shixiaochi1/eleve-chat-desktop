/**
 * git worktree/branch RPC 封装（对齐 Hermes desktop-git.ts 的 worktree/branch 面）：
 * 全部走后端 eleved WS RPC（git.*），后端是 git 唯一执行点（与文件操作同层）。
 */

import { call } from '../utils/bridge';

// ── 类型（对齐 Hermes global.d.ts）──

export interface HermesGitWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
  detached: boolean;
  locked: boolean;
}

export interface HermesGitBranch {
  name: string;
  checkedOut: boolean;
  isDefault: boolean;
  worktreePath: string | null;
}

export interface HermesGitBaseBranch {
  name: string;
  isRemote: boolean;
  isDefault: boolean;
}

// ── RPC ──

/** 真实 worktree 列表（git 唯一事实源） */
export async function gitWorktreeList(path: string): Promise<HermesGitWorktree[]> {
  const res = await call('git_worktree_list', { path });
  return ((res as { worktrees?: HermesGitWorktree[] })?.worktrees) ?? [];
}

/** 新建/convert worktree → { path, branch } */
export async function gitWorktreeAdd(
  path: string,
  opts: { name?: string; branch?: string; base?: string; existingBranch?: string },
): Promise<{ path: string; branch: string }> {
  const res = await call('git_worktree_add', { path, ...opts });
  return res as { path: string; branch: string };
}

/** 移除 worktree → { removed } */
export async function gitWorktreeRemove(path: string, worktreePath: string, force = false): Promise<{ removed: string }> {
  return (await call('git_worktree_remove', { path, worktree_path: worktreePath, force })) as { removed: string };
}

/** 本地分支（convert picker；checkedOut/isDefault/worktreePath） */
export async function gitBranchList(path: string): Promise<HermesGitBranch[]> {
  const res = await call('git_branch_list', { path });
  return ((res as { branches?: HermesGitBranch[] })?.branches) ?? [];
}

/** 基线分支（本地 + 远端跟踪；isDefault = origin/HEAD 或本地 trunk） */
export async function gitBaseBranchList(path: string): Promise<HermesGitBaseBranch[]> {
  const res = await call('git_base_branch_list', { path });
  return ((res as { branches?: HermesGitBaseBranch[] })?.branches) ?? [];
}

/** 切换主 checkout 分支 */
export async function gitBranchSwitch(path: string, branch: string): Promise<{ branch: string }> {
  return (await call('git_branch_switch', { path, branch })) as { branch: string };
}
