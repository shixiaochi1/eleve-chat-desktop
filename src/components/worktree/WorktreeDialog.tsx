/**
 * WorktreeDialog — 新建/convert worktree 对话框（对齐 Hermes worktree-dialog.tsx）
 *
 * - 新建模式：分支名输入（提交时 git-ref 消毒）+ 基线分支选择（BaseBranchPicker）
 * - convert 模式：列出本地分支（git.branch_list），按状态分流：
 *   checkedOut → 打开已检出 worktree；isDefault → 切换主 checkout；否则创建 worktree
 * - 成功后 onStarted(path)：调用方在该路径新建会话（对齐 Hermes requestStartWorkSession）
 */
import { useCallback, useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { sanitizeBranch } from '../../lib/git-ref';
import { gitBranchList, gitBranchSwitch, gitWorktreeAdd, type HermesGitBranch } from '../../lib/git';
import { notifyError } from '../../utils/notifications';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { BaseBranchPicker } from './BaseBranchPicker';

/** 分支行动作文案（对齐 Hermes branchActionLabel） */
function branchActionLabel(branch: HermesGitBranch): string {
  if (branch.checkedOut) return '打开已检出';
  return branch.isDefault ? '切换主检出' : '创建 worktree';
}

export function WorktreeDialog({ repoPath, open, onOpenChange, onStarted, initialBase }: {
  /** Repo 根路径（git 操作对象） */
  repoPath: string;
  /** 成功回调：新/转换 worktree 路径（调用方打开新会话） */
  onStarted: (path: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 预选基线（"从 X 分支开新分支"入口） */
  initialBase?: string;
}) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [convertMode, setConvertMode] = useState(false);
  const [branches, setBranches] = useState<HermesGitBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBase, setSelectedBase] = useState('');

  // 每次打开重置（对齐 Hermes：fresh state + 应用 initialBase）
  useEffect(() => {
    if (open) {
      setName('');
      setConvertMode(false);
      setSelectedBase(initialBase ?? '');
    }
  }, [open, initialBase]);

  const loadBranches = useCallback(async () => {
    if (!repoPath) return;
    setBranchesLoading(true);
    try {
      setBranches(await gitBranchList(repoPath));
    } catch {
      setBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  }, [repoPath]);

  // ── 新建：worktree add -b（消毒后的分支名 + 基线）──
  const submit = useCallback(async () => {
    const branch = sanitizeBranch(name);
    if (pending || !repoPath || !branch) return;
    setPending(true);
    try {
      const result = await gitWorktreeAdd(repoPath, {
        name: branch,
        branch,
        base: selectedBase || undefined,
      });
      if (result) {
        onStarted(result.path);
        onOpenChange(false);
        setName('');
      }
    } catch (err) {
      notifyError(err, '创建工作区失败');
    } finally {
      setPending(false);
    }
  }, [pending, repoPath, name, selectedBase, onStarted, onOpenChange]);

  // ── convert：按分支状态分流 ──
  const convert = useCallback(async (branch: HermesGitBranch) => {
    if (pending || !repoPath || !branch) return;
    setPending(true);
    try {
      let result: { branch: string; path: string } | null = null;
      if (branch.checkedOut) {
        result = branch.worktreePath ? { branch: branch.name, path: branch.worktreePath } : null;
      } else if (branch.isDefault) {
        await gitBranchSwitch(repoPath, branch.name);
        result = { branch: branch.name, path: repoPath };
      } else {
        result = await gitWorktreeAdd(repoPath, { existingBranch: branch.name });
      }
      if (result) {
        onStarted(result.path);
        onOpenChange(false);
      }
    } catch (err) {
      notifyError(err, '创建工作区失败');
    } finally {
      setPending(false);
    }
  }, [pending, repoPath, onStarted, onOpenChange]);

  const enterConvert = useCallback(() => {
    setConvertMode(true);
    void loadBranches();
  }, [loadBranches]);

  return (
    <Dialog open={open} onOpenChange={next => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{convertMode ? '将分支检出到工作区' : '新建工作区（worktree）'}</DialogTitle>
          <DialogDescription>
            {convertMode
              ? '选择已有分支：已检出的直接打开，默认分支切主检出，其余创建独立工作区'
              : '在新分支上创建独立工作区（git worktree），互不干扰并行开发'}
          </DialogDescription>
        </DialogHeader>

        {convertMode ? (
          <Command className="rounded-md border border-[var(--ui-stroke-tertiary)]" filter={(v, search) => (v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
            <CommandInput autoFocus disabled={pending} placeholder="过滤分支…" />
            <CommandList className="max-h-64">
              <CommandEmpty>{branchesLoading ? '加载中…' : '无分支'}</CommandEmpty>
              <CommandGroup>
                {branches.map(branch => (
                  <CommandItem
                    key={branch.name}
                    disabled={pending}
                    onSelect={() => void convert(branch)}
                    value={branch.name}
                    className="text-xs"
                  >
                    <GitBranch size={12} className="shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{branch.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {branchActionLabel(branch)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <div className="flex flex-col gap-3">
            {/* 分支名（提交时消毒；对齐 Hermes SanitizedInput gitRef） */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">新分支名</label>
              <input
                autoFocus
                disabled={pending}
                className="desktop-input-chrome h-8 w-full rounded-md border px-2.5 text-sm outline-none"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); void submit(); }
                  else if (e.key === 'Escape') onOpenChange(false);
                }}
                placeholder="如：feature/coding-context"
              />
              {name.trim() && sanitizeBranch(name) !== name.trim() && (
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  将规范为：{sanitizeBranch(name)}
                </p>
              )}
            </div>
            <BaseBranchPicker
              disabled={pending}
              repoPath={repoPath}
              value={selectedBase}
              onValueChange={setSelectedBase}
            />
          </div>
        )}

        {convertMode ? (
          <DialogFooter className="sm:justify-start">
            <button
              className="px-0 text-xs text-muted-foreground hover:text-foreground"
              disabled={pending}
              onClick={() => setConvertMode(false)}
              type="button"
            >
              返回新建
            </button>
          </DialogFooter>
        ) : (
          <DialogFooter className="sm:justify-between">
            <button
              className="px-0 text-xs text-muted-foreground hover:text-foreground"
              disabled={pending}
              onClick={enterConvert}
              type="button"
            >
              检出已有分支…
            </button>
            <div className="flex items-center gap-2">
              <button
                className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent transition-colors"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                取消
              </button>
              <button
                className="h-8 rounded-md bg-foreground px-3 text-xs text-background hover:opacity-90 transition-opacity disabled:opacity-50"
                disabled={pending || !sanitizeBranch(name)}
                onClick={() => void submit()}
              >
                {pending ? '创建中…' : '开始工作'}
              </button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
