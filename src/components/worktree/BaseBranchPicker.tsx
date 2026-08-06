/**
 * BaseBranchPicker — 新 worktree 的基线分支选择（对齐 Hermes base-branch-picker.tsx）
 *
 * 本地 + 远端跟踪分支（git.base_branch_list）；默认选中 origin/HEAD（有远端）
 * 或本地 trunk（main/master，无远端）。ELEVE 无 Popover 基础组件 → 用内联
 * 展开/收起 + Command 过滤列表（功能等价：过滤 + 选择 + 默认值）。
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, GitBranch, Globe } from 'lucide-react';
import { gitBaseBranchList, type HermesGitBaseBranch } from '../../lib/git';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { cn } from '@/lib/utils';

export function BaseBranchPicker({ repoPath, value, onValueChange, disabled }: {
  repoPath: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<HermesGitBaseBranch[]>([]);
  const [loading, setLoading] = useState(false);

  // 打开时加载 + 默认选中（对齐 Hermes load：isDefault 优先，无则首项）
  const load = useCallback(async () => {
    if (!repoPath) return;
    setLoading(true);
    try {
      const list = await gitBaseBranchList(repoPath);
      setBranches(list);
      const def = list.find(b => b.isDefault);
      if (def) onValueChange(def.name);
      else onValueChange(list[0]?.name ?? '');
    } catch {
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [repoPath, onValueChange]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">基线分支</label>
      <button
        type="button"
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-foreground transition-colors',
          'hover:bg-accent/50 disabled:opacity-50',
        )}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
      >
        <GitBranch size={12} className="shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 text-left">{value || '选择分支'}</span>
        <ChevronDown size={12} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <Command className="rounded-md border border-border">
          <CommandInput placeholder="过滤分支…" autoFocus />
          <CommandList className="max-h-44">
            <CommandEmpty>{loading ? '加载中…' : '无分支'}</CommandEmpty>
            <CommandGroup>
              {branches.map(b => (
                <CommandItem
                  key={b.name}
                  value={b.name}
                  onSelect={() => { onValueChange(b.name); setOpen(false); }}
                  className="text-xs"
                >
                  <GitBranch size={12} className="shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{b.name}</span>
                  {b.isRemote && <Globe size={11} className="shrink-0 text-muted-foreground/60" />}
                  {b.isDefault && <span className="shrink-0 text-[9px] rounded bg-primary/15 px-1 py-0.5 text-primary">默认</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </div>
  );
}
