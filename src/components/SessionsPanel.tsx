/**
 * 会话面板 — Apple 风格会话列表
 *
 * 对齐 Eleve session-actions-menu.tsx:
 *   - 右键菜单: 重命名/置顶/归档/导出/复制ID/删除
 *   - 置顶会话排序顶部
 *   - 归档会话折叠底部
 *   - 分页加载
 *
 * Props:
 *   sessionId, onSwitchSession, onDeleteSession, sessionTitles,
 *   connectionStatus, isStreaming, gatewayOnline,
 *   gatewayChecking, onGatewayRetry, onAbort
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';
import { deleteSession, searchSessions } from '../utils/api';
import { call } from '../utils/bridge';
import * as storage from '../utils/storage';
import { notifyError, notifySuccess, notifyInfo } from '../utils/notifications';
import {
  CheckSquare, Square, Trash2, Download, Pin, PinOff,
  Archive, ArchiveRestore, Edit3, Copy, MoreHorizontal,
  List, MessageSquare
} from 'lucide-react';
import { DeleteIcon, DotIcon } from './Icons';
import OutlinePanel from './OutlinePanel';
interface Session {
  id: string;
  title?: string;
  preview?: string;
  last_active?: number;
  started_at?: number;
}

interface SessionsPanelProps {
  sessionId?: string;
  sessions?: Session[];
  onSwitchSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  sessionTitles?: Record<string, string>;
  connectionStatus?: string;
  isStreaming?: boolean;
  gatewayOnline?: boolean;
  gatewayChecking?: boolean;
  onGatewayRetry?: () => void;
  onAbort?: () => void;
  sessionListVersion?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

interface ContextMenuItem {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface CtxMenuState {
  x: number;
  y: number;
  sessionId: string;
  title: string;
}

interface RenameTarget {
  id: string;
  title: string;
}

// ── 持久化键 ──
const PINNED_KEY = 'eleve.pinned-sessions';
const ARCHIVED_KEY = 'eleve.archived-sessions';

// ── 系统会话来源（对齐后端 exclude_sources + Eleve _HIDDEN_SESSION_SOURCES）──
const HIDDEN_SOURCES = new Set(['tool', 'cron', 'api']);

// ── 虚拟列表行类型 ──
type VirtualRow =
  | { kind: 'header'; label: string; icon?: React.ReactNode }
  | { kind: 'session'; session: any; section: 'p' | 'a' | '' }
  | { kind: 'archive-toggle'; count: number }

const ESTIMATED_ROW_HEIGHT = 44;

// ── 持久化 helpers ──
function loadSet(key: string): Set<string> {
  try { const v: unknown = storage.load(key); return new Set(v ? JSON.parse(v as string) : []); }
  catch { return new Set(); }
}
function saveSet(key: string, set: Set<string>) {
  try { storage.save(key, JSON.stringify([...set])); } catch { /* ignore */ }
}

/** 格式化会话时间 — 对齐 Eleve timeAgo */
function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '';
  const now = Date.now();
  const then = new Date(ts * 1000);
  const diffMs = now - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}小时前`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}天前`;
  const sameYear = then.getFullYear() === new Date().getFullYear();
  const mm = then.getMonth() + 1;
  const dd = then.getDate();
  if (sameYear) return `${mm}月${dd}日`;
  return `${then.getFullYear()}年${mm}月${dd}日`;
}

// ── 右键菜单组件 ──
function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - items.length * 36 - 20),
    zIndex: 10000,
    minWidth: 180,
  };

  return (
    <div ref={menuRef} className="min-w-[180px] py-1 bg-popover border border-border rounded-md shadow-lg z-[10000]" style={style}>
      {items.map((item, i) =>
        item === ('---' as any) ? (
          <div key={i} className="h-px bg-border mx-2 my-1" />
        ) : (
          <button
            key={i}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-popover-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
              (item as ContextMenuItem).danger && 'text-destructive hover:text-destructive-foreground hover:bg-destructive/10',
              (item as ContextMenuItem).disabled && 'opacity-40 pointer-events-none'
            )}
            onClick={() => { if (!(item as ContextMenuItem).disabled) { (item as ContextMenuItem).onSelect(); onClose(); } }}
            disabled={(item as ContextMenuItem).disabled}
          >
            {(item as ContextMenuItem).icon && <span className="w-4 flex items-center justify-center">{(item as ContextMenuItem).icon}</span>}
            <span className="flex-1">{(item as ContextMenuItem).label}</span>
            {(item as ContextMenuItem).shortcut && <span className="text-[10px] text-muted-foreground/60 ml-4">{(item as ContextMenuItem).shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}

// ── 重命名对话框 ──
function RenameDialog({ currentTitle, onConfirm, onCancel }: { currentTitle: string; onConfirm: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) onConfirm(title.trim());
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/40" onClick={onCancel}>
      <div className="bg-popover text-popover-foreground rounded-lg shadow-lg p-4 min-w-[280px]" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="text-sm font-medium text-foreground mb-3">重命名会话</div>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="w-full px-2.5 py-1.5 text-sm bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            type="text"
            value={title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="输入新名称…"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={onCancel}>取消</button>
            <button type="submit" className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50" disabled={!title.trim()}>确认</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SessionsPanel({
  sessionId,
  sessions = [],
  onSwitchSession,
  onDeleteSession,
  sessionTitles,
  connectionStatus,
  isStreaming,
  gatewayOnline,
  gatewayChecking,
  onGatewayRetry,
  onAbort,
}: SessionsPanelProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'sessions' | 'outline'>('sessions');
  const [searchResults, setSearchResults] = useState<Session[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── 置顶/归档状态 ──
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadSet(PINNED_KEY));
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => loadSet(ARCHIVED_KEY));
  const [showArchived, setShowArchived] = useState(false);

  // ── 右键菜单 ──
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);

  // ── 虚拟列表（替代分页）──

  // 持久化置顶/归档
  useEffect(() => { saveSet(PINNED_KEY, pinnedIds); }, [pinnedIds]);
  useEffect(() => { saveSet(ARCHIVED_KEY, archivedIds); }, [archivedIds]);

  // ── 后端搜索（防抖）──
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await searchSessions(q);
        const results = data?.results || [];
        setSearchResults(results
          .filter((r: any) => {
            const src = r.source as string | undefined;
            return !src || !HIDDEN_SOURCES.has(src);
          })
          .map((r: any) => ({
            id: r.id,
            title: r.title,
            preview: r.preview,
            last_active: r.last_active,
          started_at: r.started_at,
        })));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const handleSwitch = (s: Session) => {
    const id = s.id || s as any;
    if (id === sessionId) return;
    onSwitchSession?.(id);
  };

  const handleDelete = async (s: Session) => {
    const id = s.id || s as any;
    try {
      await deleteSession(id);
      onDeleteSession?.(id);
    } catch { /* ignore */ }
  };

  // ── 置顶 ──
  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── 归档 ──
  const toggleArchive = useCallback(async (id: string) => {
    const isArchived = archivedIds.has(id);
    try {
      if (isArchived) {
        await call('unarchive_session', { session_id: id });
      } else {
        await call('archive_session', { session_id: id });
      }
      setArchivedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      notifySuccess(isArchived ? '已取消归档' : '已归档');
    } catch {
      setArchivedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      notifyInfo(isArchived ? '已取消归档（本地）' : '已归档（本地）');
    }
  }, [archivedIds]);

  // ── 重命名 ──
  const handleRename = useCallback(async (id: string, newTitle: string) => {
    try {
      await call('rename_session', { session_id: id, title: newTitle });
      notifySuccess('已重命名');
    } catch {
      notifyInfo('重命名已保存（本地）');
    }
    if (sessionTitles) {
      sessionTitles[id] = newTitle;
    }
    setRenameTarget(null);
  }, [sessionTitles]);

  // ── 导出 ──
  const handleExport = useCallback(async (id: string, title: string) => {
    try {
      const data = await call('export_session', { session_id: id });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title || id).replace(/[^a-zA-Z0-9\u4e00-\u9fff-_ ]/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notifySuccess('已导出会话');
    } catch (err: unknown) {
      notifyError((err as Error).message || err, '导出失败');
    }
  }, []);

  // ── 复制 ID ──
  const handleCopyId = useCallback((id: string) => {
    navigator.clipboard.writeText(id).then(
      () => notifySuccess('已复制 ID'),
      () => notifyError('复制失败', '无法复制')
    );
  }, []);

  // ── 右键菜单 ──
  const handleContextMenu = useCallback((e: React.MouseEvent, id: string, title: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, sessionId: id, title });
  }, []);

  // ── Batch operations ──
  const toggleBatchMode = () => {
    setBatchMode(prev => !prev);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(activeSessions.map(s => s.id || s as any)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确认删除 ${selectedIds.size} 个会话？此操作不可撤销。`)) return;
    for (const id of selectedIds) {
      try { await deleteSession(id); onDeleteSession?.(id); } catch { /* ignore */ }
    }
    setSelectedIds(new Set());
    setBatchMode(false);
  };

  const handleBatchExport = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).join('\n');
    navigator.clipboard.writeText(ids).catch(() => {});
  };

  // ── 系统会话 fallback 过滤（后端已排除，前端兜底防止漏网）──
  const visibleSessions = useMemo(() =>
    sessions.filter((s) => {
      const src = (s as any).source as string | undefined;
      return !src || !HIDDEN_SOURCES.has(src);
    }),
    [sessions]
  );

  // ── 搜索过滤（后端优先，fallback 到前端过滤）──
  const allFiltered = searchResults !== null
    ? searchResults
    : search.trim()
      ? visibleSessions.filter((s) => {
          const id = s.id || s as any;
          const title = (typeof s === 'object' ? s.title : sessionTitles?.[id]) || '';
          const preview = typeof s === 'object' ? s.preview : '';
          const q = search.toLowerCase();
          return title.toLowerCase().includes(q) || (preview && preview.toLowerCase().includes(q)) || id.toLowerCase().includes(q);
        })
      : visibleSessions;

  // 分区：置顶 / 普通 / 归档
  const pinnedSessions = allFiltered.filter((s) => pinnedIds.has(s.id || s as any) && !archivedIds.has(s.id || s as any));
  const activeSessions = allFiltered.filter((s) => !pinnedIds.has(s.id || s as any) && !archivedIds.has(s.id || s as any));
  const archivedSessions = allFiltered.filter((s) => archivedIds.has(s.id || s as any));

  // 构建扁平虚拟列表行
  const virtualRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = [];
    if (pinnedSessions.length > 0) {
      rows.push({ kind: 'header', label: '置顶' });
      pinnedSessions.forEach(s => rows.push({ kind: 'session', session: s, section: 'p' }));
    }
    activeSessions.forEach(s => rows.push({ kind: 'session', session: s, section: '' }));
    if (archivedSessions.length > 0) {
      rows.push({ kind: 'archive-toggle', count: archivedSessions.length });
      if (showArchived) {
        archivedSessions.forEach(s => rows.push({ kind: 'session', session: s, section: 'a' }));
      }
    }
    return rows;
  }, [pinnedSessions, activeSessions, archivedSessions, showArchived]);

  // 虚拟化
  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => {
      const row = virtualRows[i];
      if (!row) return ESTIMATED_ROW_HEIGHT;
      return row.kind === 'header' ? 28 : row.kind === 'archive-toggle' ? 36 : ESTIMATED_ROW_HEIGHT;
    },
    overscan: 8,
  });

  // ── 渲染会话项 ──
  const renderSession = (s: Session, extra?: string) => {
    const id = s.id || s as any;
    const title = (typeof s === 'object' ? s.title : sessionTitles?.[id]) || id?.slice(0, 8) || '—';
    const preview = typeof s === 'object' ? s.preview : null;
    const isCurrent = id === sessionId;
    const timeStr = fmtTime(s.last_active || s.started_at);
    const isChecked = selectedIds.has(id);
    const isPinned = pinnedIds.has(id);

    return (
      <div
        key={id + (extra || '')}
        className={cn(
          'group relative flex items-start gap-1.5 px-3 py-2 cursor-pointer border-l-2 border-transparent hover:bg-accent/30 transition-colors',
          isCurrent && 'bg-accent/40 border-l-primary',
          batchMode && 'pl-2',
          isChecked && 'bg-accent/20',
        )}
        onClick={() => batchMode ? toggleSelection(id) : handleSwitch(s)}
        onContextMenu={(e: React.MouseEvent) => handleContextMenu(e, id, title)}
      >
        {isCurrent && isStreaming && <div className="arc-border" />}
        {batchMode && (
          <span
            className="mt-0.5 shrink-0 text-muted-foreground cursor-pointer"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggleSelection(id); }}
          >
            {isChecked ? <CheckSquare size={16} /> : <Square size={16} />}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isPinned && <Pin size={10} className="shrink-0 text-primary" />}
            <span className="text-sm truncate text-foreground flex-1" title={title}>{title}</span>
            {timeStr && <span className="text-[10px] text-muted-foreground/60 shrink-0">{timeStr}</span>}
            {isCurrent && <span className="shrink-0 text-primary"><DotIcon /></span>}
          </div>
          {preview && <div className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{preview}</div>}
        </div>
        {!batchMode && (
          <button
            className="shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-all"
            title="更多操作"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleContextMenu(e, id, title); }}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── 顶部Tab切换 ── */}
      <div className="flex items-center border-b border-border shrink-0">
        <button
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2',
            activeTab === 'sessions'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          )}
          onClick={() => setActiveTab('sessions')}
        >
          <MessageSquare size={14} />
          会话
        </button>
        <button
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2',
            activeTab === 'outline'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          )}
          onClick={() => setActiveTab('outline')}
        >
          <List size={14} />
          大纲
        </button>
      </div>

      {/* ── 会话列表 ── */}
      {activeTab === 'sessions' && (
      <div className="flex flex-col min-h-0 flex-1">
        {/* 搜索 + 批量操作 */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
          <input
            className="flex-1 px-2 py-1 text-xs bg-background border border-input rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
            type="text"
            placeholder={searchLoading ? '搜索中…' : '搜索会话…'}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
          <button
            className={cn('p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors', batchMode && 'bg-accent text-accent-foreground')}
            title="批量操作"
            onClick={toggleBatchMode}
          >
            {batchMode ? <Square size={14} /> : <CheckSquare size={14} />}
          </button>
        </div>

        {/* 全选/取消栏 — 批量模式 */}
        {batchMode && (
          <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/20 shrink-0">
            <span className="text-[11px] text-muted-foreground/70">
              {selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : '选择会话'}
            </span>
            <button className="text-[11px] text-primary hover:underline" onClick={selectAll}>全选</button>
            <button className="text-[11px] text-primary hover:underline" onClick={deselectAll}>取消全选</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto" ref={listRef}>
        {sessions === null ? (
          <div className="px-3 py-2 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="skeleton-row w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-1">
            <span className="text-sm">{search ? '无匹配会话' : '暂无会话'}</span>
            <span className="text-xs text-muted-foreground/60">{search ? '试试其他关键词' : '发送第一条消息后自动创建'}</span>
          </div>
        ) : allFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-1">
            <span className="text-sm">无匹配会话</span>
            <span className="text-xs text-muted-foreground/60">试试其他关键词</span>
          </div>
        ) : (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map(vItem => {
              const row = virtualRows[vItem.index];
              if (!row) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {row.kind === 'header' && (
                    <div className="flex items-center gap-1 px-3 py-1 text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                      {row.label === '置顶' && <Pin size={10} />}
                      {row.label}
                    </div>
                  )}
                  {row.kind === 'session' && renderSession(row.session, row.section)}
                  {row.kind === 'archive-toggle' && (
                    <div className="border-t border-border/50 mt-1">
                      <button
                        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-muted-foreground/70 hover:text-foreground hover:bg-accent/20 transition-colors"
                        onClick={() => setShowArchived((v) => !v)}
                      >
                        <Archive size={12} />
                        已归档 ({row.count})
                        <span className="ml-auto text-[10px]">{showArchived ? '▲' : '▼'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
      )}

      {/* 批量操作栏 */}
      {batchMode && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-muted/20 shrink-0">
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded transition-colors disabled:opacity-40"
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
          >
            <Trash2 size={14} />
            <span>删除 ({selectedIds.size})</span>
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:bg-accent rounded transition-colors disabled:opacity-40"
            onClick={handleBatchExport}
            disabled={selectedIds.size === 0}
          >
            <Download size={14} />
            <span>导出</span>
          </button>
        </div>
      )}

      {/* ── 消息大纲 ── */}
      {activeTab === 'outline' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <OutlinePanel embedded />
        </div>
      )}

      {/* 右键菜单 */}
      {ctxMenu && createPortal(
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            { icon: <Edit3 size={14} />, label: '重命名', shortcut: 'F2', onSelect: () => setRenameTarget({ id: ctxMenu.sessionId, title: ctxMenu.title }) },
            { icon: pinnedIds.has(ctxMenu.sessionId) ? <PinOff size={14} /> : <Pin size={14} />, label: pinnedIds.has(ctxMenu.sessionId) ? '取消置顶' : '置顶', onSelect: () => togglePin(ctxMenu.sessionId) },
            { icon: archivedIds.has(ctxMenu.sessionId) ? <ArchiveRestore size={14} /> : <Archive size={14} />, label: archivedIds.has(ctxMenu.sessionId) ? '取消归档' : '归档', onSelect: () => toggleArchive(ctxMenu.sessionId) },
            '---' as any,
            { icon: <Download size={14} />, label: '导出', onSelect: () => handleExport(ctxMenu.sessionId, ctxMenu.title) },
            { icon: <Copy size={14} />, label: '复制 ID', onSelect: () => handleCopyId(ctxMenu.sessionId) },
            '---' as any,
            { icon: <Trash2 size={14} />, label: '删除', danger: true, onSelect: () => handleDelete({ id: ctxMenu.sessionId } as Session) },
          ]}
          onClose={() => setCtxMenu(null)}
        />,
        document.body
      )}

      {/* 重命名对话框 */}
      {renameTarget && createPortal(
        <RenameDialog
          currentTitle={renameTarget.title}
          onConfirm={(title) => handleRename(renameTarget.id, title)}
          onCancel={() => setRenameTarget(null)}
        />,
        document.body
      )}
    </div>
  );
}
