/**
 * MemoryPanel — 记忆面板
 * Apple 风格，lucide 图标，适配 260px 面板
 * 显示代理的记忆条目，支持搜索和删除
 */
import { useState, useMemo, useCallback } from 'react';
import useMemory, { type MemoryEntry } from '../hooks/useMemory';
import {
  SearchIcon, TrashIcon, BrainIcon,
  UserIcon, BookOpenIcon, DeleteIcon,
  RegenerateIcon, LoadingIcon,
} from './Icons';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';

const TARGET_CONFIG: Record<string, { label: string; Icon: React.ComponentType<{ size?: number; className?: string }>; className: string }> = {
  user:   { label: '用户偏好', Icon: UserIcon as any,     className: 'bg-info/10 text-info' },
  memory: { label: '系统记忆', Icon: BookOpenIcon as any, className: 'bg-accent-purple/10 text-accent-purple' },
};

function formatTime(ts: string | undefined | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHour < 24) return `${diffHour}小时前`;
    if (diffDay < 7) return `${diffDay}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return ts;
  }
}

export default function MemoryPanel() {
  const { memories, loading, error, refresh, deleteEntry } = useMemory();
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});

  const filteredMemories = useMemo(() => {
    if (!searchQuery.trim()) return memories;
    const q = searchQuery.toLowerCase();
    return memories.filter(
      (m) =>
        (m.content || '').toLowerCase().includes(q) ||
        (m.target_name || '').toLowerCase().includes(q) ||
        (m.target || '').toLowerCase().includes(q)
    );
  }, [memories, searchQuery]);

  // Group by target type
  const grouped = useMemo(() => {
    const groups: Record<string, MemoryEntry[]> = {};
    filteredMemories.forEach((m) => {
      const key = m.target || 'memory';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    return groups;
  }, [filteredMemories]);

  const handleDelete = useCallback(async (entry: MemoryEntry) => {
    setDeletingIds((prev) => ({ ...prev, [entry.id]: true }));
    await deleteEntry(entry);
    setDeletingIds((prev) => ({ ...prev, [entry.id]: false }));
  }, [deleteEntry]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setSearchQuery('');
  }, []);

  return (
    <div className="flex flex-col h-full p-3">
      {/* Error */}
      {error && (
        <div className="flex items-center gap-1 px-2 py-1.5 mb-2 text-xs text-destructive bg-destructive/5 rounded border border-destructive/20">
          <span className="flex-1">{error}</span>
          <button className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors" title="关闭" onClick={() => {}}>
            <DeleteIcon size={12} />
          </button>
        </div>
      )}

      {/* Search bar */}
      <div className="relative mb-2">
        <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full h-7 pl-7 pr-6 text-xs bg-muted/50 rounded border border-border focus:border-accent focus:outline-none placeholder:text-muted-foreground/50"
          type="text"
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        {searchQuery && (
          <button className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors" onClick={() => setSearchQuery('')} title="清除">
            <DeleteIcon size={12} />
          </button>
        )}
      </div>

      {/* Refresh button */}
      <div className="flex items-center justify-between mb-2">
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={refresh} disabled={loading} title="刷新">
          <RegenerateIcon size={13} className={loading ? 'animate-spin' : ''} />
          <span>刷新</span>
        </button>
        <span className="text-[10px] text-muted-foreground/60">{filteredMemories.length} 条记忆</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <div className="px-1 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="skeleton-list-item w-full" />
            ))}
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
            <BrainIcon size={24} className="text-muted-foreground/30" />
            <span className="text-xs text-center">
              {searchQuery
                ? `未找到匹配"${searchQuery}"的记忆`
                : '暂无记忆数据'}
            </span>
            <span className="text-[10px] text-muted-foreground/50 text-center">
              {searchQuery
                ? '尝试其他关键词'
                : 'Agent 运行过程中会自动积累记忆'}
            </span>
          </div>
        ) : (
          Object.entries(grouped).map(([targetKey, entries]) => {
            const targetCfg = TARGET_CONFIG[targetKey] || {
              label: targetKey,
              Icon: BrainIcon,
              className: 'bg-muted text-muted-foreground',
            };
            const TargetIcon = targetCfg.Icon;
            return (
              <div key={targetKey} className="space-y-1">
                <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
                  <TargetIcon size={12} />
                  <span className="font-medium">{targetCfg.label}</span>
                  <span className="text-[10px] text-muted-foreground/50">{entries.length}</span>
                </div>
                {entries.map((mem) => (
                  <div key={mem.id} className="relative px-2 py-1.5 rounded border border-border hover:bg-accent/5 transition-colors group">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="flex items-center gap-1">
                        <span className={cn('px-1 py-0.5 text-[10px] rounded', targetCfg.className)}>
                          {mem.target_name || targetCfg.label}
                        </span>
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 shrink-0">
                        {formatTime(mem.created_at)}
                      </span>
                    </div>
                    <div className="text-xs text-foreground/80 leading-relaxed line-clamp-3">{mem.content}</div>
                    <div className="absolute right-1 bottom-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="删除"
                        disabled={deletingIds[mem.id]}
                        onClick={() => handleDelete(mem)}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
