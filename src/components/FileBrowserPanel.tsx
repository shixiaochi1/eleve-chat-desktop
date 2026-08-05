/**
 * FileBrowserPanel — 右侧文件浏览器面板
 *
 * 树状文件列表，支持展开/折叠目录、点击文件附加路径
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, ChevronsDownUp, RefreshCw, Loader, ArrowUp, FolderInput } from 'lucide-react';
import { useFileTree } from '../hooks/useFileTree';
import { useWorkspaceTick } from '../lib/workspace-events';
import { openPreview } from '@/store/preview';
import { cn } from '@/lib/utils';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { filesRename, filesDelete } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { isDesktop } from '@/utils/bridge';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[] | null;
}

/** 相对路径（复制相对路径用；root 归一正斜杠后前缀剥离） */
function relativeTo(root: string, p: string): string {
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normP = p.replace(/\\/g, '/');
  if (normRoot && normP.startsWith(normRoot + '/')) return normP.slice(normRoot.length + 1);
  return normP;
}

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  openState: Record<string, boolean>;
  onToggle: (dirPath: string) => Promise<void>;
  onFileClick: (entry: FileEntry) => void;
  onFileDoubleClick: (entry: FileEntry) => void;
  loadChildren: (dirPath: string) => Promise<FileEntry[]>;
  /** 非破坏刷新信号：workspace tick 递增 → 已展开目录重新加载（对齐 Hermes revalidateTree） */
  refreshNonce: number;
  /** 树根路径（复制相对路径的基准） */
  rootPath: string;
  /** 当前正在重命名的节点路径（null = 无） */
  renamingPath: string | null;
  onReveal: (path: string) => void;
  onCopyText: (text: string) => void;
  onRenameRequest: (path: string) => void;
  onRenameCommit: (path: string, newName: string) => void;
  onRenameCancel: () => void;
  onDeleteRequest: (entry: FileEntry) => void;
}

interface FileBrowserPanelProps {
  onFileAttach?: (path: string) => void;
  /** 当前会话工作目录 — 权威根目录来源（对齐 Hermes RightSidebarPane：
   *  文件树 = 会话 cwd）。手动切换目录/上级只是临时 override，
   *  会话切换（cwd 变化）→ 重新跟随。 */
  cwd?: string;
}

// 每层缩进（对齐 Hermes react-arborist INDENT=10）：16px/层在窄面板里
// 5-6 层后文件名就被挤出可视区，表现为"深层文件被裁掉显示不全"
const INDENT = 10;
// 深度封顶：超过该层数不再增加缩进，防极端深嵌套把行推出面板
const MAX_INDENT_DEPTH = 20;

/**
 * 原生目录选择（tauri-plugin-dialog；浏览器模式返回 null）
 * 与 ProjectTreePanel/SystemSettings 同款模式
 */
async function pickDirectory(title: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ directory: true, multiple: false, title });
    return Array.isArray(sel) ? (sel[0] ?? null) : sel;
  } catch (err) {
    console.error('[FileBrowserPanel] directory dialog failed:', err);
    return null;
  }
}

/**
 * 计算父目录路径；已是根（盘符根 / POSIX 根）返回 null
 * C:\Users\Admin → C:\Users；C:\ → null；/home/user → /home；/ → null
 */
function parentOf(path: string): string | null {
  const norm = path.replace(/[\\/]+$/, '');
  if (!norm) return null;
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  if (idx <= 0) return null;
  const parent = norm.slice(0, idx);
  if (!parent) return null;
  // Windows 盘符根：C: → C:\（保持可再次进入根目录）
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

/**
 * 文件树节点渲染
 */
function TreeNode({
  entry,
  depth,
  openState,
  onToggle,
  onFileClick,
  onFileDoubleClick,
  loadChildren,
  refreshNonce,
  rootPath,
  renamingPath,
  onReveal,
  onCopyText,
  onRenameRequest,
  onRenameCommit,
  onRenameCancel,
  onDeleteRequest,
}: TreeNodeProps) {
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const childrenLoadedRef = useRef(false);

  const isOpen = !!openState[entry.path];

  // 非破坏刷新：workspace 变化（Agent 写文件/保存）→ 已展开目录重新拉取
  // （缓存已被 invalidate 清空 → loadChildren 重新 fetch；未展开/未加载过的不动）
  useEffect(() => {
    if (!isOpen || !childrenLoadedRef.current) return;
    let cancelled = false;
    setLoadingChildren(true);
    loadChildren(entry.path)
      .then((result) => {
        if (!cancelled) setChildren(result);
      })
      .catch(() => { /* 静默 */ })
      .finally(() => {
        if (!cancelled) setLoadingChildren(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, entry.path, isOpen, loadChildren]);

  const handleToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await onToggle(entry.path);

    // 首次展开时加载子目录
    if (!isOpen && !childrenLoadedRef.current) {
      setLoadingChildren(true);
      try {
        const result = await loadChildren(entry.path);
        setChildren(result);
        childrenLoadedRef.current = true;
      } catch { /* 静默 */ }
      setLoadingChildren(false);
    }
  }, [entry.path, isOpen, onToggle, loadChildren]);

  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      handleToggle({ stopPropagation: () => {} } as React.MouseEvent);
    } else {
      onFileClick(entry);
    }
  }, [entry, handleToggle, onFileClick]);

  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT + 4;
  const isRenaming = renamingPath === entry.path;

  // 行内容（重命名中 → 输入框；对齐 Hermes InlineRenameInput：Enter 提交/Esc 取消/失焦提交）
  const row = (
    <div
      className={cn(
        'flex items-center gap-1 px-1 py-0.5 rounded text-xs cursor-pointer hover:bg-accent/30 transition-colors',
        !entry.isDirectory && 'hover:bg-accent/20'
      )}
      onClick={handleClick}
      onDoubleClick={(e) => {
        // 双击文件 → 打开预览 tab（对齐 Hermes onPreviewFile）；文件夹双击 = 展开
        if (!entry.isDirectory) {
          e.stopPropagation();
          onFileDoubleClick(entry);
        }
      }}
      title={entry.path}
    >
      {/* 展开/折叠箭头 — 仅文件夹显示 */}
      <span className="w-3 shrink-0 text-muted-foreground">
        {entry.isDirectory ? (
          isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <span className="inline-block w-3" />
        )}
      </span>

      {/* 图标 */}
      <span className="shrink-0 text-muted-foreground">
        {entry.isDirectory ? (
          isOpen ? <FolderOpen size={14} className="text-warning" /> : <Folder size={14} className="text-warning" />
        ) : (
          <File size={14} className="text-info" />
        )}
      </span>

      {/* 文件名 / 重命名输入框 — min-w-0 必带（flex item 默认 min-width:auto） */}
      {isRenaming ? (
        <input
          autoFocus
          className="flex-1 min-w-0 rounded border border-primary bg-background px-1 text-xs text-foreground outline-none"
          defaultValue={entry.name}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              onRenameCommit(entry.path, e.currentTarget.value);
            } else if (e.key === 'Escape') {
              e.currentTarget.value = entry.name;
              onRenameCancel();
            }
          }}
          onBlur={(e) => onRenameCommit(entry.path, e.currentTarget.value)}
        />
      ) : (
        <span className="truncate text-foreground/80 flex-1 min-w-0">{entry.name}</span>
      )}

      {/* 加载中指示器 */}
      {entry.isDirectory && loadingChildren && (
        <Loader size={10} className="animate-spin text-muted-foreground shrink-0" />
      )}
    </div>
  );

  return (
    <div style={{ paddingLeft: indent }}>
      {/* 右键菜单（对齐 Hermes file-actions：reveal/复制路径/相对路径/重命名/删除） */}
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {isDesktop() && (
            <ContextMenuItem onSelect={() => onReveal(entry.path)}>在文件管理器中显示</ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => onCopyText(entry.path)}>复制路径</ContextMenuItem>
          <ContextMenuItem onSelect={() => onCopyText(relativeTo(rootPath, entry.path))}>复制相对路径</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={isRenaming} onSelect={() => onRenameRequest(entry.path)}>重命名</ContextMenuItem>
          <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteRequest(entry)}>删除</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* 递归渲染子节点 */}
      {entry.isDirectory && isOpen && children && children.length > 0 && (
        <div>
          {children.map((child: FileEntry) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              openState={openState}
              onToggle={onToggle}
              onFileClick={onFileClick}
              onFileDoubleClick={onFileDoubleClick}
              loadChildren={loadChildren}
              refreshNonce={refreshNonce}
              rootPath={rootPath}
              renamingPath={renamingPath}
              onReveal={onReveal}
              onCopyText={onCopyText}
              onRenameRequest={onRenameRequest}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onDeleteRequest={onDeleteRequest}
            />
          ))}
        </div>
      )}

      {/* 空目录提示 — 缩进与子节点行对齐（子行缩进 + 箭头/图标位） */}
      {entry.isDirectory && isOpen && children && children.length === 0 && (
        <div className="text-[10px] text-muted-foreground/50 italic" style={{ paddingLeft: Math.min(depth + 1, MAX_INDENT_DEPTH) * INDENT + 20 }}>
          空目录
        </div>
      )}
    </div>
  );
}

/**
 * FileBrowserPanel 主组件
 */
export default function FileBrowserPanel({
  onFileAttach,
  cwd,
}: FileBrowserPanelProps) {
  const {
    data,
    loading,
    error,
    refresh,
    invalidate,
    refreshNonce,
    setRoot,
    loadChildren,
    openState,
    toggleOpen,
    collapseAll,
    rootPath,
  } = useFileTree();

  // 工作区自动刷新（对齐 Hermes use-project-tree workspaceTick 消费）：
  // Agent 写文件 / spot editor 保存 → 非破坏刷新（保留展开状态）
  const workspaceTick = useWorkspaceTick();
  useEffect(() => {
    if (workspaceTick > 0) {
      void invalidate();
    }
  }, [workspaceTick, invalidate]);

  // 根目录跟随会话 cwd（对齐 Hermes RightSidebarPane：hasWorkspace ? cwd : ''）。
  // 会话切换（cwd 变化）→ 重置手动 override 重新跟随；无 cwd 的 detached
  // 会话不动当前树（保留用户上次浏览位置，不闪空）。
  useEffect(() => {
    if (cwd) void setRoot(cwd);
  }, [cwd, setRoot]);

  // 处理文件点击 — 附加文件路径（250ms 延迟：双击会先触发两次 click，双击语义=打开预览，
  // 延迟让双击有机会取消 attach，避免误发两条 @file）
  const attachTimerRef = useRef<number | null>(null);
  const handleFileClick = useCallback((entry: FileEntry) => {
    if (entry.isDirectory || !onFileAttach) return;
    if (attachTimerRef.current !== null) window.clearTimeout(attachTimerRef.current);
    attachTimerRef.current = window.setTimeout(() => {
      onFileAttach(entry.path);
      attachTimerRef.current = null;
    }, 250);
  }, [onFileAttach]);

  // 双击文件 → 打开文件预览 tab（对齐 Hermes onPreviewFile 语义）
  const handleFileDoubleClick = useCallback((entry: FileEntry) => {
    if (attachTimerRef.current !== null) {
      window.clearTimeout(attachTimerRef.current);
      attachTimerRef.current = null;
    }
    openPreview({ kind: 'file', url: entry.path, name: entry.name });
  }, []);

  // 卸载清理挂起的 attach timer
  useEffect(() => {
    return () => {
      if (attachTimerRef.current !== null) window.clearTimeout(attachTimerRef.current);
    };
  }, []);

  // 处理刷新
  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // 切换目录：Tauri 原生目录选择器（浏览器模式静默无操作）
  const handlePickRoot = useCallback(async () => {
    const sel = await pickDirectory('选择工作目录');
    if (sel) await setRoot(sel);
  }, [setRoot]);

  // ── 上下文菜单操作（对齐 Hermes file-actions）──

  /** 在文件管理器中显示（tauri-plugin-opener；失败不阻断） */
  const handleReveal = useCallback(async (path: string) => {
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(path);
    } catch (err) {
      notifyError(err, '无法在文件管理器中显示');
    }
  }, []);

  /** 复制路径/相对路径 */
  const handleCopyText = useCallback((text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => notifySuccess('路径已复制'))
      .catch((err) => notifyError(err, '复制失败'));
  }, []);

  // 内联重命名（VS Code 语义：右键 → 行内输入框）
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const handleRenameRequest = useCallback((path: string) => setRenamingPath(path), []);
  const handleRenameCancel = useCallback(() => setRenamingPath(null), []);
  const handleRenameCommit = useCallback(
    async (path: string, newName: string) => {
      setRenamingPath((cur) => (cur === path ? null : cur));
      const trimmed = newName.trim();
      if (!trimmed) return;
      const base = path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
      if (trimmed === base) return; // 未变更
      try {
        await filesRename(path, trimmed);
        await invalidate();
      } catch (err) {
        notifyError(err, '重命名失败');
      }
    },
    [invalidate],
  );

  // 删除（回收站）：确认弹窗 → files.delete → 非破坏刷新
  const [deletingEntry, setDeletingEntry] = useState<FileEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const handleDeleteRequest = useCallback((entry: FileEntry) => setDeletingEntry(entry), []);
  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingEntry || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await filesDelete(deletingEntry.path);
      setDeletingEntry(null);
      await invalidate();
    } catch (err) {
      notifyError(err, '删除失败');
    } finally {
      setDeleteBusy(false);
    }
  }, [deletingEntry, deleteBusy, invalidate]);

  // 上级目录
  const handleGoUp = useCallback(() => {
    if (!rootPath) return;
    const parent = parentOf(rootPath);
    if (parent) void setRoot(parent);
  }, [rootPath, setRoot]);

  // 获取当前目录名
  // 🔴 W-4 修复：旧正则 /\\\\/ 匹配双反斜杠，Windows 单反斜杠路径不替换
  // → dirName 显示全路径而非目录名
  const dirName = rootPath
    ? (() => {
        const parts = rootPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
        return parts[parts.length - 1] || rootPath;
      })()
    : '未打开项目';

  // ── 无根目录状态（会话无 cwd 且未手动选目录；对齐 Hermes noProjectOpen）──
  if (!rootPath && !loading) {
    return (
      <div className="flex flex-col flex-1 min-h-0 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">文件</span>
        </div>
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <Folder size={32} className="text-muted-foreground/30" />
          <p className="text-xs">未打开项目</p>
          <span className="text-[10px] text-muted-foreground/50 text-center">当前会话无工作目录，打开会话后自动跟随</span>
          <button
            className="mt-1 flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={handlePickRoot}
          >
            <FolderInput size={12} />
            手动选择目录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-3">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">文件</span>
        <div className="flex items-center gap-0.5">
          <button
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            onClick={handleGoUp}
            title="上级目录"
            disabled={!rootPath || !parentOf(rootPath)}
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={collapseAll}
            title="折叠全部"
          >
            <ChevronsDownUp size={14} />
          </button>
          <button
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={handlePickRoot}
            title="切换目录"
          >
            <FolderInput size={14} />
          </button>
          <button
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={handleRefresh}
            title="刷新"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 当前工作目录 — 点击弹出目录选择器（老大 2026-08-06 指示：点路径即切换目录，
          不必找按钮）；hover 显示切换图标 */}
      <button
        type="button"
        onClick={handlePickRoot}
        title="点击切换目录"
        className="group flex w-full items-center gap-1 px-1 py-1 mb-2 text-xs text-muted-foreground truncate border-b border-border transition-colors hover:bg-accent/10 hover:text-foreground"
      >
        <Folder size={12} className="text-warning shrink-0" />
        <span className="truncate">{rootPath || dirName}</span>
        <FolderInput size={11} className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>

      {/* 加载状态 */}
      {loading && data === null && (
        <div className="flex flex-col items-center py-6 text-muted-foreground gap-2">
          <Loader size={20} className="animate-spin" />
          <span className="text-xs">加载中...</span>
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="flex flex-col items-center py-6 text-muted-foreground gap-2">
          <p className="text-xs text-destructive">读取失败</p>
          <p className="text-[10px] text-muted-foreground/50">{error}</p>
          <button className="text-xs text-primary hover:underline" onClick={handleRefresh}>
            重试
          </button>
        </div>
      )}

      {/* 文件树 */}
      {data && !error && (
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {data.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-muted-foreground gap-2">
              <Folder size={24} className="text-muted-foreground/30" />
              <p className="text-xs">空目录</p>
            </div>
          ) : (
            data.map((entry: FileEntry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                openState={openState}
                onToggle={toggleOpen}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                loadChildren={loadChildren}
                refreshNonce={refreshNonce}
                rootPath={rootPath ?? ''}
                renamingPath={renamingPath}
                onReveal={handleReveal}
                onCopyText={handleCopyText}
                onRenameRequest={handleRenameRequest}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={handleRenameCancel}
                onDeleteRequest={handleDeleteRequest}
              />
            ))
          )}
        </div>
      )}

      {/* 删除确认弹窗（对齐 Hermes file-actions delete confirm；回收站可恢复） */}
      <Dialog open={!!deletingEntry} onOpenChange={(open) => { if (!open && !deleteBusy) setDeletingEntry(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除{deletingEntry?.isDirectory ? '文件夹' : '文件'}</DialogTitle>
            <DialogDescription>
              将 “{deletingEntry?.name}” 移入回收站？可从系统回收站恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => setDeletingEntry(null)}
              disabled={deleteBusy}
            >
              取消
            </button>
            <button
              className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleteBusy}
            >
              {deleteBusy ? '删除中…' : '移入回收站'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
