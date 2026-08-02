/**
 * MemoryPanel — 记忆数据区块（对齐 Hermes 桌面端「记忆数据」语义）
 *
 * 定位：嵌入「设置 > 记忆」页顶部的记忆内容总览（原侧边栏记忆面板已合并至此）。
 * 与 EditAgentDialog 的分工：本组件 = 当前 Agent 记忆的快速总览（用量/搜索/删除/重置）；
 * EditAgentDialog 记忆 Tab = 指定 Agent 的 MEMORY.md 原文深度编辑。
 *
 * 设计基线（Hermes command-center/maintenance 记忆区）：
 *   - 标题「记忆数据」+ 副标「注入每个会话的内置记忆文件」+ 当前提供方
 *   - 两个目标文件卡：MEMORY.md（智能体记忆）/ USER.md（用户画像）
 *   - 每卡：字符用量（used/limit）+ 用量条 + 重置按钮（对齐 Hermes resetMemory）
 *
 * ELEVE 扩展（Hermes 无，保留价值）：条目浏览 + 搜索 + 逐条删除。
 * 作用域：per-profile（对齐 Hermes per-agent），无会话也能查看。
 *
 * 布局：作为设置页内嵌区块（随设置页滚动，不自持滚动容器），双卡响应式横排。
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import useMemory, { type MemoryEntry } from '../hooks/useMemory';
import {
  SearchIcon, TrashIcon, UserIcon, BookOpenIcon,
  DeleteIcon, RegenerateIcon,
} from './Icons';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';

interface MemoryPanelProps {
  currentProfile?: string;
}

const TARGETS = [
  {
    key: 'memory' as const,
    file: 'MEMORY.md',
    label: '智能体记忆',
    Icon: BookOpenIcon,
    barClass: 'bg-accent-purple/70',
    iconClass: 'text-accent-purple',
  },
  {
    key: 'user' as const,
    file: 'USER.md',
    label: '用户画像',
    Icon: UserIcon,
    barClass: 'bg-info/70',
    iconClass: 'text-info',
  },
];

export default function MemoryPanel({ currentProfile }: MemoryPanelProps) {
  const { memories, limits, active, loading, error, refresh, deleteEntry, resetTarget } = useMemory(currentProfile);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // 重置确认 3s 自动取消（防误触常驻）
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(null), 3000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return memories;
    const q = searchQuery.toLowerCase();
    return memories.filter((m) => (m.content || '').toLowerCase().includes(q));
  }, [memories, searchQuery]);

  const grouped = useMemo(() => {
    const g: Record<string, MemoryEntry[]> = { memory: [], user: [] };
    filtered.forEach((m) => {
      (g[m.target] ?? (g[m.target] = [])).push(m);
    });
    return g;
  }, [filtered]);

  // 字符用量（基于全量条目，不受搜索过滤影响）
  const usage = useMemo(() => {
    const u: Record<string, number> = { memory: 0, user: 0 };
    memories.forEach((m) => {
      u[m.target] = (u[m.target] ?? 0) + (m.char_count ?? (m.content?.length ?? 0));
    });
    return u;
  }, [memories]);

  const handleDelete = useCallback(async (entry: MemoryEntry) => {
    setDeletingIds((prev) => ({ ...prev, [entry.id]: true }));
    await deleteEntry(entry);
    setDeletingIds((prev) => ({ ...prev, [entry.id]: false }));
  }, [deleteEntry]);

  // 两步重置：首次点击 → 进入确认态；确认态再点击 → 执行
  const handleResetClick = useCallback((target: string) => {
    if (confirmReset === target) {
      setResetting(true);
      void resetTarget(target as 'memory' | 'user').finally(() => {
        setResetting(false);
        setConfirmReset(null);
      });
    } else {
      setConfirmReset(target);
    }
  }, [confirmReset, resetTarget]);

  return (
    <div>
      {/* 头部 — 对齐 Hermes「记忆数据」 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">记忆数据</div>
          <div className="text-[11px] text-muted-foreground/70 leading-relaxed mt-0.5">
            注入每个会话的内置记忆文件
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-[10px] text-muted-foreground whitespace-nowrap">
            当前提供方：{active || '内置'}
          </span>
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
            onClick={refresh}
            disabled={loading}
            title="刷新"
          >
            <RegenerateIcon size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="relative mb-3 max-w-xs">
        <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          className="w-full h-7 pl-7 pr-6 text-xs bg-muted/50 rounded border border-border focus:border-primary focus:outline-none placeholder:text-muted-foreground/50"
          type="text"
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
        />
        {searchQuery && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSearchQuery('')}
            title="清除"
          >
            <DeleteIcon size={12} />
          </button>
        )}
      </div>

      {/* 错误 */}
      {error && (
        <div className="mb-3 px-2 py-1.5 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">
          {error}
        </div>
      )}

      {/* 双目标卡片 — 响应式横排 */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="skeleton-list-item w-full h-16" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {TARGETS.map((t) => {
            const entries = grouped[t.key] ?? [];
            const used = usage[t.key] ?? 0;
            const limit = limits[t.key] ?? 0;
            const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
            const isConfirming = confirmReset === t.key;
            const TargetIcon = t.Icon;
            return (
              <section key={t.key} className="rounded-lg border border-border bg-card/40 overflow-hidden self-start">
                {/* 卡片头：标签 + 重置 */}
                <div className="px-2.5 pt-2 pb-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <TargetIcon size={13} className={cn('shrink-0', t.iconClass)} />
                      <span className="text-xs font-medium text-foreground truncate">{t.label}</span>
                    </div>
                    <button
                      className={cn(
                        'shrink-0 px-1.5 py-0.5 rounded text-[10px] transition-colors disabled:opacity-40',
                        isConfirming
                          ? 'bg-destructive text-destructive-foreground'
                          : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                      )}
                      disabled={resetting || (used === 0 && !isConfirming)}
                      onClick={() => handleResetClick(t.key)}
                      title={isConfirming ? '再次点击确认重置' : `重置 ${t.file}`}
                    >
                      {resetting && isConfirming ? '重置中…' : isConfirming ? '确认?' : '重置'}
                    </button>
                  </div>
                  {/* 文件名 + 字符用量 */}
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground/70">
                    <span className="font-mono">{t.file}</span>
                    <span>{used}/{limit} 字符</span>
                  </div>
                  {/* 用量条 */}
                  <div className="mt-1 h-1 rounded-full bg-muted/70 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-300', t.barClass)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* 条目列表 */}
                <div className="px-2 pb-2 space-y-1">
                  {entries.length === 0 ? (
                    <div className="py-3 text-center text-[10px] text-muted-foreground/50">
                      {searchQuery ? '无匹配记忆' : '暂无记忆'}
                    </div>
                  ) : (
                    entries.map((mem) => (
                      <div
                        key={mem.id}
                        className="group relative px-2 py-1.5 rounded border border-border/70 hover:bg-accent/5 transition-colors"
                      >
                        <div className="text-xs text-foreground/80 leading-relaxed line-clamp-3 pr-4">{mem.content}</div>
                        <button
                          className="absolute right-1 top-1 p-0.5 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0"
                          onClick={() => handleDelete(mem)}
                          disabled={deletingIds[mem.id]}
                          title="删除条目"
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
