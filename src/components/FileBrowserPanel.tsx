/**
 * FileBrowserPanel — 右侧文件浏览器面板
 *
 * 树状文件列表，支持展开/折叠目录、点击文件附加路径
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, RefreshCw, Loader, ArrowUp, FolderInput } from 'lucide-react';
import { useFileTree } from '../hooks/useFileTree';
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
 * 尝试获取默认工作目录
 * - Tauri: home directory
 * - 浏览器: 空字符串
 * （W-5：旧 file_browser_root 缓存 key 只读无人写 = 死代码，移除）
 */
async function detectDefaultRoot(): Promise<string> {
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

  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT + 4;

  return (
    <div style={{ paddingLeft: indent }}>
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
            isOpen ? <FolderOpen size={14} className="text-warning" /> : <Folder size={14} className="text-warning" />
          ) : (
            <File size={14} className="text-info" />
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

  // 切换目录：Tauri 原生目录选择器（浏览器模式静默无操作）
  const handlePickRoot = useCallback(async () => {
    const sel = await pickDirectory('选择工作目录');
    if (sel) await setRoot(sel);
  }, [setRoot]);

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

      {/* 当前工作目录 — 显示完整路径，悬浮可见全路径 */}
      <div className="flex items-center gap-1 px-1 py-1 mb-2 text-xs text-muted-foreground truncate border-b border-border" title={rootPath || undefined}>
        <Folder size={12} className="text-warning shrink-0" />
        <span className="truncate">{rootPath || dirName}</span>
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
                loadChildren={loadChildren}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
