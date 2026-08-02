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
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, FolderGit, GitBranch, FolderOpen, Blocks, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';
import { getWsClient } from '../services/ws-client';

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
}

// ── Props ──

interface ProjectTreePanelProps {
  sessionId?: string;
  onSwitchSession?: (id: string) => void;
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

function ProjectItem({ project, sessionId, onSwitchSession, onDrill }: { project: ProjectNode; sessionId?: string; onSwitchSession?: (id: string) => void; onDrill: (p: ProjectNode) => void }) {
  const [expanded, setExpanded] = useState(true);
  const previews = project.previewSessions ?? [];

  return (
    <div className="border-b border-border/50">
      {/* 项目行：点击钻取（全量 lane 树）；chevron 展开/收起预览 */}
      <div
        className="flex items-center gap-1.5 pl-3 pr-3 py-2 cursor-pointer hover:bg-accent/20 text-sm"
        onClick={() => onDrill(project)}
        title="点击进入项目（完整 Repo/Lane 树）"
      >
        <TreeToggle expanded={expanded} onClick={() => setExpanded(!expanded)} />
        {project.isAuto
          ? <FolderOpen size={14} className="text-muted-foreground shrink-0" />
          : <div className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color || 'var(--ui-blue, #6366f1)' }} />
        }
        <span className="truncate flex-1 font-medium">{project.label}</span>
        {project.sessionCount > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{project.sessionCount}</span>
        )}
        <span className="text-[10px] text-muted-foreground/50">{fmtTime(project.lastActive)}</span>
      </div>
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

// ── Panel ──

export default function ProjectTreePanel({ sessionId, onSwitchSession }: ProjectTreePanelProps) {
  const [tree, setTree] = useState<TreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 阶段二·钻取状态（projects.project_sessions，hydrate=true 全量水合）
  const [drill, setDrill] = useState<ProjectNode | null>(null);
  const [drillProject, setDrillProject] = useState<ProjectNode | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await call('projects_tree', { preview_limit: 3, include_discovered: true });
      setTree(result);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 钻取：点击项目行 → 全量水合的 Repo/Lane/Session 树
  const handleDrill = useCallback(async (project: ProjectNode) => {
    setDrill(project);
    setDrillProject(null);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const res: any = await call('projects_project_sessions', { project_id: project.id });
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
  }, []);

  const handleBack = useCallback(() => {
    setDrill(null);
    setDrillProject(null);
    setDrillError(null);
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
              <button className="text-xs text-primary hover:underline" onClick={fetchTree}>重试</button>
            </div>
          )}
          {tree && (
            <div className="flex-1 overflow-y-auto">
              {tree.projects.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4">暂无项目</div>
              ) : (
                tree.projects.map(p => (
                  <ProjectItem key={p.id} project={p} sessionId={sessionId} onSwitchSession={onSwitchSession} onDrill={handleDrill} />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
