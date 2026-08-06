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
import { useState, useEffect, useCallback, Fragment } from 'react';
import { ChevronRight, ChevronDown, FolderGit, GitBranch, FolderOpen, Blocks, MessageSquare, RefreshCw, Plus, MoreVertical, Pencil, FolderPlus, CheckCircle2, Copy, Trash2 } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { getWsClient } from '../services/ws-client';
import { AGENT_PALETTE } from '../lib/agent-palette';
import { PROJECT_ICON_KEYS, projectIconFor } from '../lib/project-icons';
import { getDismissedAutoProjectIds, dismissAutoProject } from '../lib/dismissed-projects';
import { notifySuccess, notifyError } from '../utils/notifications';
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
  /** 🔴 在该项目新建会话（对齐 Hermes onNewSessionInWorkspace → goToProject newSession）：
   *  项目行 hover + → 创建带 cwd 的新会话并切换（App 层接线） */
  onNewSessionInProject?: (cwd: string) => void;
}

// ── 辅助 ──

// 总览排序（对齐 Hermes sortProjectsForOverview）：激活项目置顶（仅显式）→
// 显式先于自动 → 有会话先于无会话 → 最近活跃 → 名称（不区分大小写）。
// ELEVE 总览模式 lane.sessions 恒空 → 项目活跃时间 = lastActive（Hermes
// projectActivityTime 的 session 兜底分支无数据，跳过）。无 isNoProject 桶。
function sortProjectsForOverview(projects: ProjectNode[], activeProjectId?: string | null): ProjectNode[] {
  return [...projects].sort((a, b) => {
    const aActive = Boolean(activeProjectId && a.id === activeProjectId && !a.isAuto);
    const bActive = Boolean(activeProjectId && b.id === activeProjectId && !b.isAuto);
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (!a.isAuto !== !b.isAuto) return a.isAuto ? 1 : -1;
    const aHasSessions = a.sessionCount > 0;
    const bHasSessions = b.sessionCount > 0;
    if (aHasSessions !== bHasSessions) return aHasSessions ? -1 : 1;
    const recency = (b.lastActive || 0) - (a.lastActive || 0);
    if (recency !== 0) return recency;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
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

// 原生目录选择（tauri-plugin-dialog；浏览器模式返回 null）
async function pickDirectory(title: string): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ directory: true, multiple: false, title });
    return Array.isArray(sel) ? (sel[0] ?? null) : sel;
  } catch (err) {
    console.error('[ProjectTreePanel] directory dialog failed:', err);
    return null;
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

function SessionItem({ s, isActive, onClick }: { s: SessionPreview; isActive: boolean; onClick: () => void }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 pl-8 pr-3 py-1 cursor-pointer text-xs hover:bg-accent/40 transition-colors',
        isActive && 'bg-accent/30'
      )}
      onClick={onClick}
    >
      <MessageSquare size={12} className="text-muted-foreground shrink-0" />
      <span className="truncate flex-1">{s.title || s.id.slice(0, 8)}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">{fmtTime(s.lastActive || s.startedAt)}</span>
    </div>
  );
}

function LaneNode({ lane, sessionId, onSwitchSession }: { lane: LaneGroup; sessionId?: string; onSwitchSession?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hasSessions = lane.sessions.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 pl-6 pr-3 py-1 cursor-pointer hover:bg-accent/20 text-xs"
        onClick={() => hasSessions && setExpanded(!expanded)}
      >
        {hasSessions ? <TreeToggle expanded={expanded} onClick={() => setExpanded(!expanded)} /> : <span className="w-3.5" />}
        {lane.isKanban ? <Blocks size={12} className="text-info" /> : <GitBranch size={12} className="text-muted-foreground" />}
        <span className="truncate flex-1">{lane.label}</span>
        <span className="text-[10px] text-muted-foreground">{lane.sessions.length}</span>
      </div>
      {expanded && lane.sessions.map(s => (
        <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => onSwitchSession?.(s.id)} />
      ))}
    </div>
  );
}

function RepoNodeItem({ repo, sessionId, onSwitchSession, defaultExpanded = false }: { repo: RepoNode; sessionId?: string; onSwitchSession?: (id: string) => void; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 pl-4 pr-3 py-1 cursor-pointer hover:bg-accent/20 text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <TreeToggle expanded={expanded} onClick={() => setExpanded(!expanded)} />
        <FolderGit size={13} className="text-muted-foreground shrink-0" />
        <span className="truncate flex-1 font-medium">{repo.label}</span>
        <span className="text-[10px] text-muted-foreground">{repo.sessionCount}</span>
      </div>
      {expanded && repo.groups.map(g => (
        <LaneNode key={g.id} lane={g} sessionId={sessionId} onSwitchSession={onSwitchSession} />
      ))}
    </div>
  );
}

// 项目行前置图标（对齐 Hermes projectIcon）：icon → 图标（color 着色）；
// 无 icon 有 color → 纯色点；都无 → 默认 folder-library 图标
function ProjectLeadIcon({ project }: { project: ProjectNode }) {
  if (project.color && !project.icon) {
    return <div className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color }} />;
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

function ProjectItem({ project, sessionId, onSwitchSession, onDrill, onEdit, onAddFolder, onSetActive, onReveal, onCopyPath, onDelete, onDismiss, onNewSession, isActiveProject, desktop }: {
  project: ProjectNode;
  sessionId?: string;
  onSwitchSession?: (id: string) => void;
  onDrill: (p: ProjectNode) => void;
  onEdit: (p: ProjectNode) => void;
  onAddFolder: (p: ProjectNode) => void;
  onSetActive: (p: ProjectNode) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  onDelete: (p: ProjectNode) => void;
  onDismiss: (p: ProjectNode) => void;
  onNewSession?: (path: string) => void;
  isActiveProject: boolean;
  desktop: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
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
      className="flex items-center gap-1.5 pl-3 pr-3 py-2 cursor-pointer hover:bg-accent/20 text-sm group/workspace"
      onClick={() => onDrill(project)}
      title={path ? `${path} — 点击进入项目（完整 Repo/Lane 树）` : '点击进入项目（完整 Repo/Lane 树）'}
    >
      <TreeToggle expanded={expanded} onClick={() => setExpanded(!expanded)} />
      <ProjectLeadIcon project={project} />
      <span className="truncate flex-1 font-medium">{project.label}</span>
      {/* 激活项目标记（对齐 Hermes overview-row isActive 高亮） */}
      {isActiveProject && (
        <span className="text-[9px] px-1 py-0.5 rounded bg-primary/15 text-primary shrink-0" title="当前激活项目">激活</span>
      )}
      {project.sessionCount > 0 && (
        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{project.sessionCount}</span>
      )}
      <span className="text-[10px] text-muted-foreground/50">{fmtTime(project.lastActive)}</span>
      {/* 在该项目新建会话（对齐 Hermes WorkspaceAddButton：hover 显示 +） */}
      {onNewSession && path && (
        <button
          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/50 transition-colors opacity-0 group-hover/workspace:opacity-100"
          onClick={(e) => { e.stopPropagation(); onNewSession(path); }}
          title={`在「${project.label}」中新建会话`}
        >
          <Plus size={13} />
        </button>
      )}
      {kebab}
    </div>
  );

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
          <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => onSwitchSession?.(s.id)} />
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
  const [folder, setFolder] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    if (open) {
      setName(initial?.label ?? '');
      setColor(initial?.color || AGENT_PALETTE[0]);
      setIcon(initial?.icon ?? null);
      setFolder(initial?.path ?? '');
      setConfirmArchive(false);
    }
  }, [open, initial]);

  const pickFolder = useCallback(async () => {
    if (!desktop) { notifyError(null, '原生对话框仅桌面端可用'); return; }
    const path = await pickDirectory(initial ? '选择主文件夹' : '选择项目文件夹（可选）');
    if (!path) return;
    if (initial) {
      // 编辑模式：立即设为主文件夹（projects.set_primary）
      try {
        await call('projects_set_primary', { id: initial.id, path, profile });
        setFolder(path);
        notifySuccess('主文件夹已更新');
        onSaved();
      } catch (e) { notifyError(e, '更新文件夹失败'); }
    } else {
      setFolder(path);
    }
  }, [desktop, initial, onSaved, profile]);

  const save = useCallback(async () => {
    if (!name.trim()) { notifyError(null, '请输入项目名称'); return; }
    setSaving(true);
    try {
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
        notifySuccess('已设为显式项目');
      } else {
        await call('projects_create', {
          name: name.trim(),
          color,
          ...(icon ? { icon } : {}),
          ...(folder ? { folders: [folder], primary_path: folder } : {}),
          profile,
        });
        notifySuccess('项目已创建');
      }
      onSaved();
      onClose();
    } catch (e) {
      notifyError(e, '保存失败');
    } finally {
      setSaving(false);
    }
  }, [name, color, icon, folder, initial, onSaved, onClose, profile]);

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

        <div className="space-y-3 py-1">
          {/* 名称 */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">项目名称</label>
            <input
              className="desktop-input-chrome h-8 w-full rounded-md border px-2.5 text-sm outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：Eleve Agent"
              autoFocus
            />
          </div>

          {/* 主题色（对齐 Hermes 22 色板） */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">主题色</label>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_PALETTE.map((c) => (
                <button
                  key={c}
                  className={cn('h-5 w-5 rounded-full transition-transform hover:scale-110', color === c && 'ring-2 ring-foreground ring-offset-1 ring-offset-background')}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* 图标（对齐 Hermes ProjectAppearancePicker 28 图标网格；再次点击取消选择） */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">图标</label>
            <div className="grid grid-cols-7 gap-1">
              {PROJECT_ICON_KEYS.map((key) => {
                const Icon = projectIconFor(key);
                const active = icon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      'grid aspect-square place-items-center rounded-md border transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    )}
                    style={active && color ? { color } : undefined}
                    onClick={() => setIcon(active ? null : key)}
                    title={key}
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>
            {icon && <button className="mt-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setIcon(null)}>清除图标</button>}
          </div>

          {/* 文件夹 */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {initial ? '主文件夹' : '项目文件夹（可选）'}
            </label>
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
                {initial ? '更换' : '选择'}
              </button>
            </div>
          </div>

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

        <DialogFooter>
          <button className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent transition-colors" onClick={onClose}>
            取消
          </button>
          <button
            className="h-8 rounded-md bg-foreground px-3 text-xs text-background hover:opacity-90 transition-opacity disabled:opacity-50"
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

// ── Panel ──

export default function ProjectTreePanel({ sessionId, onSwitchSession, currentProfile, onNewSessionInProject }: ProjectTreePanelProps) {
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
  const desktop = isTauri();

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

  // 钻取：点击项目行 → 全量水合的 Repo/Lane/Session 树
  const handleDrill = useCallback(async (project: ProjectNode) => {
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
  }, [currentProfile]);

  const handleBack = useCallback(() => {
    setDrill(null);
    setDrillProject(null);
    setDrillError(null);
    void fetchTree(true); // 静默刷新总览（钻取期间会话数据可能已变化）
  }, [fetchTree]);

  const handleCreate = useCallback(() => { setEditing(null); setDialogOpen(true); }, []);
  const handleEdit = useCallback((p: ProjectNode) => { setEditing(p); setDialogOpen(true); }, []);
  const handleAddFolder = useCallback(async (project: ProjectNode) => {
    if (!desktop) return;
    const path = await pickDirectory(`为「${project.label}」添加文件夹`);
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
          <div className="flex items-center gap-1.5 px-2 py-2 border-b border-border/50 shrink-0">
            <button
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              onClick={handleBack}
              title="返回项目列表"
            >
              <ChevronRight size={14} className="rotate-180" />
            </button>
            <span className="text-xs font-medium truncate flex-1">{drill.label}</span>
            {drill.sessionCount > 0 && (
              <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{drill.sessionCount}</span>
            )}
            <button
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
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
                <div className="p-4 text-xs text-muted-foreground">无 Repo 分组</div>
              ) : (
                drillProject.repos.map(r => (
                  <RepoNodeItem key={r.id} repo={r} sessionId={sessionId} onSwitchSession={onSwitchSession} defaultExpanded />
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
              {/* 总览工具栏：项目数 + 新建 + 刷新 */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 shrink-0">
                <span className="text-[10px] text-muted-foreground/70">{tree.projects.length} 个项目 · 点击项目名钻取完整会话树</span>
                <div className="flex items-center gap-0.5">
                  <button
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    onClick={handleCreate}
                    title="新建项目"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-50"
                    onClick={() => fetchTree()}
                    disabled={loading}
                    title="刷新"
                  >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {tree.projects.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4">暂无项目</div>
                ) : (
                  // 🔴 总览排序（对齐 Hermes sortProjectsForOverview）：激活置顶→显式→有会话→活跃→名称
                  sortProjectsForOverview(tree.projects, tree.active_id).map(p => (
                    <ProjectItem
                      key={p.id}
                      project={p}
                      sessionId={sessionId}
                      onSwitchSession={onSwitchSession}
                      onDrill={handleDrill}
                      onEdit={handleEdit}
                      onAddFolder={handleAddFolder}
                      onSetActive={handleSetActive}
                      onReveal={handleReveal}
                      onCopyPath={handleCopyPath}
                      onDelete={setDeleting}
                      onDismiss={handleDismiss}
                      onNewSession={onNewSessionInProject}
                      isActiveProject={tree.active_id === p.id}
                      desktop={desktop}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </>
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
    </div>
  );
}
