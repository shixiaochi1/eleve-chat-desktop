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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Home, Plus, RefreshCw, FolderGit, ChevronRight } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { call } from '../utils/bridge';
import { getWsClient } from '../services/ws-client';
import { getDismissedAutoProjectIds, dismissAutoProject } from '../lib/dismissed-projects';
import { mergeWorktreeLanes } from '../lib/worktree-lanes';
import { getDismissedWorktrees, dismissWorktree } from '../lib/dismissed-worktrees';
import { getProjectOrderIds, setProjectOrderIds, orderProjectsByIds } from '../lib/project-order';
import { deleteSessionAction, toggleArchiveSession } from '../lib/session-actions';
import { undoSessionTurn, compressSession, branchSession, getSessionUsage } from '../utils/api';
import { gitWorktreeList, gitWorktreeRemove, type HermesGitWorktree } from '../lib/git';
import { WorktreeDialog } from './worktree/WorktreeDialog';
import { pickDirectory } from '../utils/directory-picker';
import { notifySuccess, notifyError, notifyInfo } from '../utils/notifications';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog';
import {
  loadPinnedIds, savePinnedIds, writeProjectIdea, RepoNodeItem, ProjectItem,
  type SessionPreview, type LaneGroup, type RepoNode, type ProjectNode, type TreeResult,
  type SessionRowActions, type ProjectTreePanelProps,
} from './ProjectTreeItems';
import { ProjectDialog, SessionRenameDialog } from './ProjectDialogs';

export default function ProjectTreePanel({ sessionId, sessionListVersion, onSwitchSession, currentProfile, onNewSessionInProject, onEnterProject, onProjectScopeChange, onProjectScopeRestored }: ProjectTreePanelProps) {
  const [tree, setTree] = useState<TreeResult | null>(null);
  // 🔴 2026-08-12 点选状态修复 v2（老大指正：点击后全部未激活）：
  //   本地 selectedId = 用户显式点选（纯前端权威），null = 未点选 → 渲染跟随后端 active_id。
  //   ❌ v1 缺陷：fetchTree 成功后 setSelectedId(result.active_id) 回填——点击项目后
  //   set_active → fetchTree → 后端未持久化成功（自动项目/Home 无 set_active、
  //   或后端 active_id 为空）就把本地高亮冲成 null → 点谁都不亮。
  //   ✅ v2：fetchTree 永不写 selectedId（只更新树数据）；仅切 Agent 时重置为 null
  //   （让新 Agent 的 active_id 生效）。点选即持久高亮，不再被任何刷新回跳。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 🔴 2026-08-13 并发修复：切 Agent 后的首次树加载等待 active_id 恢复
  // （用户手动点选 → 清标记 → 不再自动恢复，防覆盖用户意图）
  const profileSwitchPendingRef = useRef(false);
  // 🔴 2026-08-13 并发修复：fetchTree 过期响应守卫（快速切 Agent 时旧 profile 的
  // 响应可能后到——若只靠闭包捕获的 currentProfile，旧响应会把树/scope 写成旧 Agent）
  const currentProfileRef = useRef(currentProfile);
  currentProfileRef.current = currentProfile;
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
      const reqProfile = currentProfile;
      const result = await call('projects_tree', { preview_limit: 3, include_discovered: true, profile: reqProfile });
      // 🔴 2026-08-13 并发修复：过期响应守卫——快速切 Agent 时旧请求返回后直接丢弃
      // （不写树、不触发 scope 恢复；loading 归位由 finally 兜底）
      if (currentProfileRef.current !== reqProfile) return;
      // 🔴 自动项目 dismiss 过滤（对齐 Hermes filterVisibleProjects：本地隐藏，不删后端）
      const dismissed = getDismissedAutoProjectIds();
      if (dismissed.size > 0 && result?.projects) {
        result.projects = result.projects.filter((p: ProjectNode) => !p.isAuto || !dismissed.has(p.id));
      }
      setTree(result);
      // 🔴 2026-08-13 切 Agent 恢复激活项目（老大反馈：项目选中但文件面板"未打开项目"）：
      // 仅切 Agent 后的首次加载（profileSwitchPendingRef）且该 Agent 有 active 项目时恢复
      // scope + 文件面板到激活项目根；不动消息区（会话指针恢复由 handleProfileChange 管）。
      if (profileSwitchPendingRef.current && result?.active_id) {
        profileSwitchPendingRef.current = false;
        const active = result.projects?.find((p: ProjectNode) => p.id === result.active_id);
        if (active?.path) onProjectScopeRestored?.(active.path);
      }
      // 🔴 v2：fetchTree 不写 selectedId（见 state 注释）——任何刷新不得覆盖用户点选
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [currentProfile, onProjectScopeRestored]);

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
    // 🔴 v2：切 Agent 重置本地点选 → 跟随新 Agent 后端 active_id（不串台）
    setSelectedId(null);
    // 🔴 2026-08-13：切 Agent 后的首次树加载等待 active_id 恢复 scope+文件面板
    profileSwitchPendingRef.current = true;
    // 🔴 2026-08-13 抖动修复：切 Agent 刷新改 silent——非 silent 会 setLoading(true)
    // → 树区域整体替换成“加载中...”（区块头+项目卡片全消失 → 高度塌缩）→ 数据
    // 回来再恢复 = 两次突变 = 项目卡片上下抖动。silent 保留旧树直到新数据到达，
    // 一次替换（正常数据刷新，无 loading 闪变）
    void fetchTree(true);
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

  // 🔴 2026-08-13 问题2修复：项目域激活公共逻辑（高亮 + 显式项目 set_active 持久化）。
  // handleActivate（项目行单击）与会话行点击共用；会话行点击不触发 onEnterProject——
  // 其消息区联动会把刚点的会话切回项目最新会话（2026-08-12 stopPropagation 同款教训）。
  const persistActiveProject = useCallback((project: ProjectNode) => {
    // 🔴 2026-08-13：用户点选 = 意图明确，取消切 Agent 自动恢复（防覆盖用户刚点的选择）
    profileSwitchPendingRef.current = false;
    setSelectedId(project.id);
    if (!project.isAuto && !project.isNoProject && project.id) {
      void call('projects_set_active', { id: project.id, profile: currentProfile })
        .then(() => void fetchTree(true))
        .catch(() => {});
    }
  }, [currentProfile, fetchTree]);

  // 🔴 2026-08-13 问题2修复：会话行点击 → 项目域同步激活（高亮 + set_active + scope）。
  // 不触发 onEnterProject（防把刚点的会话切回项目最新会话）；文件面板不强制切项目根
  // （跟随该会话 session.info 的 bound_cwd，符合"文件树=会话 cwd"）。
  const handleSessionRowActivate = useCallback((project: ProjectNode) => {
    persistActiveProject(project);
    onProjectScopeChange?.(project.path ?? null);
  }, [persistActiveProject, onProjectScopeChange]);

  // 🔴 2026-08-12 单击激活（老大指示：单击激活与 Agent 联动，双击才进入项目）：
  //   只做联动：① onEnterProject（文件面板切项目根/workspace + scope + 消息区选最新会话）
  //   ② 显式项目自动设为激活。不进入钻取视图（双击 handleDrill 才钻取）。
  const handleActivate = useCallback((project: ProjectNode) => {
    // 🔴 2026-08-12 点选状态 v2：点击立即置本地高亮（含自动/Home），持久不被刷新回跳
    persistActiveProject(project);
    onEnterProject?.(project.path ?? '', project.previewSessions?.[0]?.id ?? null);
  }, [persistActiveProject, onEnterProject]);

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
      // 🔴 2026-08-13：菜单设激活 = 用户意图，取消切 Agent 自动恢复
      profileSwitchPendingRef.current = false;
      // 🔴 2026-08-12 点选状态修复：菜单设激活同样即时置高亮（与单击路径一致）
      setSelectedId(project.id);
      // 🔴 2026-08-13 边界修复：菜单设激活与单击路径同权——同步项目域 scope
      // （否则高亮切了但 scope 还是旧项目 → 新建会话落错项目，与问题2同类断线）
      onProjectScopeChange?.(project.path ?? null);
      notifySuccess(`已将「${project.label}」设为激活项目`);
      void fetchTree(true);
    } catch (e) {
      notifyError(e, '激活项目失败');
    }
  }, [currentProfile, fetchTree, onProjectScopeChange]);

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

  // 🔴 2026-08-12 树自动刷新：会话变化（新建/切换/发消息 bump）→ 静默重拉 projects.tree——
  //   项目卡片预览会话/计数/时间即时回显（原实现只在 mount/切 Agent/手动刷新时拉，
  //   新会话说话后左侧树不更新 = 老大反馈的缺自动回显机制）
  useEffect(() => {
    if (!currentProfile) return;
    if (sessionId === undefined && sessionListVersion === undefined) return;
    void fetchTree(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionListVersion]);

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
            <div className="flex-1 overflow-y-auto min-h-0">
              {drillProject.repos.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">{drillProject.isNoProject ? '暂无会话' : '无 Repo 分组'}</div>
              ) : (
                drillProject.repos.map(r => (
                  <RepoNodeItem
                    key={r.id}
                    repo={r}
                    sessionId={sessionId}
                    onSwitchSession={onSwitchSession}
                    onSessionRowActivate={() => handleSessionRowActivate(drillProject)}
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
                </div>
                <button
                  className="inline-flex items-center gap-1.5 pl-1 pr-2.5 h-[22px] rounded-full text-[11px] leading-normal font-semibold transition-all duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.12),0_3px_8px_var(--theme-shadow-color)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.16),0_6px_16px_var(--theme-shadow-color-heavy)] hover:brightness-[1.06] hover:-translate-y-[1.5px] shrink-0"
                  onClick={handleCreate}
                  title="新建项目"
                >
                  <Plus size={12} strokeWidth={2.5} className="shrink-0" />
                  新建项目
                </button>
              </div>
              {/* 🔴 2026-08-13 v13：overflow-anchor:none 禁用浏览器滚动锚定——
                  树内容替换（切 Agent）时浏览器会尝试保持“锚定元素”位置自动调整
                  scrollTop → 项目卡片“往下走到中间然后消失”的抖动根因
                  （对齐聊天线程既有用法 style.css [data-slot='aui_thread-viewport']） */}
              <div className="flex-1 overflow-y-auto px-3 pb-2 pt-1.5 space-y-1.5 min-h-0 [scrollbar-gutter:stable] [overflow-anchor:none]">
                {tree.projects.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
                    <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center">
                      <FolderGit size={18} className="text-muted-foreground/40" />
                    </div>
                    <p className="text-xs text-muted-foreground">暂无项目</p>
                    <button
                      className="inline-flex items-center gap-1.5 pl-1 pr-2.5 h-[22px] rounded-full text-[11px] leading-normal font-semibold transition-all duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.12),0_3px_8px_var(--theme-shadow-color)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.16),0_6px_16px_var(--theme-shadow-color-heavy)] hover:brightness-[1.06] hover:-translate-y-[1.5px]"
                      onClick={handleCreate}
                    >
                      <Plus size={12} strokeWidth={2.5} className="shrink-0" />
                      新建项目
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
                      onSessionRowActivate={handleSessionRowActivate}
                      onDrill={handleDrill}
                      onActivate={handleActivate}
                      onEdit={handleEdit}
                      onAddFolder={handleAddFolder}
                      onSetActive={handleSetActive}
                      onReveal={handleReveal}
                      onCopyPath={handleCopyPath}
                      onDelete={setDeleting}
                      onDismiss={handleDismiss}
                      isActiveProject={(selectedId ?? tree.active_id) === p.id}
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
