/**
 * ProjectTreePanel — Hermes 对齐两阶段项目树
 *
 * 阶段一·总览（projects.tree，hydrate=false）：项目行 + previewSessions（每项目 Top3 最近会话）。
 *   🔴 总览模式后端 lane.sessions 恒为空（hydrate=false → sessions.clear()），
 *   previewSessions 是唯一会话数据——对齐 Hermes sidebar 总览（PROJECT_PREVIEW_COUNT=3）。
 * 阶段二·钻取（projects.project_sessions，hydrate=true）：点击项目行 → 全量水合
 *   Repo → Lane → Session 树——对齐 Hermes drill-in。
 *
 * 交互：点击会话行切换会话；点击项目行钻取；chevron 展开/收起预览。
 * 管理：显式项目可新建/编辑（名称+主题色）/添加文件夹/归档——接线后端
 *   projects.create/update/add_folder/set_primary/archive CRUD（对齐 Hermes 桌面端项目管理）。
 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { ChevronRight, ChevronDown, FolderGit, GitBranch, FolderOpen, Blocks, MessageSquare, RefreshCw, Plus, MoreVertical, Pencil, FolderPlus, CheckCircle2, Copy, Trash2, Home, Pin, Download, Archive, Undo2, Minimize2, BarChart3 } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { getWsClient } from '../services/ws-client';
import { AGENT_PALETTE } from '../lib/agent-palette';
import { PROJECT_ICON_KEYS, projectIconFor } from '../lib/project-icons';
import { getDismissedAutoProjectIds, dismissAutoProject } from '../lib/dismissed-projects';
import { mergeWorktreeLanes } from '../lib/worktree-lanes';
import { getDismissedWorktrees, dismissWorktree } from '../lib/dismissed-worktrees';
import { useWorkspaceNodeOpen } from '../lib/sidebar-node-open';
import { getProjectOrderIds, setProjectOrderIds, orderProjectsByIds } from '../lib/project-order';
import { randomIdeaTemplates, type ProjectIdeaTemplate } from '../lib/project-idea-templates';
import { generateProjectIdea } from '../lib/llm-oneshot';
import { deleteSessionAction, renameSessionAction, toggleArchiveSession, exportSessionAction, copySessionId } from '../lib/session-actions';
import { undoSessionTurn, compressSession, branchSession, getSessionUsage } from '../utils/api';
import * as storage from '../utils/storage';
import { gitWorktreeList, gitWorktreeRemove, type HermesGitWorktree } from '../lib/git';
import { WorktreeDialog } from './worktree/WorktreeDialog';
import { pickDirectory } from '../utils/directory-picker';
import { notifySuccess, notifyError, notifyInfo } from '../utils/notifications';
import { SessionStatusDot } from './SessionStatusDot';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from './ui/context-menu';

// ── 类型定义（与后端 JSON 输出严格对齐）──

interface SessionPreview {
  id: string;
  title?: string;
  lastActive: number;
  startedAt: number;
  model?: string;
  messageCount: number;
}

interface LaneGroup {
  id: string;
  label: string;
  path: string;
  isMain: boolean;
  isKanban: boolean;
  sessions: SessionPreview[];
}

interface RepoNode {
  id: string;
  label: string;
  path: string;
  sessionCount: number;
  groups: LaneGroup[];
}

interface ProjectNode {
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

interface TreeResult {
  projects: ProjectNode[];
  scoped_session_ids: string[];
  /** 激活项目 id（projects.tree 返回，对齐 Hermes active_id） */
  active_id?: string | null;
}

// ── Props ──

interface ProjectTreePanelProps {
  sessionId?: string;
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
}

// ── 辅助 ──

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
async function writeProjectIdea(folder: string, idea: string): Promise<void> {
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
interface SessionRowActions {
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

function loadPinnedIds(): Set<string> {
  try {
    const v: unknown = storage.load(PINNED_KEY);
    return new Set(v ? JSON.parse(v as string) : []);
  } catch {
    return new Set();
  }
}

function savePinnedIds(ids: Set<string>): void {
  try {
    storage.save(PINNED_KEY, JSON.stringify([...ids]));
  } catch { /* ignore */ }
}

function SessionItem({ s, isActive, onClick, actions }: {
  s: SessionPreview;
  isActive: boolean;
  onClick: () => void;
  actions: SessionRowActions;
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
        'flex items-center gap-2 pl-8 pr-3 py-1 cursor-pointer text-xs hover:bg-accent/40 transition-colors group/row',
        isActive && 'bg-accent/30'
      )}
      onClick={onClick}
    >
      <SessionStatusDot sessionId={s.id} />
      <MessageSquare size={12} className="text-muted-foreground shrink-0" />
      <span className="truncate flex-1">{title}</span>
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
}

// lane 会话分页（对齐 Hermes SIDEBAR_GROUP_PAGE=5：已加载行分批显示）
const SHOW_MORE_PAGE = 5;

function LaneNode({ lane, sessionId, onSwitchSession, onReveal, onCopyPath, onRemoveWorktree, sessionActions }: { lane: LaneGroup; sessionId?: string; onSwitchSession?: (id: string) => void; onReveal?: (path: string) => void; onCopyPath?: (path: string) => void; onRemoveWorktree?: (lane: LaneGroup) => void; sessionActions: SessionRowActions }) {
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
        <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => onSwitchSession?.(s.id)} actions={sessionActions} />
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
}

function RepoNodeItem({ repo, sessionId, onSwitchSession, onStartWork, onReveal, onCopyPath, onRemoveWorktree, lanes, sessionActions, defaultExpanded = false }: { repo: RepoNode; sessionId?: string; onSwitchSession?: (id: string) => void; onStartWork?: (repoPath: string) => void; onReveal?: (path: string) => void; onCopyPath?: (path: string) => void; onRemoveWorktree?: (lane: LaneGroup) => void; /** 合并 git worktree 后的 lane 列表（对齐 Hermes mergeRepoWorktreeGroups 输出） */
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
        <LaneNode key={g.id} lane={g} sessionId={sessionId} onSwitchSession={onSwitchSession} onReveal={onReveal} onCopyPath={onCopyPath} onRemoveWorktree={onRemoveWorktree} sessionActions={sessionActions} />
      ))}
    </div>
  );
}

// 项目行前置图标（对齐 Hermes projectIcon）：icon → 图标（color 着色）；
// 无 icon 有 color → 纯色点；Home 桶 → home 图标；都无 → 默认 folder-library 图标
function ProjectLeadIcon({ project }: { project: ProjectNode }) {
  if (project.color && !project.icon) {
    return <div className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color }} />;
  }
  if (project.isNoProject) {
    return <Home size={14} className="shrink-0 text-muted-foreground" />;
  }
  const Icon = projectIconFor(project.icon);
  return (
    <Icon
      size={14}
      className="shrink-0"
      style={project.color ? { color: project.color } : undefined}
    />
  );
}

// ── 项目菜单规格（对齐 Hermes useProjectActions：kebab 与右键共享同一套 action）──
// 显式项目：设激活/编辑/加文件夹 + reveal/复制路径 + 删除（确认）
// 自动项目：编辑(=收养，Hermes appearance adopt 语义) + reveal/复制路径 + 从侧边栏移除(dismiss)
interface ProjectMenuSpec {
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
    // Home 桶：无记录可操作（对齐 Hermes：Home 无 per-project actions/右键菜单）
    return [];
  }

  return [
    {
      key: 'set-active',
      icon: <CheckCircle2 size={12} className="shrink-0" />,
      label: h.isActiveProject ? '当前激活项目' : '设为激活项目',
      disabled: h.isActiveProject,
      onSelect: () => h.onSetActive(project),
    },
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

function ProjectItem({ project, sessionId, onSwitchSession, onDrill, onActivate, onEdit, onAddFolder, onSetActive, onReveal, onCopyPath, onDelete, onDismiss, isActiveProject, desktop, sessionActions, isDragging, isDragOver, onRowDragStart, onRowDragOver, onRowDrop, onRowDragEnd }: {
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

  const row = (
    <div
      className={cn(
        'flex items-center gap-1.5 pl-3 pr-2 py-2 cursor-pointer hover:bg-accent/20 text-sm group/workspace transition-colors border-l-2 border-transparent',
        isActiveProject && 'bg-primary/[0.06] border-l-primary',
        isDragging && 'opacity-40',
        isDragOver && 'bg-accent/30',
      )}
      onClick={() => onActivate(project)}
      onDoubleClick={() => onDrill(project)}
      draggable={!!onRowDragStart && !project.isNoProject}
      onDragStart={(e) => { if (onRowDragStart) { e.dataTransfer.effectAllowed = 'move'; onRowDragStart(project.id); } }}
      onDragOver={(e) => { if (onRowDragOver) { e.preventDefault(); onRowDragOver(project.id); } }}
      onDrop={(e) => { if (onRowDrop) { e.preventDefault(); onRowDrop(project.id); } }}
      onDragEnd={onRowDragEnd}
      title={path && !project.isNoProject ? `${path} — 单击激活（联动消息区/文件面板）· 双击进入项目` : project.isNoProject ? (path ? `${path} — 单击激活 · 双击进入工作区` : '单击激活 · 双击进入工作区') : '单击激活 · 双击进入项目'}
    >
      <TreeToggle expanded={expanded} onClick={toggleExpanded} />
      <ProjectLeadIcon project={project} />
      <span className="truncate flex-1 font-medium">{project.label}</span>
      {/* 激活项目标记（对齐 Hermes overview-row isActive 高亮） */}
      {isActiveProject && (
        <span className="text-[9px] px-1 py-0.5 rounded bg-primary/15 text-primary shrink-0" title="当前激活项目">激活</span>
      )}
      {project.sessionCount > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{project.sessionCount}</span>
      )}
      <span className="text-[10px] text-muted-foreground/50">{fmtTime(project.lastActive)}</span>
      {/* 🔴 2026-08-12 移除：项目行"在该项目新建会话"按钮（新建统一走全局新建按钮/ /new，
          自动绑定选中项目 scope） */}
      {specs.length > 0 && kebab}
    </div>
  );

  if (!specs.length) {
    // Home 桶：无右键菜单（对齐 Hermes：isNoProject 无 ProjectContextMenu）
    return (
      <div className="border-b border-border/50">
        {row}
        {expanded && (previews.length > 0 ? (
          previews.map(s => (
            <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => onSwitchSession?.(s.id)} actions={sessionActions} />
          ))
        ) : (
          <div className="pl-8 pr-3 pb-1.5 text-[10px] text-muted-foreground/50">暂无会话</div>
        ))}
      </div>
    );
  }

  return (
    <div className="border-b border-border/50">
      {/* 右键菜单（对齐 Hermes ProjectContextMenu：与 kebab 同 action） */}
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
      {/* 总览预览：previewSessions（每项目 Top3 最近会话，对齐 Hermes PROJECT_PREVIEW_COUNT） */}
      {expanded && (previews.length > 0 ? (
        previews.map(s => (
          <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => onSwitchSession?.(s.id)} actions={sessionActions} />
        ))
      ) : (
        <div className="pl-8 pr-3 pb-1.5 text-[10px] text-muted-foreground/50">暂无会话</div>
      ))}
    </div>
  );
}

// ── 项目新建/编辑对话框（显式项目管理，接线后端 projects CRUD）──

function ProjectDialog({ open, initial, onClose, onSaved, profile }: {
  open: boolean;
  initial: ProjectNode | null; // null = 新建
  onClose: () => void;
  onSaved: () => void;
  /** 显式 profile：防多 Profile 串台 */
  profile?: string;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(AGENT_PALETTE[0]);
  const [icon, setIcon] = useState<string | null>(null);
  // 新建模式：多文件夹（对齐 Hermes project-dialog：folders 列表 + primary badge + 移除）；
  // 编辑模式：单主文件夹（folder，走 set_primary 更换）
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  // 项目 idea（对齐 Hermes project-dialog：textarea + 模板 chips + shuffle + AI 生成；
  // 仅新建模式；保存后 best-effort 写 IDEA.md 到主文件夹）
  const [idea, setIdea] = useState('');
  const [templates, setTemplates] = useState<ProjectIdeaTemplate[]>([]);
  const [generatingIdea, setGeneratingIdea] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    if (open) {
      setName(initial?.label ?? '');
      setColor(initial?.color || AGENT_PALETTE[0]);
      setIcon(initial?.icon ?? null);
      setFolders(initial?.path ? [initial.path] : []);
      setFolder(initial?.path ?? '');
      setIdea('');
      setTemplates(randomIdeaTemplates());
      setGeneratingIdea(false);
      setConfirmArchive(false);
    }
  }, [open, initial]);

  const pickFolder = useCallback(async () => {
    if (!desktop) { notifyError(null, '原生对话框仅桌面端可用'); return; }
    const path = await pickDirectory(initial ? '选择主文件夹' : '选择项目文件夹（可选）', initial?.path || undefined);
    if (!path) return;
    if (initial) {
      // 编辑模式：立即设为主文件夹（projects.set_primary）
      try {
        await call('projects_set_primary', { id: initial.id, path, profile });
        setFolder(path);
        setFolders([path]);
        notifySuccess('主文件夹已更新');
        onSaved();
      } catch (e) { notifyError(e, '更新文件夹失败'); }
    } else {
      // 新建模式：追加到多文件夹列表（去重；首个 = primary）
      setFolders(prev => (prev.includes(path) ? prev : [...prev, path]));
    }
  }, [desktop, initial, onSaved, profile]);

  const save = useCallback(async () => {
    if (!name.trim()) { notifyError(null, '请输入项目名称'); return; }
    setSaving(true);
    try {
      let savedFolder: string | undefined;
      if (initial && !initial.isAuto) {
        await call('projects_update', { id: initial.id, name: name.trim(), color, ...(icon ? { icon } : { icon: '' }), profile });
        notifySuccess('项目已更新');
      } else if (initial) {
        // 🔴 自动项目编辑 = 收养（对齐 Hermes setProjectAppearance adopt）：
        // 无 projects.db 记录 → create 带外观 + 主文件夹（repo root）
        await call('projects_create', {
          name: name.trim(),
          color,
          ...(icon ? { icon } : {}),
          ...(folder ? { folders: [folder], primary_path: folder } : {}),
          profile,
        });
        savedFolder = folder || undefined;
        notifySuccess('已设为显式项目');
      } else {
        await call('projects_create', {
          name: name.trim(),
          color,
          ...(icon ? { icon } : {}),
          ...(folders.length > 0 ? { folders, primary_path: folders[0] } : {}),
          profile,
        });
        savedFolder = folders[0];
        notifySuccess('项目已创建');
      }
      // 对齐 Hermes writeProjectIdea：best-effort 写 IDEA.md 到主文件夹（项目创建不受影响）
      if (idea.trim() && savedFolder && isTauri()) {
        void writeProjectIdea(savedFolder, idea);
      }
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e, '保存失败');
    } finally {
      setSaving(false);
    }
  }, [name, color, icon, folders, folder, idea, initial, onSaved, onClose, profile]);

  // 归档两步确认（防误触）
  const archive = useCallback(async () => {
    if (!initial) return;
    if (!confirmArchive) { setConfirmArchive(true); return; }
    setSaving(true);
    try {
      await call('projects_archive', { id: initial.id, profile });
      notifySuccess('项目已归档');
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e, '归档失败');
    } finally {
      setSaving(false);
    }
  }, [initial, confirmArchive, onSaved, onClose, profile]);

  // AI 生成 idea（对齐 Hermes generateProjectIdea → llm.oneshot；失败静默保持现状）
  const generateIdea = useCallback(async () => {
    if (generatingIdea) return;
    setGeneratingIdea(true);
    try {
      const text = await generateProjectIdea(name, profile);
      if (text) setIdea(text);
    } finally {
      setGeneratingIdea(false);
    }
  }, [name, profile, generatingIdea]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? (initial.isAuto ? '设为显式项目' : '编辑项目') : '新建项目'}</DialogTitle>
          <DialogDescription>
            {initial?.isAuto
              ? '自动项目由磁盘扫描派生，保存后将收养成显式项目（名称/颜色/图标可自定义）'
              : '会话的工作目录落在项目文件夹下即自动归入本项目（按 Repo/分支分组）'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          {/* ① 实时预览（紧凑单行） */}
          <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
            <div
              className="grid size-8 shrink-0 place-items-center rounded-lg text-white shadow-sm transition-colors"
              style={{ background: color || '#8b8b8b' }}
            >
              {icon ? (() => { const Ic = projectIconFor(icon); return <Ic size={15} />; })() : <FolderGit size={15} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{name.trim() || '未命名项目'}</div>
              <div className="text-[10px] text-muted-foreground">
                {initial ? (initial.isAuto ? '设为显式项目后可自定义外观' : '编辑项目外观与文件夹') : '新项目将以此外观创建'}
              </div>
            </div>
          </div>

          {/* ② 项目名称 */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">项目名称</label>
            <input
              className="desktop-input-chrome h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm outline-none transition-shadow focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：Eleve Agent"
              autoFocus
            />
          </div>

          {/* ③ 外观：主题色 + 图标（flex 固定尺寸，间距恒定不随容器放大） */}
          <div className="flex flex-col gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">主题色</label>
              <div className="flex flex-wrap gap-1">
                {AGENT_PALETTE.map((c) => (
                  <button
                    key={c}
                    className={cn(
                      'size-4 rounded-full transition-transform hover:scale-110',
                      color === c ? 'ring-1.5 ring-foreground ring-offset-1 ring-offset-background scale-110' : ''
                    )}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">图标</label>
              <div className="flex flex-wrap gap-1">
                {PROJECT_ICON_KEYS.map((key) => {
                  const Icon = projectIconFor(key);
                  const active = icon === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-md border transition-all',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                      style={active && color ? { color } : undefined}
                      onClick={() => setIcon(active ? null : key)}
                      title={key}
                    >
                      <Icon size={13} />
                    </button>
                  );
                })}
              </div>
              {icon && <button className="mt-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setIcon(null)}>清除图标</button>}
            </div>
          </div>

          {/* 文件夹（对齐 Hermes project-dialog：新建多文件夹列表 + primary badge + 移除） */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              {initial ? '主文件夹' : '项目文件夹'}
            </label>
            {initial ? (
              <div className="flex items-center gap-1.5">
                <span
                  className="flex-1 truncate rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
                  title={folder || undefined}
                >
                  {folder || '未选择 — 可稍后从项目菜单添加'}
                </span>
                <button
                  className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                  onClick={pickFolder}
                  disabled={!desktop}
                  title={desktop ? '原生文件夹选择' : '仅桌面端可用'}
                >
                  更换
                </button>
              </div>
            ) : folders.length === 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="flex-1 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  未选择文件夹 — 可稍后从项目菜单添加
                </span>
                <button
                  className="h-7 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                  onClick={pickFolder}
                  disabled={!desktop}
                  title={desktop ? '原生文件夹选择' : '仅桌面端可用'}
                >
                  选择
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {folders.map((f, i) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <span
                      className="flex-1 truncate rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
                      title={f}
                    >
                      {f}
                    </span>
                    {i === 0 && (
                      <span className="shrink-0 rounded bg-primary/15 px-1 py-0.5 text-[9px] text-primary">主</span>
                    )}
                    <button
                      className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={() => setFolders(prev => prev.filter(x => x !== f))}
                      title="移除文件夹"
                    >
                      移除
                    </button>
                  </div>
                ))}
                <button
                  className="self-start rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                  onClick={pickFolder}
                  disabled={!desktop}
                  title={desktop ? '原生文件夹选择' : '仅桌面端可用'}
                >
                  + 添加文件夹
                </button>
              </div>
            )}
          </div>

          {/* 项目 Idea（对齐 Hermes project-dialog：textarea + AI 生成 + 模板 chips + shuffle；仅新建） */}
          {!initial && (
            <div className="flex flex-col gap-1.5">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">项目 Idea（可选）</label>
              <div className="relative">
                <textarea
                  className="min-h-24 w-full rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs outline-none resize-y"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="一句话总结 + 3-5 个目标；创建后写入主文件夹 IDEA.md"
                  disabled={saving}
                />
                <button
                  className="absolute top-1 right-1 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => void generateIdea()}
                  disabled={saving || generatingIdea}
                  title="AI 生成项目 idea"
                >
                  {generatingIdea ? '生成中…' : '✨ 生成'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {templates.map((t) => (
                  <button
                    key={t.label}
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors disabled:opacity-50"
                    onClick={() => setIdea(t.idea)}
                    disabled={saving}
                    title={t.label}
                  >
                    <span aria-hidden>{t.emoji}</span>
                    {t.label}
                  </button>
                ))}
                <button
                  className="rounded-full p-1 text-muted-foreground/50 hover:text-foreground transition-colors"
                  onClick={() => setTemplates(randomIdeaTemplates())}
                  disabled={saving}
                  title="换一批模板"
                >
                  <RefreshCw size={11} />
                </button>
              </div>
            </div>
          )}

          {/* 归档危险区（仅显式项目编辑模式；自动项目无记录不可归档） */}
          {initial && !initial.isAuto && (
            <div className="border-t border-border pt-2">
              <button
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs transition-colors',
                  confirmArchive
                    ? 'bg-destructive text-destructive-foreground'
                    : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                )}
                onClick={archive}
                disabled={saving}
              >
                {confirmArchive ? '确认归档？' : '归档项目'}
              </button>
            </div>
          )}
        </div>

        <DialogFooter className="mt-1 gap-2">
          <button
            className="h-8 rounded-lg border border-border px-4 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="flex h-8 items-center gap-1 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
            onClick={save}
            disabled={saving || !name.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 会话重命名对话框（对齐 Hermes RenameSessionDialog）──
function SessionRenameDialog({ session, onClose, onRenamed }: {
  session: SessionPreview;
  onClose: () => void;
  onRenamed: (id: string, title: string) => void;
}) {
  const [value, setValue] = useState(session.title || '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const next = value.trim();
    if (!next || saving) return;
    setSaving(true);
    try {
      await renameSessionAction(session.id, next, onRenamed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          className="desktop-input-chrome h-8 w-full rounded-md border px-2.5 text-sm outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
            else if (e.key === 'Escape') onClose();
          }}
          placeholder="会话标题"
        />
        <DialogFooter>
          <button
            className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent transition-colors"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            className="h-8 rounded-md bg-foreground px-3 text-xs text-background hover:opacity-90 transition-opacity disabled:opacity-50"
            onClick={() => void submit()}
            disabled={saving || !value.trim()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Panel ──

export default function ProjectTreePanel({ sessionId, onSwitchSession, currentProfile, onNewSessionInProject, onEnterProject }: ProjectTreePanelProps) {
  const [tree, setTree] = useState<TreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 阶段二·钻取状态（projects.project_sessions，hydrate=true 全量水合）
  const [drill, setDrill] = useState<ProjectNode | null>(null);
  const [drillProject, setDrillProject] = useState<ProjectNode | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  // 项目管理（显式项目新建/编辑/加文件夹/归档/删除）
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectNode | null>(null);
  const [deleting, setDeleting] = useState<ProjectNode | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // 拖拽排序（对齐 Hermes $sidebarProjectOrderIds + orderProjectsByIds）
  const [projectOrder, setProjectOrder] = useState<string[]>(() => getProjectOrderIds());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // 会话行操作（对齐 Hermes session-actions-menu）
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedIds());
  const [renameTarget, setRenameTarget] = useState<SessionPreview | null>(null);
  const desktop = isTauri();

  // 渲染列表：手排 order 覆盖在确定性排序之上（对齐 Hermes orderProjectsByIds）
  const orderedProjects = useMemo(
    () => (tree ? orderProjectsByIds(tree.projects, projectOrder, tree.active_id) : []),
    [tree, projectOrder],
  );

  // ── 拖拽排序 handlers（对齐 Hermes setOrderIds：手排 order 持久化）──
  const handleRowDragStart = useCallback((id: string) => setDragId(id), []);
  const handleRowDragOver = useCallback((id: string) => setDragOverId(id), []);
  const handleRowDrop = useCallback((targetId: string) => {
    setDragOverId(null);
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    // 基准 = 当前 order（无则当前渲染顺序）——首次拖拽从确定性排序起步
    const base = projectOrder.length ? projectOrder : orderedProjects.map(p => p.id);
    const ids = [...base];
    const from = ids.indexOf(dragId);
    if (from >= 0) ids.splice(from, 1);
    const to = ids.indexOf(targetId);
    if (to >= 0) ids.splice(to, 0, dragId);
    else ids.push(dragId);
    setProjectOrder(ids);
    setProjectOrderIds(ids);
    setDragId(null);
  }, [dragId, projectOrder, orderedProjects]);
  const handleRowDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  const fetchTree = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      // 🔴 显式 profile：per-profile projects.db 路由，切 Agent 自动重拉（依赖 currentProfile）
      const result = await call('projects_tree', { preview_limit: 3, include_discovered: true, profile: currentProfile });
      // 🔴 自动项目 dismiss 过滤（对齐 Hermes filterVisibleProjects：本地隐藏，不删后端）
      const dismissed = getDismissedAutoProjectIds();
      if (dismissed.size > 0 && result?.projects) {
        result.projects = result.projects.filter((p: ProjectNode) => !p.isAuto || !dismissed.has(p.id));
      }
      setTree(result);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

  // 🔴 2026-08-12 断线修复：切 Agent 项目树必须跟随切换（对齐 Hermes
  // "Projects are per-profile, so they intentionally follow [profile switch]"）。
  // 原实现 fetchTree 依赖 [currentProfile] 但无任何 effect 触发它——currentProfile
  // 变化只重渲染组件，树保持旧 Agent 数据。补：profile 变化 → 清钻取残留 + 重拉。
  useEffect(() => {
    if (!currentProfile) return;
    // 清钻取视图（旧 Agent 的项目详情不残留）
    setDrill(null);
    setDrillProject(null);
    setDrillError(null);
    setDrillLoading(false);
    setWorktreesMap({});
    void fetchTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProfile]);

  // ── 会话行操作 handlers（对齐 Hermes session-actions-menu）──
  const togglePin = useCallback((s: SessionPreview) => {
    setPinnedIds(prev => {
      const next = new Set(prev);
      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
      savePinnedIds(next);
      return next;
    });
  }, []);

  // 🔴 2026-08-12 对齐 SessionsPanel：归档/取消归档切换（toggleArchiveSession 返回 next 状态，
  //   本地 archivedIds 仅会话内存（SessionsPanel 同款不持久化））
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => new Set());
  const toggleArchive = useCallback(async (s: SessionPreview) => {
    const isArchived = archivedIds.has(s.id);
    const next = await toggleArchiveSession(s.id, isArchived);
    if (next !== isArchived) {
      setArchivedIds((prev) => {
        const n = new Set(prev);
        if (n.has(s.id)) n.delete(s.id); else n.add(s.id);
        return n;
      });
      void fetchTree(true); // 刷新树（归档后会话移出/入项目桶）
    }
  }, [archivedIds, fetchTree]);

  const handleDeleteSession = useCallback((s: SessionPreview) => {
    void deleteSessionAction(s.id, () => { void fetchTree(true); });
  }, [fetchTree]);

  // 重命名成功：总览刷新 + 钻取数据同步（title 即时生效）
  const handleRenamed = useCallback((id: string, title: string) => {
    void fetchTree(true);
    setDrillProject(prev => {
      if (!prev) return prev;
      const updateSessions = (sessions: SessionPreview[]): SessionPreview[] =>
        sessions.map(s => (s.id === id ? { ...s, title } : s));
      return {
        ...prev,
        repos: prev.repos.map(r => ({ ...r, groups: r.groups.map(g => ({ ...g, sessions: updateSessions(g.sessions) })) })),
      };
    });
  }, [fetchTree]);

  // 行菜单共享规格（对齐 Hermes useProjectActions：kebab 与右键同一套）
  // 🔴 2026-08-12 对齐 SessionsPanel 右键菜单全功能：undo/compress/branch/usage
  const sessionActions = useMemo<SessionRowActions>(() => ({
    profile: currentProfile,
    onRenameRequest: setRenameTarget,
    onDeleted: handleDeleteSession,
    isPinned: (s) => pinnedIds.has(s.id),
    onTogglePin: togglePin,
    isArchived: (s) => archivedIds.has(s.id),
    onToggleArchive: toggleArchive,
    // ── F1 会话操作（对齐 SessionsPanel handleUndo/handleCompress/handleBranch/handleUsage）──
    onUndo: async (id) => {
      try {
        const res = await undoSessionTurn(id);
        if (res.undone) notifySuccess('已撤销最后一轮');
        else notifyInfo(res.reason || '没有可撤销的内容');
      } catch (e: any) { notifyError(e, '撤销失败'); }
    },
    onCompress: async (id) => {
      try {
        const res = await compressSession(id);
        notifySuccess(res.summary || '上下文已压缩');
      } catch (e: any) { notifyError(e, '压缩失败'); }
    },
    onBranch: async (id) => {
      try {
        const res = await branchSession(id);
        notifySuccess(`已创建分支: ${res.branch_id?.slice(0, 8) || ''}`);
      } catch (e: any) { notifyError(e, '分支失败'); }
    },
    onUsage: async (id) => {
      try {
        const res = await getSessionUsage(id);
        notifyInfo(`Tokens: ${res.input_tokens?.toLocaleString()} in / ${res.output_tokens?.toLocaleString()} out / ${res.total_tokens?.toLocaleString()} total`);
      } catch (e: any) { notifyError(e, '获取用量失败'); }
    },
  }), [currentProfile, handleDeleteSession, pinnedIds, togglePin, archivedIds, toggleArchive]);

  // 🔴 2026-08-12 单击激活（老大指示：单击激活与 Agent 联动，双击才进入项目）：
  //   只做联动：① onEnterProject（文件面板切项目根/workspace + scope + 消息区选最新会话）
  //   ② 显式项目自动设为激活。不进入钻取视图（双击 handleDrill 才钻取）。
  const handleActivate = useCallback((project: ProjectNode) => {
    onEnterProject?.(project.path ?? '', project.previewSessions?.[0]?.id ?? null);
    if (!project.isAuto && !project.isNoProject && project.id) {
      void call('projects_set_active', { id: project.id, profile: currentProfile }).catch(() => {});
    }
  }, [currentProfile, onEnterProject]);

  // 钻取：双击项目行 → 全量水合的 Repo/Lane/Session 树
  // （双击时浏览器会先触发两次单击（handleActivate，幂等无害），再触发本钻取）
  const handleDrill = useCallback(async (project: ProjectNode) => {
    // 双击也先激活（联动语义一致）
    handleActivate(project);
    setDrill(project);
    setDrillProject(null);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const res: any = await call('projects_project_sessions', { project_id: project.id, profile: currentProfile });
      if (!res?.project) {
        setDrillError('项目不存在或无会话');
      } else {
        setDrillProject(res.project);
      }
    } catch (e: any) {
      setDrillError(e?.message || '加载项目会话失败');
    } finally {
      setDrillLoading(false);
    }
  }, [handleActivate, currentProfile]);

  const handleBack = useCallback(() => {
    setDrill(null);
    setDrillProject(null);
    setDrillError(null);
    // 🔴 2026-08-12 选中语义修正（老大：新会话自动绑定选中的 Agent+项目）：
    //   钻取返回只退出视图，**不清 scope**——选中（active_id 高亮）是持久的，
    //   scope 必须与选中一致（否则项目高亮选中但新会话落 workspace，链路断点）。
    //   scope 生命周期 = 选中状态：切 Agent / 单击其它项目 时更新。
    void fetchTree(true); // 静默刷新总览（钻取期间会话数据可能已变化）
  }, [fetchTree]);

  const handleCreate = useCallback(() => { setEditing(null); setDialogOpen(true); }, []);
  const handleEdit = useCallback((p: ProjectNode) => { setEditing(p); setDialogOpen(true); }, []);
  const handleAddFolder = useCallback(async (project: ProjectNode) => {
    if (!desktop) return;
    const path = await pickDirectory(`为「${project.label}」添加文件夹`, project.path || undefined);
    if (!path) return;
    try {
      // 无主文件夹的项目：首个添加的文件夹自动设为主文件夹
      await call('projects_add_folder', { id: project.id, path, is_primary: !project.path, profile: currentProfile });
      notifySuccess('文件夹已添加');
      void fetchTree(true);
    } catch (e) {
      notifyError(e, '添加文件夹失败');
    }
  }, [desktop, fetchTree, currentProfile]);

  // 设为激活项目（对齐 Hermes setActiveProject → projects.set_active，per-profile 路由）
  const handleSetActive = useCallback(async (project: ProjectNode) => {
    try {
      await call('projects_set_active', { id: project.id, profile: currentProfile });
      notifySuccess(`已将「${project.label}」设为激活项目`);
      void fetchTree(true);
    } catch (e) {
      notifyError(e, '激活项目失败');
    }
  }, [currentProfile, fetchTree]);

  // 在文件管理器中显示（对齐 Hermes revealPath；tauri-opener 与文件面板同款）
  const handleReveal = useCallback(async (path: string) => {
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(path);
    } catch (err) {
      notifyError(err, '无法在文件管理器中显示');
    }
  }, []);

  // 复制路径（对齐 Hermes copyPath）
  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      notifySuccess('路径已复制');
    } catch (err) {
      notifyError(err, '复制失败');
    }
  }, []);

  // 显式项目删除（对齐 Hermes deleteProject：删 projects.db 记录，不删文件；
  // 与归档（archive）并存——归档保留记录，删除移除记录）
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await call('projects_delete', { id: deleting.id, profile: currentProfile });
      notifySuccess(`已删除「${deleting.label}」`);
      setDeleting(null);
      void fetchTree(true);
    } catch (e) {
      notifyError(e, '删除失败');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleting, deleteBusy, currentProfile, fetchTree]);

  // 自动项目「从侧边栏移除」（对齐 Hermes dismissAutoProject：本地隐藏，可刷新恢复）
  const handleDismiss = useCallback((project: ProjectNode) => {
    dismissAutoProject(project.id);
    notifySuccess(`已从侧边栏移除「${project.label}」`);
    void fetchTree(true);
  }, [fetchTree]);

  // ═══════════════ git worktree（对齐 Hermes useRepoWorktreeMap / workspace-header）═══════════
  const [wtDialogRepo, setWtDialogRepo] = useState<string | null>(null);
  const [worktreesMap, setWorktreesMap] = useState<Record<string, HermesGitWorktree[]>>({});
  const [wtRefresh, setWtRefresh] = useState(0);
  const [removeTarget, setRemoveTarget] = useState<{ repoPath: string; lane: LaneGroup } | null>(null);
  const [forceTarget, setForceTarget] = useState<{ repoPath: string; lane: LaneGroup } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  // 钻取视图：探测各 repo 的 git worktree（对齐 Hermes useRepoWorktreeMap：
  // 从 git worktree list 注入空视觉 lane；wtRefresh 在 add/remove/dismiss 后重探测）
  useEffect(() => {
    if (!drillProject) return;
    let cancelled = false;
    const paths = drillProject.repos.map(r => r.path).filter(Boolean);
    if (!paths.length) return;
    void Promise.all(paths.map(async p => [p, await gitWorktreeList(p).catch(() => [])] as const)).then(entries => {
      if (!cancelled) setWorktreesMap(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [drillProject, wtRefresh]);

  // StartWorkButton → WorktreeDialog（repoPath 受控）
  const handleStartWork = useCallback((repoPath: string) => setWtDialogRepo(repoPath), []);

  // worktree 创建/convert 成功 → 关闭对话框 + 刷新探测 + 在该路径新建会话
  // （对齐 Hermes onStarted → requestStartWorkSession）
  const handleWorktreeStarted = useCallback((path: string) => {
    setWtDialogRepo(null);
    setWtRefresh(n => n + 1);
    void fetchTree(true);
    onNewSessionInProject?.(path);
  }, [fetchTree, onNewSessionInProject]);

  // 移除 worktree（git worktree remove）；dirty/locked 报错 → force 升级（对齐 Hermes removeViaGit）
  const handleRemoveWorktree = useCallback(async (repoPath: string, lane: LaneGroup, force: boolean) => {
    if (!lane.path || removeBusy) return;
    setRemoveBusy(true);
    try {
      await gitWorktreeRemove(repoPath, lane.path, force);
      setRemoveTarget(null);
      setForceTarget(null);
      setWtRefresh(n => n + 1);
      void fetchTree(true);
    } catch (err) {
      const msg = String((err as Error)?.message ?? '');
      if (!force && /force|modified|untracked|dirty|locked|contains/i.test(msg)) {
        // dirty 工作区 → 升级 force 确认（对齐 Hermes forceTarget 升级）
        setRemoveTarget(null);
        setForceTarget({ repoPath, lane });
      } else {
        notifyError(err, '移除工作区失败');
        setRemoveTarget(null);
        setForceTarget(null);
      }
    } finally {
      setRemoveBusy(false);
    }
  }, [removeBusy, fetchTree]);

  // 仅从侧边栏隐藏（不删 git worktree；对齐 Hermes dismissWorktree）
  const handleDismissWorktree = useCallback((path: string) => {
    dismissWorktree(path);
    setRemoveTarget(null);
    setForceTarget(null);
    setWtRefresh(n => n + 1);
  }, []);

  // 🔴 冷启动竞态修复（同 ProfilePanel）：mount 时 WS 可能未连，等连接后再加载。
  useEffect(() => {
    let cancelled = false;
    getWsClient()
      .whenConnected()
      .then(() => { if (!cancelled) fetchTree(); })
      .catch(() => { if (!cancelled) setError('无法连接网关，请检查后端服务'); });
    return () => { cancelled = true; };
  }, [fetchTree]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {drill ? (
        // ── 阶段二：钻取视图（全量水合 Repo → Lane → Session）──
        <>
          <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border/30 shrink-0">
            <button
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              onClick={handleBack}
              title="返回项目列表"
            >
              <ChevronRight size={14} className="rotate-180" />
            </button>
            <span className="text-xs font-semibold truncate flex-1">{drill.label}</span>
            {drill.sessionCount > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{drill.sessionCount}</span>
            )}
            <button
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
              onClick={() => handleDrill(drill)}
              disabled={drillLoading}
              title="刷新"
            >
              <RefreshCw size={12} className={drillLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          {drillLoading && (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
          )}
          {drillError && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-xs text-destructive">{drillError}</p>
              <button className="text-xs text-primary hover:underline" onClick={() => handleDrill(drill)}>重试</button>
            </div>
          )}
          {drillProject && (
            <div className="flex-1 overflow-y-auto">
              {drillProject.repos.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">{drillProject.isNoProject ? '暂无会话' : '无 Repo 分组'}</div>
              ) : (
                drillProject.repos.map(r => (
                  <RepoNodeItem
                    key={r.id}
                    repo={r}
                    sessionId={sessionId}
                    onSwitchSession={onSwitchSession}
                    onStartWork={handleStartWork}
                    onReveal={handleReveal}
                    onCopyPath={handleCopyPath}
                    onRemoveWorktree={(lane) => { if (r.path) setRemoveTarget({ repoPath: r.path, lane }); }}
                    lanes={mergeWorktreeLanes(r.groups, worktreesMap[r.path ?? ''] ?? [], getDismissedWorktrees())}
                    sessionActions={sessionActions}
                    defaultExpanded
                  />
                ))
              )}
            </div>
          )}
        </>
      ) : (
        // ── 阶段一：总览（项目行 + previewSessions 预览）──
        <>
          {loading && (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
          )}
          {error && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-xs text-destructive">{error}</p>
              <button className="text-xs text-primary hover:underline" onClick={() => fetchTree()}>重试</button>
            </div>
          )}
          {tree && (
            <>
              {/* 总览工具栏：区块头（对齐 SessionsPanel 风格）+ 实心新建按钮 + 刷新 */}
              <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-border/30 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 select-none">
                    项目
                    <span className="tabular-nums text-muted-foreground/40 ml-1">{tree.projects.length}</span>
                  </span>
                  <button
                    className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                    onClick={() => fetchTree()}
                    disabled={loading}
                    title="刷新"
                  >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
                <button
                  className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.97] transition-all shrink-0"
                  onClick={handleCreate}
                  title="新建项目"
                >
                  <Plus size={12} strokeWidth={2.5} />
                  新建项目
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {tree.projects.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center">
                      <FolderGit size={18} className="text-muted-foreground/40" />
                    </div>
                    <p className="text-xs text-muted-foreground">暂无项目</p>
                    <button
                      className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.97] transition-all"
                      onClick={handleCreate}
                    >
                      <Plus size={13} strokeWidth={2.5} /> 新建项目
                    </button>
                  </div>
                ) : (
                  // 🔴 总览排序（对齐 Hermes orderProjectsByIds：手排 order + 确定性排序兜底）
                  orderedProjects.map(p => (
                    <ProjectItem
                      key={p.id}
                      project={p}
                      sessionId={sessionId}
                      onSwitchSession={onSwitchSession}
                      onDrill={handleDrill}
                      onActivate={handleActivate}
                      onEdit={handleEdit}
                      onAddFolder={handleAddFolder}
                      onSetActive={handleSetActive}
                      onReveal={handleReveal}
                      onCopyPath={handleCopyPath}
                      onDelete={setDeleting}
                      onDismiss={handleDismiss}
                      isActiveProject={tree.active_id === p.id}
                      desktop={desktop}
                      isDragging={dragId === p.id}
                      isDragOver={dragOverId === p.id}
                      onRowDragStart={handleRowDragStart}
                      onRowDragOver={handleRowDragOver}
                      onRowDrop={handleRowDrop}
                      onRowDragEnd={handleRowDragEnd}
                      sessionActions={sessionActions}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* 会话重命名对话框（对齐 Hermes RenameSessionDialog；钻取/总览行共用） */}
      {renameTarget && (
        <SessionRenameDialog
          session={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={handleRenamed}
        />
      )}

      {/* 项目新建/编辑对话框 */}
      <ProjectDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => fetchTree(true)}
        profile={currentProfile}
      />

      {/* 删除确认（对齐 Hermes deleteProject confirm；不删文件，仅删项目记录） */}
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o && !deleteBusy) setDeleting(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除项目</DialogTitle>
            <DialogDescription>
              将从项目列表移除「{deleting?.label}」，不删除任何文件。
              {deleting?.isAuto ? '' : ' 该操作不可撤销。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
            >
              取消
            </button>
            <button
              className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleteBusy}
            >
              {deleteBusy ? '删除中…' : '删除'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* worktree 新建/convert 对话框（对齐 Hermes WorktreeDialog） */}
      <WorktreeDialog
        repoPath={wtDialogRepo ?? ''}
        open={!!wtDialogRepo}
        onOpenChange={(o) => { if (!o) setWtDialogRepo(null); }}
        onStarted={handleWorktreeStarted}
      />

      {/* 移除工作区确认（对齐 Hermes removeDialog：取消/仅隐藏/移除） */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => { if (!o && !removeBusy) setRemoveTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>移除工作区「{removeTarget?.lane.label}」？</DialogTitle>
            <DialogDescription>
              将执行 git worktree remove 从磁盘删除该工作区（分支与会话记录保留）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <button
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => setRemoveTarget(null)}
              disabled={removeBusy}
            >
              取消
            </button>
            <div className="flex items-center gap-2">
              <button
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
                onClick={() => removeTarget && handleDismissWorktree(removeTarget.lane.path ?? '')}
                disabled={removeBusy}
              >
                仅从侧边栏隐藏
              </button>
              <button
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                onClick={() => removeTarget && void handleRemoveWorktree(removeTarget.repoPath, removeTarget.lane, false)}
                disabled={removeBusy}
              >
                {removeBusy ? '移除中…' : '移除'}
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dirty → force 升级（对齐 Hermes forceTarget：强制删除丢弃未提交改动） */}
      <Dialog open={!!forceTarget} onOpenChange={(o) => { if (!o && !removeBusy) setForceTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>强制移除工作区？</DialogTitle>
            <DialogDescription>
              「{forceTarget?.lane.label}」有未提交/未跟踪改动，git 拒绝移除。强制删除将丢弃这些改动。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <button
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => setForceTarget(null)}
              disabled={removeBusy}
            >
              取消
            </button>
            <div className="flex items-center gap-2">
              <button
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
                onClick={() => forceTarget && handleDismissWorktree(forceTarget.lane.path ?? '')}
                disabled={removeBusy}
              >
                仅从侧边栏隐藏
              </button>
              <button
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                onClick={() => forceTarget && void handleRemoveWorktree(forceTarget.repoPath, forceTarget.lane, true)}
                disabled={removeBusy}
              >
                {removeBusy ? '移除中…' : '强制移除'}
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
