/**
 * FileBrowserPanel — 右侧文件浏览器面板
 *
 * 树状文件列表，支持展开/折叠目录、点击文件附加路径
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, RefreshCw, Loader } from 'lucide-react';
import { useFileTree } from '../hooks/useFileTree';
import * as storage from '../utils/storage';
import { cn } from '@/lib/utils';

declare const process: { env: Record<string, string | undefined> } | undefined;

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[] | null;
}

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  openState: Record<string, boolean>;
  onToggle: (dirPath: string) => Promise<void>;
  onFileClick: (entry: FileEntry) => void;
  loadChildren: (dirPath: string) => Promise<FileEntry[]>;
}

interface FileBrowserPanelProps {
  onFileAttach?: (path: string) => void;
}

const STORAGE_KEY_ROOT_PATH = 'file_browser_root';

/**
 * 尝试获取默认工作目录
 * - Tauri: home directory
 * - 浏览器: localStorage 缓存 / 空字符串
 */
async function detectDefaultRoot(): Promise<string> {
  // 优先从缓存加载
  const cached = storage.load(STORAGE_KEY_ROOT_PATH, null) as string | null;
  if (cached) return cached;

  // Tauri 环境：尝试获取 home 目录
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    if (homeDir) {
      const home = await homeDir();
      return home;
    }
  } catch {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const home = await invoke('plugin:path|resolve_home_dir');
      if (home) return home as string;
    } catch { /* 继续 fallback */ }
  }

  // 跨平台 fallback
  try {
    if (typeof process !== 'undefined' && process.env?.HOME) {
      return process.env.HOME;
    }
    if (typeof process !== 'undefined' && process.env?.USERPROFILE) {
      return process.env.USERPROFILE;
    }
  } catch { /* ignore */ }

  return '/home'; // 兜底
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
  loadChildren,
}: TreeNodeProps) {
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const childrenLoadedRef = useRef(false);

  const isOpen = !!openState[entry.path];

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

  return (
    <div style={{ paddingLeft: depth * 16 + 4 }}>
      <div
        className={cn(
          'flex items-center gap-1 px-1 py-0.5 rounded text-xs cursor-pointer hover:bg-accent/30 transition-colors',
          !entry.isDirectory && 'hover:bg-accent/20'
        )}
        onClick={handleClick}
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
            isOpen ? <FolderOpen size={14} className="text-amber-500" /> : <Folder size={14} className="text-amber-500" />
          ) : (
            <File size={14} className="text-blue-400" />
          )}
        </span>

        {/* 文件名 */}
        <span className="truncate text-foreground/80 flex-1">{entry.name}</span>

        {/* 加载中指示器 */}
        {entry.isDirectory && loadingChildren && (
          <Loader size={10} className="animate-spin text-muted-foreground shrink-0" />
        )}
      </div>

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
              loadChildren={loadChildren}
            />
          ))}
        </div>
      )}

      {/* 空目录提示 */}
      {entry.isDirectory && isOpen && children && children.length === 0 && (
        <div className="text-[10px] text-muted-foreground/50 italic" style={{ paddingLeft: (depth + 1) * 16 + 20 }}>
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
}: FileBrowserPanelProps) {
  const {
    data,
    loading,
    error,
    refresh,
    setRoot,
    loadChildren,
    openState,
    toggleOpen,
    rootPath,
  } = useFileTree();

  const [initDone, setInitDone] = useState(false);

  // 初始化：检测默认目录
  useEffect(() => {
    (async () => {
      try {
        const root = await detectDefaultRoot();
        await setRoot(root);
      } catch {
        // 保持无目录状态
      }
      setInitDone(true);
    })();
  }, [setRoot]);

  // 处理文件点击 — 附加文件路径
  const handleFileClick = useCallback((entry: FileEntry) => {
    if (!entry.isDirectory && onFileAttach) {
      onFileAttach(entry.path);
    }
  }, [onFileAttach]);

  // 处理刷新
  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // 获取当前目录名
  const dirName = rootPath
    ? (() => {
        const parts = rootPath.replace(/\\\\/g, '/').replace(/\/$/, '').split('/');
        return parts[parts.length - 1] || rootPath;
      })()
    : '未打开项目';

  // ── 空状态（未初始化时）──
  if (!initDone && !loading) {
    return (
      <div className="flex flex-col flex-1 min-h-0 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">文件</span>
        </div>
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <Folder size={32} className="text-muted-foreground/30" />
          <p className="text-xs">正在初始化...</p>
        </div>
      </div>
    );
  }

  // ── 无根目录状态 ──
  if (!rootPath && !loading) {
    return (
      <div className="flex flex-col flex-1 min-h-0 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">文件</span>
        </div>
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <Folder size={32} className="text-muted-foreground/30" />
          <p className="text-xs">未打开项目</p>
          <span className="text-[10px] text-muted-foreground/50 text-center">连接到后端后自动加载工作目录</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-3">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">文件</span>
        <button
          className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          onClick={handleRefresh}
          title="刷新"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 当前工作目录 */}
      <div className="flex items-center gap-1 px-1 py-1 mb-2 text-xs text-muted-foreground truncate border-b border-border" title={rootPath || undefined}>
        <Folder size={12} className="text-amber-500 shrink-0" />
        <span className="truncate">{dirName}</span>
      </div>

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
          <button className="text-xs text-accent hover:underline" onClick={handleRefresh}>
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
                loadChildren={loadChildren}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
