/**
 * FileBrowserPanel — 右侧文件浏览器面板
 *
 * 树状文件列表，支持展开/折叠目录；单击选中、shift+click 引用、双击预览
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, ChevronsDownUp, RefreshCw, Loader, ArrowUp, FolderInput } from 'lucide-react';
import { useFileTree } from '../hooks/useFileTree';
import { useWorkspaceTick, notifyWorkspaceChanged } from '../lib/workspace-events';
import { openPreview } from '@/store/preview';
import { cn } from '@/lib/utils';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { filesRename, filesDelete } from '../utils/api';
import { notifyError, notifySuccess } from '../utils/notifications';
import { isDesktop, call } from '@/utils/bridge';
import { setPathsDragPayload } from '@/lib/paths-dnd';
import FolderPickerDialog from './FolderPickerDialog';
import ErrorBoundary from './ErrorBoundary';

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
  /** 单击文件 → 选中高亮（对齐 Hermes row select 语义，无副作用） */
  onSelectFile: (path: string) => void;
  /** shift+click 文件 → 引用到输入框（对齐 Hermes tree.tsx shift+click = attach） */
  onFileAttach: (path: string) => void;
  onFileDoubleClick: (entry: FileEntry) => void;
  loadChildren: (dirPath: string) => Promise<FileEntry[]>;
  /** 非破坏刷新信号：workspace tick 递增 → 已展开目录重新加载（对齐 Hermes revalidateTree） */
  refreshNonce: number;
  /** 树根路径（复制相对路径的基准） */
  rootPath: string;
  /** 当前正在重命名的节点路径（null = 无） */
  renamingPath: string | null;
  /** 当前选中的文件/文件夹路径（高亮；方向键可选中目录） */
  selectedPath: string | null;
  /** 已加载的子条目（useFileTree loadedDirs 数据源；undefined = 未加载） */
  children?: FileEntry[] | undefined;
  /** 目录 → 已加载子条目（递归渲染用；对齐 Hermes childrenAccessor） */
  getChildren: (dirPath: string) => FileEntry[] | undefined;
  /** 路径 → git 变更状态（对齐 Hermes repoChangeKindForPath） */
  statusKindForPath: (path: string) => 'added' | 'modified' | 'conflicted' | undefined;
  /** 本行 git 变更状态（对齐 Hermes CHANGE_TINT；undefined = 无变更） */
  statusKind?: 'added' | 'modified' | 'conflicted';
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
  onSelectFile,
  onFileAttach,
  onFileDoubleClick,
  loadChildren,
  refreshNonce,
  rootPath,
  renamingPath,
  selectedPath,
  children,
  getChildren,
  statusKindForPath,
  statusKind,
  onReveal,
  onCopyText,
  onRenameRequest,
  onRenameCommit,
  onRenameCancel,
  onDeleteRequest,
}: TreeNodeProps) {
  const [loadingChildren, setLoadingChildren] = useState(false);
  /** 子目录读取失败原因（Hermes error placeholder 语义；成功/空目录 = null） */
  const [loadError, setLoadError] = useState<string | null>(null);

  const isOpen = !!openState[entry.path];
  const loaded = children !== undefined;

  // 非破坏刷新：workspace 变化（Agent 写文件/保存）→ 已展开目录重新拉取
  // （缓存已被 invalidate 清空 → loadChildren 重新 fetch；未展开/未加载过的不动）
  useEffect(() => {
    if (!isOpen || !loaded) return;
    let cancelled = false;
    setLoadingChildren(true);
    loadChildren(entry.path)
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingChildren(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, entry.path, isOpen, loaded, loadChildren]);

  const handleToggle = useCallback(async (e: React.SyntheticEvent) => {
    e.stopPropagation();
    await onToggle(entry.path);

    // 首次展开时加载子目录（数据源 = loadedDirs，加载后主组件透传 children）
    if (!isOpen && !loaded) {
      setLoadingChildren(true);
      try {
        await loadChildren(entry.path);
        setLoadError(null);
      } catch (err: unknown) {
        // 对齐 Hermes error placeholder：读取失败不能伪装成空目录
        setLoadError(err instanceof Error ? err.message : String(err));
      }
      setLoadingChildren(false);
    }
  }, [entry.path, isOpen, loaded, onToggle, loadChildren]);

  const indent = Math.min(depth, MAX_INDENT_DEPTH) * INDENT + 4;
  const isRenaming = renamingPath === entry.path;

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (entry.isDirectory) {
      handleToggle(e);
    } else if (e.shiftKey) {
      // shift+click = attach（对齐 Hermes tree.tsx：shift+click 走 onAttachFile）
      e.stopPropagation();
      onFileAttach(entry.path);
    } else {
      // 单击 = 选中高亮（对齐 Hermes row select 语义，无发送副作用）；
      // focus 行 → F2/Enter/方向键立即可用（对齐 Hermes arborist 选中即键盘可用）
      onSelectFile(entry.path);
      e.currentTarget.focus();
    }
  }, [entry, handleToggle, onFileAttach, onSelectFile]);

  // 选中行键盘操作（对齐 Hermes isRenameShortcut：F2 = 重命名、Enter = 激活；
  // 目录 Enter = 展开/折叠；方向键冒泡到树容器处理）
  const handleRowKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      onRenameRequest(entry.path);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (entry.isDirectory) {
        void handleToggle(e);
      } else {
        onFileDoubleClick(entry);
      }
    }
  }, [entry, onRenameRequest, onFileDoubleClick, handleToggle]);

  // 行拖拽 → 聊天输入框/终端（对齐 Hermes tree.tsx onDragStart：
  // application/x-hermes-paths JSON + text/plain 双 MIME）
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (isRenaming) {
      e.preventDefault();
      return;
    }
    setPathsDragPayload(e.dataTransfer, entry.path, entry.isDirectory);
  }, [entry.isDirectory, entry.path, isRenaming]);

  // 行内容（重命名中 → 输入框；对齐 Hermes InlineRenameInput：Enter 提交/Esc 取消/失焦提交）
  const row = (
    <div
      className={cn(
        'flex items-center gap-1 px-1 py-0.5 rounded text-xs cursor-pointer transition-colors',
        !entry.isDirectory && 'hover:bg-accent/20',
        // 选中高亮（对齐 Hermes node.isSelected 视觉；单击文件/方向键均可选中，
        // 目录被选中时同样高亮——Hermes arborist 选中态不分文件/文件夹）
        selectedPath === entry.path && 'bg-accent/30 hover:bg-accent/30'
      )}
      onClick={handleClick}
      onDoubleClick={(e) => {
        // 双击文件 → 打开预览 tab（对齐 Hermes onPreviewFile）；文件夹双击 = 展开
        if (!entry.isDirectory) {
          e.stopPropagation();
          onFileDoubleClick(entry);
        }
      }}
      onDragStart={handleDragStart}
      onKeyDown={handleRowKeyDown}
      draggable={!isRenaming}
      aria-expanded={entry.isDirectory ? isOpen : undefined}
      aria-selected={selectedPath === entry.path}
      tabIndex={selectedPath === entry.path ? 0 : -1}
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
          onFocus={(e) => {
            // 对齐 Hermes InlineRenameInput：stem 预选（不含扩展名），VS Code 语义
            const dot = e.currentTarget.value.lastIndexOf('.');
            e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
          }}
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
        <span
          className={cn(
            'truncate flex-1 min-w-0',
            // git 变更着色（对齐 Hermes CHANGE_TINT：added=绿/modified=黄/conflicted=红；
            // 显式颜色优先于行 hover/选中文本色，持续可见）
            statusKind === 'added' && 'text-success',
            statusKind === 'modified' && 'text-warning',
            statusKind === 'conflicted' && 'text-destructive',
            !statusKind && 'text-foreground/80'
          )}
        >
          {entry.name}
        </span>
      )}

      {/* 加载中指示器 */}
      {entry.isDirectory && loadingChildren && (
        <Loader size={10} className="animate-spin text-muted-foreground shrink-0" />
      )}
    </div>
  );

  return (
    <div style={{ paddingLeft: indent }}>
      {/* 右键菜单（对齐 Hermes file-actions：reveal/复制路径/相对路径/重命名/删除）
          onCloseAutoFocus preventDefault：菜单关闭默认把焦点还给行 → 立即 blur 掉
          重命名输入框（Hermes file-actions.tsx 同款注释；不加则"重命名"点了闪退） */}
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
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
              onSelectFile={onSelectFile}
              onFileAttach={onFileAttach}
              onFileDoubleClick={onFileDoubleClick}
              loadChildren={loadChildren}
              refreshNonce={refreshNonce}
              rootPath={rootPath}
              renamingPath={renamingPath}
              selectedPath={selectedPath}
              children={child.isDirectory ? getChildren(child.path) : undefined}
              getChildren={getChildren}
              statusKindForPath={statusKindForPath}
              statusKind={statusKindForPath(child.path)}
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

      {/* 读取失败占位（对齐 Hermes error placeholder："Unable to read (EACCES)"，
          不能伪装成空目录；重新展开或 workspace tick 会重试） */}
      {entry.isDirectory && isOpen && loadError && (
        <div className="flex items-center gap-1 text-[10px] text-destructive/80 italic" style={{ paddingLeft: Math.min(depth + 1, MAX_INDENT_DEPTH) * INDENT + 20 }}>
          <span className="shrink-0">无法读取</span>
          <span className="truncate">{loadError}</span>
        </div>
      )}

      {/* 空目录提示 — 缩进与子节点行对齐（子行缩进 + 箭头/图标位） */}
      {entry.isDirectory && isOpen && !loadError && children && children.length === 0 && (
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
    loadedDirs,
  } = useFileTree();

  // ── git 变更着色（对齐 Hermes $repoStatus → CHANGE_TINT）──
  // files.status（WS）返回 repo-root 相对路径 → join git root 成绝对路径匹配树行；
  // 非 git 仓库/失败 → 不着色。刷新时机 = 根变化或非破坏刷新后（与树一致，
  // Hermes 同款：workspaceTick/cwd 变化 → scheduleRepoStatusRefresh）。
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!rootPath) {
      setStatusMap({});
      return;
    }
    let cancelled = false;
    call('files_status', { path: rootPath })
      .then((data) => {
        if (cancelled) return;
        const d = data as { root?: string; files?: Array<{ path: string; kind: string }> };
        const root = d.root;
        const m: Record<string, string> = {};
        if (root) {
          const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
          for (const f of d.files ?? []) m[`${r}/${f.path}`] = f.kind;
        }
        setStatusMap(m);
      })
      .catch(() => {
        if (!cancelled) setStatusMap({});
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, refreshNonce]);

  const statusKindForPath = useCallback(
    (path: string) => statusMap[path.replace(/\\/g, '/')] as 'added' | 'modified' | 'conflicted' | undefined,
    [statusMap],
  );

  // 可见行扁平列表（键盘导航 ↑↓ 用；数据源 = data + loadedDirs + openState，
  // 与渲染同一权威源，对齐 Hermes arborist 的树导航语义）
  const flatList = useMemo(() => {
    const out: Array<{ path: string; isDirectory: boolean }> = [];
    const walk = (entries: FileEntry[]) => {
      for (const e of entries) {
        out.push({ path: e.path, isDirectory: e.isDirectory });
        if (e.isDirectory && openState[e.path]) {
          const kids = loadedDirs[e.path];
          if (kids) walk(kids);
        }
      }
    };
    if (data) walk(data);
    return out;
  }, [data, loadedDirs, openState]);

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

  // 单击文件 → 选中高亮（对齐 Hermes row select；无发送副作用）。
  // shift+click → attach（引用到输入框，由 App.tsx 接线 requestComposerInsert，
  // 不再直接发送消息——Hermes tree.tsx 的 attach 是显式意图操作）。
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const handleSelectFile = useCallback((path: string) => setSelectedPath(path), []);

  // 树容器方向键导航（行 F2/Enter 就地处理；↑↓→← 冒泡到这里）：
  // ↑↓ 移动选中、→ 展开选中目录、← 折叠选中目录/跳到父目录（对齐 Hermes arborist 键盘模型）
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedPath || flatList.length === 0) return;
      const idx = flatList.findIndex((x) => x.path === selectedPath);
      if (idx < 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = flatList[Math.min(idx + 1, flatList.length - 1)];
        if (next) setSelectedPath(next.path);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = flatList[Math.max(idx - 1, 0)];
        if (prev) setSelectedPath(prev.path);
      } else if (e.key === 'ArrowRight') {
        const target = flatList[idx];
        if (target?.isDirectory && !openState[target.path]) void toggleOpen(target.path);
      } else if (e.key === 'ArrowLeft') {
        const target = flatList[idx];
        if (target?.isDirectory && openState[target.path]) {
          void toggleOpen(target.path);
        } else if (target) {
          const parent = parentOf(target.path);
          if (parent) {
            if (openState[parent]) void toggleOpen(parent);
            else setSelectedPath(parent);
          }
        }
      }
    },
    [selectedPath, flatList, openState, toggleOpen],
  );

  // 双击文件 → 打开文件预览 tab（对齐 Hermes onPreviewFile 语义）；
  // 双击文件夹 = 展开/折叠（Hermes dblclick 文件夹同 toggle）
  const handleFileDoubleClick = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) {
      void toggleOpen(entry.path);
    } else {
      openPreview({ kind: 'file', url: entry.path, name: entry.name });
    }
  }, [toggleOpen]);

  // ── fallback root（对齐 Hermes sanitizeWorkspaceCwd → usingFallback 探针）──
  // 会话 cwd 读取失败（目录被删/换机器）→ 回退到激活项目的主文件夹（ELEVE
  // projects.primary_path，等价 Hermes「默认项目目录」）；回退期间 3s 探针原
  // cwd，一旦恢复自动切回（Hermes use-project-tree 同款两段逻辑）。
  const [usingFallback, setUsingFallback] = useState(false);
  const originalCwdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cwd || !error || usingFallback) return;
    let cancelled = false;
    call('projects_tree', { preview_limit: 1, include_discovered: false })
      .then((d) => {
        if (cancelled) return;
        const t = d as {
          active_id?: string | null;
          projects?: Array<{ id: string; path?: string | null }>;
        };
        const active = (t.projects ?? []).find((p) => p.id === t.active_id);
        const fallbackPath = active?.path;
        if (fallbackPath && fallbackPath !== cwd) {
          originalCwdRef.current = cwd;
          setUsingFallback(true);
          void setRoot(fallbackPath);
        }
      })
      .catch(() => { /* 无激活项目/查询失败 → 维持报错+3s 重试 */ });
    return () => {
      cancelled = true;
    };
  }, [cwd, error, usingFallback, setRoot]);

  // 回退期间探针原 cwd → 恢复即切回（对齐 Hermes usingFallback interval；
  // 探针不碰状态（无 loading 闪烁），成功才 setRoot）
  useEffect(() => {
    if (!usingFallback || !originalCwdRef.current) return;
    const probe = async () => {
      const orig = originalCwdRef.current;
      if (!orig) return;
      try {
        await call('files_list', { path: orig });
        originalCwdRef.current = null;
        setUsingFallback(false);
        void setRoot(orig);
      } catch { /* 仍不可用，继续探针 */ }
    };
    void probe();
    const i = window.setInterval(probe, 3000);
    return () => window.clearInterval(i);
  }, [usingFallback, setRoot]);

  // 处理刷新
  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  // 切换目录：桌面 = Tauri 原生目录选择器；浏览器模式 = 自绘 FolderPickerDialog
  // （对齐 Hermes RemoteFolderPicker——原生 dialog 不可用时自绘，不再静默无操作）
  const [pickerOpen, setPickerOpen] = useState(false);
  const handlePickRoot = useCallback(async () => {
    if (isDesktop()) {
      const sel = await pickDirectory('选择工作目录');
      if (sel) await setRoot(sel);
    } else {
      setPickerOpen(true);
    }
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
        // 对齐 Hermes executeFileRename → notifyWorkspaceChanged：
        // 预览等所有 fs 镜像表面联动刷新（不仅文件树）
        notifyWorkspaceChanged();
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
      // 对齐 Hermes executeFileDelete → notifyWorkspaceChanged：
      // 预览等所有 fs 镜像表面联动刷新（不仅文件树）
      notifyWorkspaceChanged();
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
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            onClick={collapseAll}
            title="折叠全部"
            disabled={!Object.values(openState).some(Boolean)}
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

      {/* 回退提示（对齐 Hermes fallback root 语义；原 cwd 恢复后自动切回） */}
      {usingFallback && (
        <div className="mb-1 px-1 text-[10px] text-warning/90 leading-tight">
          原工作目录不可用，已显示激活项目目录（恢复后自动切回）
        </div>
      )}

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

      {/* 文件树（ErrorBoundary key=rootPath：渲染崩溃局部隔离，对齐 Hermes
          FileTreeBody ErrorBoundary key=cwd） */}
      {data && !error && (
        <ErrorBoundary key={rootPath ?? ''}>
        <div className="flex-1 overflow-y-auto space-y-0.5" tabIndex={-1} onKeyDown={handleTreeKeyDown}>
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
                onSelectFile={handleSelectFile}
                onFileAttach={onFileAttach ?? (() => {})}
                onFileDoubleClick={handleFileDoubleClick}
                loadChildren={loadChildren}
                refreshNonce={refreshNonce}
                rootPath={rootPath ?? ''}
                renamingPath={renamingPath}
                selectedPath={selectedPath}
                children={entry.isDirectory ? loadedDirs[entry.path] : undefined}
                getChildren={(p) => loadedDirs[p]}
                statusKindForPath={statusKindForPath}
                statusKind={statusKindForPath(entry.path)}
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
        </ErrorBoundary>
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

      {/* 浏览器模式目录选择器（桌面模式用原生 dialog，不渲染本组件） */}
      <FolderPickerDialog
        open={pickerOpen}
        initialPath={rootPath}
        onClose={() => setPickerOpen(false)}
        onSelect={(p) => {
          setPickerOpen(false);
          void setRoot(p);
        }}
      />
    </div>
  );
}
