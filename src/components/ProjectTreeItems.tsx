/**
 * ProjectTreeItems — 项目树行组件 + 会话行组件 + 树工具函数
 *
 * 🔴 2026-08-13 Phase 2 拆分（施工方案_文件事件下沉与前端减负）：
 *   从 ProjectTreePanel.tsx 纯移动抽取（diff 无逻辑变更）。只拆组织，不动状态归属——
 *   行组件全部 props 驱动，无平行状态源。
 */
import { memo, useState, Fragment } from 'react';
import { ChevronRight, ChevronDown, FolderGit, GitBranch, FolderOpen, Blocks, MessageSquare, MoreVertical, Pencil, FolderPlus, Copy, Trash2, Home, Pin, Download, Archive, Undo2, Minimize2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { projectIconFor } from '../lib/project-icons';
import { useWorkspaceNodeOpen } from '../lib/sidebar-node-open';
import { exportSessionAction, copySessionId } from '../lib/session-actions';
import * as storage from '../utils/storage';
import { SessionStatusDot } from './SessionStatusDot';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from './ui/context-menu';

export interface SessionPreview {
  id: string;
  title?: string;
  lastActive: number;
  startedAt: number;
  model?: string;
  messageCount: number;
}

export interface LaneGroup {
  id: string;
  label: string;
  path: string;
  isMain: boolean;
  isKanban: boolean;
  sessions: SessionPreview[];
}

export interface RepoNode {
  id: string;
  label: string;
  path: string;
  sessionCount: number;
  groups: LaneGroup[];
}

export interface ProjectNode {
  id: string;
  label: string;
  path?: string;
  color?: string;
  icon?: string;
  isAuto: boolean;
  /** Home 桶（对齐 Hermes isNoProject：无归属且无 repo 的 detached 会话；恒首、无操作） */
  isNoProject?: boolean;
  sessionCount: number;
  lastActive: number;
  repos: RepoNode[];
  previewSessions: SessionPreview[];
}

export interface TreeResult {
  projects: ProjectNode[];
  scoped_session_ids: string[];
  /** 激活项目 id（projects.tree 返回，对齐 Hermes active_id） */
  active_id?: string | null;
}

// ── Props ──

export interface ProjectTreePanelProps {
  sessionId?: string;
  /** 🔴 2026-08-12 树自动刷新信号（App 会话列表版本号）：新建会话/切会话/发消息后 bump →
   *   静默重拉 projects.tree（预览会话/计数/时间即时回显，老大需求：缺自动刷新机制） */
  sessionListVersion?: number;
  onSwitchSession?: (id: string) => void;
  /** 当前活动 Agent（SidePanel 透传）——🔴 所有 projects.* RPC 显式携带，
   *  不依赖 sendRpc 全局盖章（宫格焦点冒泡时序坑，对齐 ClarifyCard 显式归属模式） */
  currentProfile?: string;
  /** 🔴 2026-08-12 老大指示：项目行不再有"新建会话"按钮（新建统一走全局新建/ /new，
   *   自动绑定选中项目 scope）。onNewSessionInProject 保留仅 worktree 创建成功后的自动建会话 */
  onNewSessionInProject?: (cwd: string) => void;
  /** 🔴 2026-08-09 进入项目（对齐 Hermes onEnterProject → syncProjectCwd + enterProject）：
   *  点击项目行钻取时把右侧文件面板切到项目根目录（Hermes syncProjectCwd 同款：
   *  setCurrentCwd(项目 root)，前端临时显示，后续 session.info 覆盖回会话绑定值）；
   *  path 为空（Home 桶）不调用。
   *  🔴 2026-08-12 扩展：第二参 = 后端分组的最活跃会话 id（previewSessions[0]，
   *  权威分组——HOME=unowned 全集/项目=该项目域；消息区联动直接切，无则空态新建） */
  onEnterProject?: (path: string, sessionId?: string | null) => void;
  /** 🔴 2026-08-13 问题2修复：会话行点击 → 项目域 scope 同步（App setProjectScopeCwd）。
   *  高亮由本组件内部 setSelectedId + projects.set_active 完成；不触发 onEnterProject
   *  （防消息区联动把刚点的会话切回项目最新会话）。文件面板不强制切项目根——
   *  跟随该会话 session.info 的 bound_cwd（符合"文件树=会话 cwd"）。 */
  onProjectScopeChange?: (path: string | null) => void;
  /** 🔴 2026-08-13 切 Agent 恢复激活项目（老大反馈：切 Agent 后项目选中态来自后端
   *  active_id，但 scope/文件面板被切 Agent 清空 → 右侧抽屉"未打开项目"，必须再点一次）。
   *  切 Agent 后的首次树加载，若该 Agent 有 active 项目且用户未手动点选 → 恢复
   *  scope + 文件面板到激活项目根（不动消息区——会话指针恢复由 handleProfileChange 管）。 */
  onProjectScopeRestored?: (path: string) => void;
}

function fmtTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 写 IDEA.md 到项目主文件夹（对齐 Hermes writeProjectIdea；best-effort，失败静默） */
export async function writeProjectIdea(folder: string, idea: string): Promise<void> {
  const body = idea.trim();
  if (!folder.trim() || !body) return;
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const dir = folder.replace(/[\\/]+$/, '');
    await writeTextFile(`${dir}/IDEA.md`, body.endsWith('\n') ? body : `${body}\n`);
  } catch {
    // best-effort：项目创建不受 IDEA.md 落盘影响（对齐 Hermes 注释）
  }
}

// ── 可折叠树节点 ──

function TreeToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <span
      className="shrink-0 text-muted-foreground cursor-pointer hover:text-foreground"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </span>
  );
}

// ── 会话行操作规格（对齐 Hermes session-actions：kebab 与右键共享；Panel 层单一构造）
// 🔴 2026-08-12 对齐 SessionsPanel：补 撤销上一轮/压缩上下文/分支会话/用量详情（undo/compress/branch/usage）
export interface SessionRowActions {
  profile?: string;
  onRenameRequest: (s: SessionPreview) => void;
  onDeleted: (s: SessionPreview) => void;
  isPinned: (s: SessionPreview) => boolean;
  onTogglePin: (s: SessionPreview) => void;
  isArchived: (s: SessionPreview) => boolean;
  onToggleArchive: (s: SessionPreview) => void;
  onUndo: (id: string) => void;
  onCompress: (id: string) => void;
  onBranch: (id: string) => void;
  onUsage: (id: string) => void;
}

// pin 状态与 SessionsPanel 共用同一 localStorage（eleve.pinned-sessions）
const PINNED_KEY = 'eleve.pinned-sessions';

export function loadPinnedIds(): Set<string> {
  try {
    const v: unknown = storage.load(PINNED_KEY);
    return new Set(v ? JSON.parse(v as string) : []);
  } catch {
    return new Set();
  }
}

export function savePinnedIds(ids: Set<string>): void {
  try {
    storage.save(PINNED_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

const SessionItem = memo(function SessionItem({ s, isActive, onClick, actions, rowClassName }: {
  s: SessionPreview;
  isActive: boolean;
  onClick: () => void;
  actions: SessionRowActions;
  /** 🔴 2026-08-12 卡片化：项目预览会话在卡片内展开时覆盖缩进/hover（树内保持 pl-8） */
  rowClassName?: string;
}) {
  const title = s.title || s.id.slice(0, 8);
  const isPinned = actions.isPinned(s);

  // 对齐 Hermes session-actions-menu：身份（重命名·置顶·归档）/ 会话操作
  // （撤销·压缩·分支·用量）/ 分享（导出·复制ID）/ 危险（删除）
  // 🔴 2026-08-12："在新视图中打开/在新窗口中打开"已从菜单移除——自动语义 =
  //   点击项目/HOME 时自动选该域最新会话（App.handleProjectEntered 联动），
  //   会话行点击一律普通切换（非"运行中自动新视图"，老大纠正）
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => e.stopPropagation()}
          title="会话操作"
        >
          <MoreVertical size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem disabled={!s.id} onSelect={() => actions.onRenameRequest(s)}>
          <Pencil size={12} className="shrink-0" />
          <span className="flex-1">重命名</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.id} onSelect={() => actions.onTogglePin(s)}>
          <Pin size={12} className="shrink-0" />
          <span className="flex-1">{isPinned ? '取消置顶' : '置顶'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.id} onSelect={() => void actions.onToggleArchive(s)}>
          <Archive size={12} className="shrink-0" />
          <span className="flex-1">{actions.isArchived(s) ? '取消归档' : '归档'}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!s.id} onSelect={() => void actions.onUndo(s.id)}>
          <Undo2 size={12} className="shrink-0" />
          <span className="flex-1">撤销上一轮</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.id} onSelect={() => void actions.onCompress(s.id)}>
          <Minimize2 size={12} className="shrink-0" />
          <span className="flex-1">压缩上下文</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.id} onSelect={() => void actions.onBranch(s.id)}>
          <GitBranch size={12} className="shrink-0" />
          <span className="flex-1">分支会话</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.id} onSelect={() => void actions.onUsage(s.id)}>
          <BarChart3 size={12} className="shrink-0" />
          <span className="flex-1">用量详情</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!s.id} onSelect={() => void exportSessionAction(s.id, title)}>
          <Download size={12} className="shrink-0" />
          <span className="flex-1">导出会话</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!s.id} onSelect={() => void copySessionId(s.id)}>
          <Copy size={12} className="shrink-0" />
          <span className="flex-1">复制会话 ID</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={!s.id} onSelect={() => actions.onDeleted(s)}>
          <Trash2 size={12} className="shrink-0" />
          <span className="flex-1">删除</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const row = (
    <div
      className={cn(
        'flex items-center gap-2 pl-8 pr-3 py-1 cursor-pointer text-xs hover:bg-accent/40 transition-colors group/row rounded-md',
        isActive && 'bg-accent/30',
        rowClassName,
      )}
      // 🔴 2026-08-12 冒泡修复：会话行点击必须 stopPropagation——否则冒泡到项目卡片
      //   onClick（onActivate）触发 onEnterProject 联动，把刚点的会话切回项目最新会话
      //   （症状：点击行消息区被覆盖/颜色不显示，只能钻取内点才生效）
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <SessionStatusDot sessionId={s.id} dotClassName={isActive ? '!bg-accent-orange' : undefined} />
      {/* 🔴 2026-08-12 老大：选中会话行图标变橙色（区分当前消息） */}
      <MessageSquare size={12} className={cn('shrink-0', isActive ? 'text-accent-orange' : 'text-muted-foreground')} />
      <span className={cn('truncate flex-1', isActive && 'text-accent-orange')}>{title}</span>
      {isPinned && <Pin size={10} className="shrink-0 text-muted-foreground/50" />}
      <span className="text-[10px] text-muted-foreground shrink-0">{fmtTime(s.lastActive || s.startedAt)}</span>
      {menu}
    </div>
  );

  // 右键菜单与 kebab 同款（对齐 Hermes SessionContextMenu）
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()} className="w-48">
        <ContextMenuItem disabled={!s.id} onSelect={() => actions.onRenameRequest(s)}>
          <Pencil size={12} className="shrink-0" />
          <span className="flex-1">重命名</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.id} onSelect={() => actions.onTogglePin(s)}>
          <Pin size={12} className="shrink-0" />
          <span className="flex-1">{isPinned ? '取消置顶' : '置顶'}</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.id} onSelect={() => void actions.onToggleArchive(s)}>
          <Archive size={12} className="shrink-0" />
          <span className="flex-1">{actions.isArchived(s) ? '取消归档' : '归档'}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!s.id} onSelect={() => void actions.onUndo(s.id)}>
          <Undo2 size={12} className="shrink-0" />
          <span className="flex-1">撤销上一轮</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.id} onSelect={() => void actions.onCompress(s.id)}>
          <Minimize2 size={12} className="shrink-0" />
          <span className="flex-1">压缩上下文</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.id} onSelect={() => void actions.onBranch(s.id)}>
          <GitBranch size={12} className="shrink-0" />
          <span className="flex-1">分支会话</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.id} onSelect={() => void actions.onUsage(s.id)}>
          <BarChart3 size={12} className="shrink-0" />
          <span className="flex-1">用量详情</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!s.id} onSelect={() => void exportSessionAction(s.id, title)}>
          <Download size={12} className="shrink-0" />
          <span className="flex-1">导出会话</span>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s.id} onSelect={() => void copySessionId(s.id)}>
          <Copy size={12} className="shrink-0" />
          <span className="flex-1">复制会话 ID</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" disabled={!s.id} onSelect={() => actions.onDeleted(s)}>
          <Trash2 size={12} className="shrink-0" />
          <span className="flex-1">删除</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

// lane 会话分页（对齐 Hermes SIDEBAR_GROUP_PAGE=5：已加载行分批显示）
const SHOW_MORE_PAGE = 5;

const LaneNode = memo(function LaneNode({ lane, sessionId, onSwitchSession, onSessionRowActivate, onReveal, onCopyPath, onRemoveWorktree, sessionActions }: { lane: LaneGroup; sessionId?: string; onSwitchSession?: (id: string) => void; /** 🔴 2026-08-13 问题2：会话行点击 → 所属项目域激活 */ onSessionRowActivate?: () => void; onReveal?: (path: string) => void; onCopyPath?: (path: string) => void; onRemoveWorktree?: (lane: LaneGroup) => void; sessionActions: SessionRowActions }) {
  // 展开状态持久化（对齐 Hermes useWorkspaceNodeOpen；lane 默认折叠）
  const [expanded, toggleExpanded] = useWorkspaceNodeOpen(lane.id, false);
  // 会话分页：初始 5 条，点「显示更多」+5（对齐 Hermes WorkspaceShowMoreButton）
  const [visibleCount, setVisibleCount] = useState(SHOW_MORE_PAGE);
  const hasSessions = lane.sessions.length > 0;
  // 仅 linked worktree lane 可移除（主检出/kanban 聚合无单一目标；对齐 Hermes WorkspaceMenu）
  const removable = !lane.isMain && !lane.isKanban && !!lane.path && !!onRemoveWorktree;
  const visible = lane.sessions.slice(0, visibleCount);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 pl-6 pr-3 py-1 cursor-pointer hover:bg-accent/20 text-xs group/lane"
        onClick={() => { if (hasSessions) toggleExpanded(); setVisibleCount(SHOW_MORE_PAGE); }}
      >
        {hasSessions ? <TreeToggle expanded={expanded} onClick={() => { toggleExpanded(); setVisibleCount(SHOW_MORE_PAGE); }} /> : <span className="w-3.5" />}
        {lane.isKanban ? <Blocks size={12} className="text-info" /> : <GitBranch size={12} className="text-muted-foreground" />}
        <span className="truncate flex-1" title={lane.path || lane.label}>{lane.label}</span>
        {lane.sessions.length > 0 && <span className="text-[10px] text-muted-foreground">{lane.sessions.length}</span>}
        {/* linked worktree 菜单（对齐 Hermes WorkspaceMenu：reveal/copy/移除） */}
        {removable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors opacity-0 group-hover/lane:opacity-100 data-[state=open]:opacity-100"
                onClick={(e) => e.stopPropagation()}
                title="工作区操作"
              >
                <MoreVertical size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled={!lane.path} onSelect={() => lane.path && onReveal?.(lane.path)}>
                <FolderOpen size={12} className="shrink-0" />
                <span className="flex-1">在文件管理器中显示</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!lane.path} onSelect={() => lane.path && onCopyPath?.(lane.path)}>
                <Copy size={12} className="shrink-0" />
                <span className="flex-1">复制路径</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onRemoveWorktree?.(lane)}>
                <Trash2 size={12} className="shrink-0" />
                <span className="flex-1">移除工作区…</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {expanded && visible.map(s => (
        <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => { onSessionRowActivate?.(); onSwitchSession?.(s.id); }} actions={sessionActions} />
      ))}
      {expanded && lane.sessions.length > visible.length && (
        <button
          className="ml-7 pl-2 pr-3 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setVisibleCount(c => c + SHOW_MORE_PAGE)}
        >
          显示更多（{lane.sessions.length - visible.length}）
        </button>
      )}
    </div>
  );
});

export const RepoNodeItem = memo(function RepoNodeItem({ repo, sessionId, onSwitchSession, onSessionRowActivate, onStartWork, onReveal, onCopyPath, onRemoveWorktree, lanes, sessionActions, defaultExpanded = false }: { repo: RepoNode; sessionId?: string; onSwitchSession?: (id: string) => void; /** 🔴 2026-08-13 问题2：会话行点击 → 所属项目域激活 */ onSessionRowActivate?: () => void; onStartWork?: (repoPath: string) => void; onReveal?: (path: string) => void; onCopyPath?: (path: string) => void; onRemoveWorktree?: (lane: LaneGroup) => void; /** 合并 git worktree 后的 lane 列表（对齐 Hermes mergeRepoWorktreeGroups 输出） */
  lanes: LaneGroup[]; sessionActions: SessionRowActions; defaultExpanded?: boolean }) {
  // 展开状态持久化（对齐 Hermes useWorkspaceNodeOpen；repo 默认展开）
  const [expanded, toggleExpanded] = useWorkspaceNodeOpen(repo.id, defaultExpanded);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 pl-4 pr-3 py-1 cursor-pointer hover:bg-accent/20 text-xs group/workspace"
        onClick={toggleExpanded}
      >
        <TreeToggle expanded={expanded} onClick={toggleExpanded} />
        <FolderGit size={13} className="text-muted-foreground shrink-0" />
        <span className="truncate flex-1 font-medium" title={repo.path}>{repo.label}</span>
        <span className="text-[10px] text-muted-foreground">{repo.sessionCount}</span>
        {/* 新建工作区（对齐 Hermes StartWorkButton：hover 显示 git-branch 图标） */}
        {onStartWork && repo.path && (
          <button
            className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors opacity-0 group-hover/workspace:opacity-100"
            onClick={(e) => { e.stopPropagation(); onStartWork(repo.path); }}
            title={`在「${repo.label}」新建工作区（worktree）`}
          >
            <GitBranch size={12} />
          </button>
        )}
      </div>
      {expanded && lanes.map(g => (
        <LaneNode key={g.id} lane={g} sessionId={sessionId} onSwitchSession={onSwitchSession} onSessionRowActivate={onSessionRowActivate} onReveal={onReveal} onCopyPath={onCopyPath} onRemoveWorktree={onRemoveWorktree} sessionActions={sessionActions} />
      ))}
    </div>
  );
});

// 项目行前置图标（对齐 Hermes projectIcon）：icon → 图标（color 着色）；
// 无 icon 有 color → 纯色点；Home 桶 → home 图标；都无 → 默认 folder-library 图标
// 🔴 2026-08-12 老大：项目卡片选中态不再反白（选中强调 = 描边+淡底+光环，图标恒本色）
function ProjectLeadIcon({ project }: { project: ProjectNode }) {
  if (project.color && !project.icon) {
    // 纯色点项目：恒原色点（muted 色块上）
    return <div className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color }} />;
  }
  if (project.isNoProject) {
    return <Home size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  const Icon = projectIconFor(project.icon);
  return (
    <Icon
      size={13}
      strokeWidth={1.75}
      className={cn('shrink-0', !project.color && 'text-muted-foreground')}
      style={project.color ? { color: project.color } : undefined}
    />
  );
}

// ── 项目菜单规格（对齐 Hermes useProjectActions：kebab 与右键共享同一套 action）──
// 显式项目：设激活/编辑/加文件夹 + reveal/复制路径 + 删除（确认）
// 自动项目：编辑(=收养，Hermes appearance adopt 语义) + reveal/复制路径 + 从侧边栏移除(dismiss)
export interface ProjectMenuSpec {
  key: string;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

function projectMenuSpecs(project: ProjectNode, h: {
  onSetActive: (p: ProjectNode) => void;
  onEdit: (p: ProjectNode) => void;
  onAddFolder: (p: ProjectNode) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  onDelete: (p: ProjectNode) => void;
  onDismiss: (p: ProjectNode) => void;
  isActiveProject: boolean;
  desktop: boolean;
}): ProjectMenuSpec[] {
  const path = project.path || '';
  const reveal = {
    key: 'reveal',
    icon: <FolderOpen size={12} className="shrink-0" />,
    label: '在文件管理器中显示',
    disabled: !path || !h.desktop,
    onSelect: () => h.onReveal(path),
  };
  const copy = {
    key: 'copy',
    icon: <Copy size={12} className="shrink-0" />,
    label: '复制路径',
    disabled: !path,
    onSelect: () => h.onCopyPath(path),
  };

  if (project.isAuto) {
    // 自动项目：编辑 = 收养成显式项目（Hermes setProjectAppearance adopt）
    return [
      {
        key: 'adopt',
        icon: <Pencil size={12} className="shrink-0" />,
        label: project.path ? '编辑外观/名称（设为显式项目）' : '编辑外观/名称',
        disabled: !project.path,
        onSelect: () => h.onEdit(project),
      },
      reveal,
      copy,
      {
        key: 'dismiss',
        icon: <Trash2 size={12} className="shrink-0" />,
        label: '从侧边栏移除',
        danger: true,
        onSelect: () => h.onDismiss(project),
      },
    ];
  }

  if (project.isNoProject) {
    // Home 桶 = 兜底默认项目（老大 2026-08-12：单击已自动激活，菜单不再放"设为激活"）：
    //   编辑外观/添加文件夹 全部走后端真功能（__no_project__ 记录持久化）；无删除。
    return [
      {
        key: 'edit',
        icon: <Pencil size={12} className="shrink-0" />,
        label: '编辑名称/颜色/图标',
        disabled: !h.desktop,
        onSelect: () => h.onEdit(project),
      },
      {
        key: 'add-folder',
        icon: <FolderPlus size={12} className="shrink-0" />,
        label: h.desktop ? '添加文件夹' : '添加文件夹（仅桌面端）',
        disabled: !h.desktop,
        onSelect: () => h.onAddFolder(project),
      },
      reveal,
      copy,
    ];
  }

  return [
    {
      key: 'edit',
      icon: <Pencil size={12} className="shrink-0" />,
      label: '编辑名称/颜色/图标',
      onSelect: () => h.onEdit(project),
    },
    {
      key: 'add-folder',
      icon: <FolderPlus size={12} className="shrink-0" />,
      label: h.desktop ? '添加文件夹' : '添加文件夹（仅桌面端）',
      disabled: !h.desktop,
      onSelect: () => h.onAddFolder(project),
    },
    reveal,
    copy,
    {
      key: 'delete',
      icon: <Trash2 size={12} className="shrink-0" />,
      label: '删除…',
      danger: true,
      onSelect: () => h.onDelete(project),
    },
  ];
}

export const ProjectItem = memo(function ProjectItem({ project, sessionId, onSwitchSession, onSessionRowActivate, onDrill, onActivate, onEdit, onAddFolder, onSetActive, onReveal, onCopyPath, onDelete, onDismiss, isActiveProject, desktop, sessionActions, isDragging, isDragOver, onRowDragStart, onRowDragOver, onRowDrop, onRowDragEnd }: {
  project: ProjectNode;
  sessionId?: string;
  onSwitchSession?: (id: string) => void;
  /** 钻取：双击进入项目（完整 Repo/Lane 树） */
  onDrill: (p: ProjectNode) => void;
  /** 🔴 2026-08-12：单击激活（与 Agent 联动：文件面板 + scope + 消息区选最新会话） */
  onActivate: (p: ProjectNode) => void;
  onEdit: (p: ProjectNode) => void;
  onAddFolder: (p: ProjectNode) => void;
  onSetActive: (p: ProjectNode) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  onDelete: (p: ProjectNode) => void;
  onDismiss: (p: ProjectNode) => void;
  isActiveProject: boolean;
  desktop: boolean;
  sessionActions: SessionRowActions;
  // ── 拖拽排序（对齐 Hermes reorderable overview-row）──
  isDragging?: boolean;
  isDragOver?: boolean;
  onRowDragStart?: (id: string) => void;
  onRowDragOver?: (id: string) => void;
  onRowDrop?: (id: string) => void;
  onRowDragEnd?: () => void;
  /** 🔴 2026-08-13 问题2：会话行点击 → 所属项目域激活 */
  onSessionRowActivate?: (project: ProjectNode) => void;
}) {
  // 展开状态持久化（对齐 Hermes useWorkspaceNodeOpen；项目行默认展开）
  const [expanded, toggleExpanded] = useWorkspaceNodeOpen(project.id, true);
  const previews = project.previewSessions ?? [];
  const specs = projectMenuSpecs(project, { onSetActive, onEdit, onAddFolder, onReveal, onCopyPath, onDelete, onDismiss, isActiveProject, desktop });
  const path = project.path || '';

  const kebab = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors opacity-0 group-hover/workspace:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => e.stopPropagation()}
          title="项目管理"
        >
          <MoreVertical size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {specs.map((s) => (
          <Fragment key={s.key}>
            {(s.key === 'reveal' || s.key === 'dismiss' || s.key === 'delete') && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled={s.disabled} onSelect={s.onSelect} className={s.danger ? 'text-destructive focus:text-destructive' : undefined}>
              {s.icon}
              <span className="flex-1">{s.label}</span>
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // 🔴 2026-08-12 卡片统一（老大拍板：统一统一统一）：
  //   所有项目卡片（显式/自动/新建/Home）与 Agent 卡片同一形态、全走主题：
  //   描边 = primary 30%（选中/未选中一致）；选中 = primary 10% 淡底 + 发光竖条
  //   + primary 实底圆点白勾（= "给了颜色"样式，无 color 用主题 primary）。
  //   项目自定义色仅保留在图标/色点着色（点缀）。
  const row = (
    <div
      className={cn(
        'group/workspace relative w-full text-left px-2.5 py-2 rounded-lg border bg-card shadow-sm transition-all duration-150 cursor-pointer hover:bg-accent/30',
        isDragging && 'opacity-40',
        isDragOver && 'bg-accent/30',
      )}
      style={{
        // 描边 = 主题 primary 30% 透明混合（选中/未选中一致；与 Agent 卡片同构）
        borderColor: 'color-mix(in srgb, var(--dt-primary) 30%, transparent)',
        // 选中态背景 = primary 10% 透明混合（未选中保持 bg-card）
        background: isActiveProject ? 'color-mix(in srgb, var(--dt-primary) 10%, var(--ui-card-bg))' : undefined,
        // 🔴 选中态背投影（对齐宫格卡片逻辑：细光环 + 明显投影；侧栏卡片小，光环 1px 不显粗）
        boxShadow: isActiveProject
          ? '0 0 0 1px color-mix(in srgb, var(--dt-primary) 45%, transparent), 0 6px 18px var(--theme-shadow-color-heavy)'
          : undefined,
      } as React.CSSProperties}
      onClick={() => onActivate(project)}
      onDoubleClick={() => onDrill(project)}
      draggable={!!onRowDragStart && !project.isNoProject}
      onDragStart={(e) => { if (onRowDragStart) { e.dataTransfer.effectAllowed = 'move'; onRowDragStart(project.id); } }}
      onDragOver={(e) => { if (onRowDragOver) { e.preventDefault(); onRowDragOver(project.id); } }}
      onDrop={(e) => { if (onRowDrop) { e.preventDefault(); onRowDrop(project.id); } }}
      onDragEnd={onRowDragEnd}
      title={path && !project.isNoProject ? `${path} — 单击激活（联动消息区/文件面板）· 双击进入项目` : project.isNoProject ? (path ? `${path} — 单击激活 · 双击进入工作区` : '单击激活 · 双击进入工作区') : '单击激活 · 双击进入项目'}
    >
      {/* 选中发光竖条（主题 primary；与 Agent 卡片同款） */}
      {isActiveProject && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
          style={{
            background: 'var(--dt-primary)',
            boxShadow: '0 0 8px color-mix(in srgb, var(--dt-primary) 65%, transparent)',
          }}
        />
      )}
      {/* 名称行 */}
      <div className="flex items-center gap-1.5">
        <TreeToggle expanded={expanded} onClick={toggleExpanded} />
        {/* 项目图标色块：恒主题淡底（选中不再实底反白——老大 2026-08-12） */}
        <div className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 overflow-hidden transition-all duration-150 bg-muted/40">
          <ProjectLeadIcon project={project} />
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">{project.label}</span>
        {/* 会话数/时间：Home 桶不显示（老大 2026-08-12：取消 Home 卡片计数和时间） */}
        {!project.isNoProject && project.sessionCount > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{project.sessionCount}</span>
        )}
        {!project.isNoProject && (
          <span className="text-[10px] text-muted-foreground/50">{fmtTime(project.lastActive)}</span>
        )}
        {/* 🔴 2026-08-12 移除：项目行"在该项目新建会话"按钮（新建统一走全局新建按钮/ /new，
            自动绑定选中项目 scope） */}
        {specs.length > 0 && kebab}
      </div>
      {/* 预览会话（卡片内展开，border-t 分隔；对齐 Hermes PROJECT_PREVIEW_COUNT Top3） */}
      {expanded && (
        <div className="mt-1 border-t border-border/40 pt-0.5">
          {previews.length > 0 ? (
            previews.map(s => (
              <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => { onSessionRowActivate?.(project); onSwitchSession?.(s.id); }} actions={sessionActions} rowClassName="pl-6 rounded-md hover:bg-accent/30" />
            ))
          ) : (
            <div className="pl-6 pr-1 py-1 text-[10px] text-muted-foreground/50">暂无会话</div>
          )}
        </div>
      )}
    </div>
  );

  if (!specs.length) {
    // Home 桶：无右键菜单（对齐 Hermes：isNoProject 无 ProjectContextMenu）
    return row;
  }

  // 右键菜单（对齐 Hermes ProjectContextMenu：与 kebab 同 action）
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()} className="w-52">
        {specs.map((s) => (
          <Fragment key={s.key}>
            {(s.key === 'reveal' || s.key === 'dismiss' || s.key === 'delete') && <ContextMenuSeparator />}
            <ContextMenuItem
              disabled={s.disabled}
              onSelect={s.onSelect}
              className={s.danger ? 'text-destructive focus:text-destructive' : undefined}
            >
              {s.icon}
              <span className="flex-1">{s.label}</span>
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});

// ── 项目新建/编辑对话框（显式项目管理，接线后端 projects CRUD）──
