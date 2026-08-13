/**
 * FileBrowserPanel — 右侧文件浏览器面板
 *
 * 树状文件列表，支持展开/折叠目录；单击选中、shift+click 引用、双击预览
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, ChevronsDownUp, RefreshCw, Loader, ArrowUp, FolderInput } from 'lucide-react';
import { useFileTree } from '../hooks/useFileTree';
import { useWorkspaceTick, consumeWorkspaceChange, notifyWorkspaceChanged } from '../lib/workspace-events';
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
import { loadConnection, isRemoteMode } from '../lib/connection';
import { pickDirectory } from '../utils/directory-picker';
import { isFsRemoteMode } from '../lib/remote-fs';

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

interface FlatRow {
  key: string;
  name: string;
  path: string;
  isDirectory: boolean;
  depth: number;
  /** 占位行（loading/error/empty）不可交互（对齐 Hermes placeholder 语义） */
  placeholder?: 'loading' | 'error' | 'empty';
  error?: string;
}

interface FileRowProps {
  row: FlatRow;
  isOpen: boolean;
  selected: boolean;
  renaming: boolean;
  statusKind?: 'added' | 'modified' | 'conflicted';
  rootPath: string;
  onSelect: (path: string) => void;
  onAttach: (path: string) => void;
  onPreview: (row: FlatRow) => void;
  onToggleDir: (path: string) => void;
  onReveal: (path: string) => void;
  onCopyText: (text: string) => void;
  onRenameRequest: (path: string) => void;
  onRenameCommit: (path: string, newName: string) => void;
  onRenameCancel: () => void;
  onDeleteRequest: (row: FlatRow) => void;
}

// ── 虚拟滚动常量（对齐 Hermes react-arborist：ROW_HEIGHT=22 + overscan）──
const ROW_HEIGHT = 22;
const OVERSCAN = 5;

/** git 变更着色（对齐 Hermes CHANGE_TINT：added=绿/modified=黄/conflicted=红） */
const STATUS_COLOR: Record<string, string> = {
  added: 'text-success',
  modified: 'text-warning',
  conflicted: 'text-destructive',
};


interface FileBrowserPanelProps {
  onFileAttach?: (path: string) => void;
  /** 文件面板重定向根（老大 2026-08-13 语义定稿：三个独立功能 + 单向联动）
   * 右侧文件面板 = 真实文件树（可导航/编辑/删除/重命名，操作真实生效）。
   * 联动单向：点选项目卡片 → 面板重定向到该项目绑定物理地址；
   * 面板任何操作（导航/编辑文件）都不反向影响项目（项目是虚拟会话管理单元，
   * per-profile 绑定物理路径、终身不变）。本 prop = 单向重定向的目标根。 */
  cwd?: string | null;
  /** 会话 id（目录切换需后端烙印 — 对齐 Hermes use-cwd-actions session.cwd.set） */
  sessionId?: string | null;
  /** 目录切换回调（2026-08-09 对齐 Hermes：前端 setRoot 只改显示，
   *  必须由上层接线 session.cwd.set 烙印，否则重启/重连后回弹） */
  onCwdChange?: (path: string) => void;
}

// 每层缩进（对齐 Hermes react-arborist INDENT=10）：16px/层在窄面板里
// 5-6 层后文件名就被挤出可视区，表现为"深层文件被裁掉显示不全"
const INDENT = 10;
// 深度封顶：超过该层数不再增加缩进，防极端深嵌套把行推出面板
const MAX_INDENT_DEPTH = 20;

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
/**
 * 行内重命名输入（对齐 Hermes InlineRenameInput）：
 * - done latch：Enter 提交后 blur 不二次提交（旧实现 Enter→blur 双提交 →
 *   旧路径+新名二次 rename 报错）
 * - mountedAt 250ms 防抖：菜单关闭/焦点回流在挂载后 250ms 内不 blur 误提交，
 *   抢回焦点（右键菜单 onCloseAutoFocus preventDefault 之外的第二道防线）
 * - stem 预选（不含扩展名，VS Code 语义）
 */
function InlineRenameInput({ name, path, onCommit, onCancel }: {
  name: string;
  path: string;
  onCommit: (path: string, newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const mountedAt = useRef(Date.now());

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(path, value);
    else onCancel();
  };

  return (
    <input
      autoFocus
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="flex-1 min-w-0 rounded border border-primary bg-background px-1 text-xs text-foreground outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        // 对齐 Hermes InlineRenameInput：stem 预选（不含扩展名），VS Code 语义
        const dot = e.currentTarget.value.lastIndexOf('.');
        e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={(e) => {
        if (Date.now() - mountedAt.current < 250) {
          e.currentTarget.focus();
          return;
        }
        finish(true);
      }}
    />
  );
}

/**
 * FileRow — 虚拟滚动单行（对齐 Hermes ProjectTreeRow；占位行不可交互）
 */
function FileRow({
  row,
  isOpen,
  selected,
  renaming,
  statusKind,
  rootPath,
  onSelect,
  onAttach,
  onPreview,
  onToggleDir,
  onReveal,
  onCopyText,
  onRenameRequest,
  onRenameCommit,
  onRenameCancel,
  onDeleteRequest,
}: FileRowProps) {
  // 占位行：不可交互（对齐 Hermes placeholder：pointer-events-none italic）
  if (row.placeholder) {
    return (
      <div
        className={cn(
          'flex items-center gap-1 px-1 text-[10px] italic pointer-events-none select-none',
          row.placeholder === 'error' ? 'text-destructive/80' : 'text-muted-foreground/50'
        )}
        style={{ paddingLeft: Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT + 4 }}
        title={row.placeholder === 'error' ? row.error : undefined}
      >
        {row.placeholder === 'loading' && <Loader size={10} className="animate-spin shrink-0" />}
        <span className="truncate">
          {row.placeholder === 'loading' ? '加载中…' : row.placeholder === 'error' ? `无法读取：${row.error ?? ''}` : '空目录'}
        </span>
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (row.isDirectory) {
      onToggleDir(row.path);
    } else if (e.shiftKey) {
      // shift+click = attach（对齐 Hermes tree.tsx：shift+click 走 onAttachFile）
      e.stopPropagation();
      onAttach(row.path);
    } else {
      // 单击 = 选中高亮（对齐 Hermes row select 语义，无发送副作用）；
      // focus 行 → F2/Enter/方向键立即可用（对齐 Hermes arborist 选中即键盘可用）
      onSelect(row.path);
      e.currentTarget.focus();
    }
  };

  // 选中行键盘操作（对齐 Hermes isRenameShortcut：F2 = 重命名、Enter = 激活；
  // 目录 Enter = 展开/折叠；方向键冒泡到树容器处理）
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      onRenameRequest(row.path);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (row.isDirectory) onToggleDir(row.path);
      else onPreview(row);
    }
  };

  // 行拖拽 → 聊天输入框/终端（对齐 Hermes tree.tsx onDragStart 双 MIME）
  const handleDragStart = (e: React.DragEvent) => {
    if (renaming) {
      e.preventDefault();
      return;
    }
    setPathsDragPayload(e.dataTransfer, row.path, row.isDirectory);
  };

  const indent = Math.min(row.depth, MAX_INDENT_DEPTH) * INDENT + 4;

  const rowEl = (
    <div
      className={cn(
        'flex items-center gap-1 px-1 rounded text-xs cursor-pointer transition-colors',
        'hover:bg-accent/20',
        // 选中高亮（对齐 Hermes node.isSelected；单击文件/方向键均可选中）
        selected && 'bg-accent/30 hover:bg-accent/30'
      )}
      onClick={handleClick}
      onDoubleClick={(e) => {
        // 双击文件 → 打开预览 tab（对齐 Hermes onPreviewFile）；文件夹双击 = 展开
        if (!row.isDirectory) {
          e.stopPropagation();
          onPreview(row);
        }
      }}
      onDragStart={handleDragStart}
      onKeyDown={handleKeyDown}
      draggable={!renaming}
      aria-expanded={row.isDirectory ? isOpen : undefined}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      style={{ paddingLeft: indent, height: ROW_HEIGHT }}
      title={row.path}
    >
      {/* 展开/折叠箭头 — 仅文件夹显示 */}
      <span className="w-3 shrink-0 text-muted-foreground">
        {row.isDirectory ? (
          isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <span className="inline-block w-3" />
        )}
      </span>

      {/* 图标 */}
      <span className="shrink-0 text-muted-foreground">
        {row.isDirectory ? (
          isOpen ? <FolderOpen size={14} className="text-warning" /> : <Folder size={14} className="text-warning" />
        ) : (
          <File size={14} className="text-info" />
        )}
      </span>

      {/* 文件名 / 重命名输入框 — min-w-0 必带（flex item 默认 min-width:auto） */}
      {renaming ? (
        <InlineRenameInput name={row.name} path={row.path} onCommit={onRenameCommit} onCancel={onRenameCancel} />
      ) : (
        <span
          className={cn(
            'truncate flex-1 min-w-0',
            // git 变更着色（显式颜色优先于行 hover/选中文本色，持续可见）
            statusKind && STATUS_COLOR[statusKind],
            !statusKind && 'text-foreground/80'
          )}
        >
          {row.name}
        </span>
      )}
    </div>
  );

  // 右键菜单（对齐 Hermes file-actions：reveal/复制路径/相对路径/重命名/删除）
  // onCloseAutoFocus preventDefault：菜单关闭默认把焦点还给行 → 立即 blur 掉
  // 重命名输入框（Hermes file-actions.tsx 同款注释；不加则"重命名"点了闪退）
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowEl}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        {isDesktop() && (
          <ContextMenuItem onSelect={() => onReveal(row.path)}>在文件管理器中显示</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => onCopyText(row.path)}>复制路径</ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopyText(relativeTo(rootPath, row.path))}>复制相对路径</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={renaming} onSelect={() => onRenameRequest(row.path)}>重命名</ContextMenuItem>
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteRequest(row)}>删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}


/**
 * FileBrowserPanel 主组件
 */
export default function FileBrowserPanel({
  onFileAttach,
  cwd,
  sessionId: _sessionId,
  onCwdChange,
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
    loadingDirs,
    dirErrors,
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

  // 可见行扁平列表（虚拟滚动 + 键盘导航共用；数据源 = data + loadedDirs +
  // openState + dirErrors，与渲染同一权威源，对齐 Hermes useProjectTree data
  // 树模型 + loadingChild/errorChild 占位语义）
  const flatList = useMemo(() => {
    const out: FlatRow[] = [];
    const walk = (entries: FileEntry[], depth: number) => {
      for (const e of entries) {
        out.push({ key: e.path, name: e.name, path: e.path, isDirectory: e.isDirectory, depth });
        if (e.isDirectory && openState[e.path]) {
          const kids = loadedDirs[e.path];
          if (kids === undefined) {
            // 展开但未加载完成/失败 → 占位行（对齐 Hermes placeholderChild/errorChild）
            if (dirErrors[e.path]) {
              out.push({
                key: `${e.path}::error`, name: '', path: e.path, isDirectory: false, depth: depth + 1,
                placeholder: 'error', error: dirErrors[e.path] ?? '',
              });
            } else {
              out.push({
                key: `${e.path}::loading`, name: '', path: e.path, isDirectory: false, depth: depth + 1,
                placeholder: 'loading',
              });
            }
          } else if (kids.length === 0) {
            out.push({
              key: `${e.path}::empty`, name: '', path: e.path, isDirectory: false, depth: depth + 1,
              placeholder: 'empty',
            });
          } else {
            walk(kids, depth + 1);
          }
        }
      }
    };
    if (data) walk(data, 0);
    return out;
  }, [data, loadedDirs, openState, dirErrors]);

  // 虚拟滚动窗口（对齐 Hermes react-arborist：固定行高 + overscan，只渲染可视行）
  // 🔴 修复 2026-08-08：原 useEffect([]) 只在组件挂载时跑一次，而挂载瞬间
  // rootPath=null（“未打开项目”界面）→ scrollRef.current=null → ResizeObserver
  // 永久失效 → viewportH 恒 0 → 虚拟滚动窗口 = OVERSCAN(5) 行 → 目录只显示
  // 前 5 个文件夹（后端 files.list 实测返回全量 175 项，后端无问题）。
  // 对齐 Hermes useResizeObserver：observer 挂在始终存在的容器上；ELEVE 的
  // 树容器是条件渲染（data && !error），改用 callback ref——div 真正挂载才
  // observe、卸载即 disconnect，并立即读一次初始高度（不等 RO 首回调，避免
  // 抽屉展开动画期间首帧高度为 0 的竞态）。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el; // 保持 scrollRef 可用（ensureVisible/滚动逻辑读它）
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    roRef.current = ro;
    setViewportH(el.clientHeight);
  }, []);
  const scrollStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const scrollEnd = Math.min(flatList.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = flatList.slice(scrollStart, scrollEnd);

  // 工作区自动刷新（对齐 Hermes use-project-tree workspaceTick 消费）：
  // Agent 写文件 / spot editor 保存 → 精准失效（dirs/full）：
  // - tool.complete 带路径 → 只重读已加载的变更目录（增量更新，不 refreshNonce）
  // - terminal/多路径无法锚定 → full 全量（清缓存重拉根 + 已展开目录重载）
  // 🔴 进依赖数组的只有 tick/invalidate——openState/loadedDirs 经 hook 内 ref 镜像读最新
  const workspaceTick = useWorkspaceTick();
  useEffect(() => {
    if (workspaceTick > 0) {
      void invalidate(consumeWorkspaceChange());
    }
  }, [workspaceTick, invalidate]);

  // 根目录跟随会话 cwd（对齐 Hermes RightSidebarPane：hasWorkspace ? cwd : ''）。
  // 会话切换（cwd 变化）→ 重置手动 override 重新跟随；🔴 2026-08-09 对齐 Hermes：
  // 无 cwd 的 detached 会话 → setRoot(null) 清空树显示"未打开项目"（Hermes
  // hasWorkspace=false → useProjectTree('') → 树空；旧实现保留上次浏览位置 =
  // 切到 detached 会话仍显示旧目录，与 Hermes 展示语义不一致）。
  // 🔴 2026-08-13 诊断：cwd → setRoot 链路
  useEffect(() => {
    if (cwd) void setRoot(cwd);
    else void setRoot(null);
  }, [cwd, setRoot]);

  // 单击文件 → 选中高亮（对齐 Hermes row select；无发送副作用）。
  // shift+click → attach（引用到输入框，由 App.tsx 接线 requestComposerInsert，
  // 不再直接发送消息——Hermes tree.tsx 的 attach 是显式意图操作）。
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const handleSelectFile = useCallback((path: string) => setSelectedPath(path), []);

  // 目录展开/折叠 + 懒加载（对齐 Hermes handleToggle：toggle 后首次展开拉取子项）
  const handleToggleDir = useCallback(
    (path: string) => {
      void toggleOpen(path);
      void loadChildren(path);
    },
    [toggleOpen, loadChildren],
  );

  // 树容器方向键导航（行 F2/Enter 就地处理；↑↓→← 冒泡到这里）：
  // ↑↓ 移动选中（跳过占位行）、→ 展开选中目录、← 折叠/跳父目录（对齐 Hermes arborist 键盘模型）
  const ensureVisible = useCallback((index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  }, []);

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectedPath || flatList.length === 0) return;
      const idx = flatList.findIndex((x) => x.path === selectedPath);
      if (idx < 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        let i = Math.min(idx + 1, flatList.length - 1);
        while (i < flatList.length - 1 && flatList[i].placeholder) i += 1;
        if (!flatList[i].placeholder) {
          setSelectedPath(flatList[i].path);
          ensureVisible(i);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        let i = Math.max(idx - 1, 0);
        while (i > 0 && flatList[i].placeholder) i -= 1;
        if (!flatList[i].placeholder) {
          setSelectedPath(flatList[i].path);
          ensureVisible(i);
        }
      } else if (e.key === 'ArrowRight') {
        const target = flatList[idx];
        if (target?.isDirectory && !openState[target.path]) handleToggleDir(target.path);
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
    [selectedPath, flatList, openState, toggleOpen, handleToggleDir, ensureVisible],
  );

  // 双击文件 → 打开文件预览 tab（对齐 Hermes onPreviewFile 语义）；
  // 双击文件夹 = 展开/折叠（Hermes dblclick 文件夹同 toggle）
  const handleFileDoubleClick = useCallback((entry: FlatRow) => {
    if (entry.isDirectory) {
      void toggleOpen(entry.path);
      void loadChildren(entry.path);
    } else {
      openPreview({ kind: 'file', url: entry.path, name: entry.name });
    }
  }, [toggleOpen, loadChildren]);

  // ── fallback root（对齐 Hermes sanitizeWorkspaceCwd → resolveHermesCwd）──
  // 会话 cwd 读取失败（目录被删/换机器）→ 回退候选链（🔴 2026-08-13 老大指示：
  // 默认工作目录设置已取消 → 候选只剩用户主目录）：
  //   用户主目录（后端 system.home = dirs::home_dir，Hermes 主进程
  //      app.getPath('home') 同源；🔴 2026-08-09 移除激活项目候选——Hermes 无
  //      激活项目持久化概念，项目激活≠目录选择，误当 fallback 会显示用户
  //      未为文件面板选过的目录）
  //   无 → 维持报错+3s 重试（ROOT_ERROR_RETRY_MS self-heal，原逻辑）。
  // 回退期间 3s 探针原 cwd，一旦恢复自动切回（Hermes use-project-tree 同款两段逻辑）。
  const [usingFallback, setUsingFallback] = useState(false);
  const originalCwdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!cwd || !error || usingFallback) return;
    // 🔴 Remote 模式不 fallback（对齐 Hermes fallbackRootFor：remote → null）——
    // 远程树读远程后端 fs，cwd 无效时保持报错+3s 重试即可，不落本地候选
    if (isRemoteMode(loadConnection())) return;
    let cancelled = false;
    // 🔴 2026-08-13 老大指示：默认工作目录设置已取消 → fallback 候选只剩用户主目录
    const tryFallback = (path: string): boolean => {
      if (cancelled || !path) return false;
      if (path.replace(/\\/g, '/').replace(/\/+$/, '') === cwd.replace(/\\/g, '/').replace(/\/+$/, '')) return false;
      originalCwdRef.current = cwd;
      setUsingFallback(true);
      void setRoot(path);
      return true;
    };
    // 候选①：用户主目录（后端 system.home；查询失败 → 维持报错+3s 重试）
    call('system_home')
      .then((d) => {
        if (cancelled) return;
        const home = (d as { home?: string | null })?.home?.trim() || '';
        if (home) tryFallback(home);
      })
      .catch(() => { /* 查询失败 → 维持报错+3s 重试 */ });
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
    // 🔴 remote 模式：原生 dialog 选的是本地路径，files.list 读远程必然失败——
    // 走 FolderPickerDialog（远程浏览，对齐 Hermes selectDesktopPaths remote → remotePicker）
    if (isDesktop() && !isFsRemoteMode()) {
      const sel = await pickDirectory('选择工作目录', rootPath || undefined);
      if (sel) {
        await setRoot(sel);
        // 🔴 2026-08-09 对齐 Hermes use-cwd-actions：切换目录必须持久化（后端烙印），
        //   只 setRoot 改显示 → 重启/重连后 resolve 回弹（既有断线）
        onCwdChange?.(sel);
      }
    } else {
      setPickerOpen(true);
    }
  }, [setRoot, onCwdChange, rootPath]);

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
  const [deletingEntry, setDeletingEntry] = useState<FlatRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const handleDeleteRequest = useCallback((entry: FlatRow) => setDeletingEntry(entry), []);
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

      {/* 文件树 — 虚拟滚动（对齐 Hermes react-arborist：固定行高 22 + overscan，
          只渲染可视窗口行；ErrorBoundary key=rootPath 对齐 Hermes FileTreeBody key=cwd） */}
      {data && !error && (
        <ErrorBoundary key={rootPath ?? ''}>
        <div
          ref={setScrollEl}
          className="flex-1 overflow-y-auto"
          tabIndex={-1}
          onKeyDown={handleTreeKeyDown}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {flatList.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-muted-foreground gap-2">
              <Folder size={24} className="text-muted-foreground/30" />
              <p className="text-xs">空目录</p>
            </div>
          ) : (
            <div style={{ height: flatList.length * ROW_HEIGHT, position: 'relative' }}>
              {visibleRows.map((row, i) => (
                <div
                  key={row.key}
                  style={{
                    position: 'absolute',
                    top: (scrollStart + i) * ROW_HEIGHT,
                    left: 0,
                    right: 0,
                    height: ROW_HEIGHT,
                  }}
                >
                  <FileRow
                    row={row}
                    isOpen={!!openState[row.path]}
                    selected={selectedPath === row.path}
                    renaming={renamingPath === row.path}
                    statusKind={statusKindForPath(row.path)}
                    rootPath={rootPath ?? ''}
                    onSelect={handleSelectFile}
                    onAttach={onFileAttach ?? (() => {})}
                    onPreview={handleFileDoubleClick}
                    onToggleDir={handleToggleDir}
                    onReveal={handleReveal}
                    onCopyText={handleCopyText}
                    onRenameRequest={handleRenameRequest}
                    onRenameCommit={handleRenameCommit}
                    onRenameCancel={handleRenameCancel}
                    onDeleteRequest={handleDeleteRequest}
                  />
                </div>
              ))}
            </div>
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
          // 🔴 2026-08-09：remote 模式切换同样持久化（Hermes RemoteFolderPicker 同款）
          onCwdChange?.(p);
        }}
      />
    </div>
  );
}
