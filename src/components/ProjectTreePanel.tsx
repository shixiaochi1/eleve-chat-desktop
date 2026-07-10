/**
 * ProjectTreePanel — Hermes 对齐 Project → Repo → Lane → Session 三级分组树
 *
 * 调用后端 projects.tree / projects.project_sessions WS 方法
 * 展示权威项目分组树：Project → Repo → Lane → Session
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, FolderGit, GitBranch, FolderOpen, Blocks, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { call } from '../utils/bridge';

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
    <span className="shrink-0 text-muted-foreground cursor-pointer hover:text-foreground" onClick={onClick}>
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
        {lane.isKanban ? <Blocks size={12} className="text-blue-400" /> : <GitBranch size={12} className="text-muted-foreground" />}
        <span className="truncate flex-1">{lane.label}</span>
        <span className="text-[10px] text-muted-foreground">{lane.sessions.length}</span>
      </div>
      {expanded && lane.sessions.map(s => (
        <SessionItem key={s.id} s={s} isActive={s.id === sessionId} onClick={() => onSwitchSession?.(s.id)} />
      ))}
    </div>
  );
}

function RepoNodeItem({ repo, sessionId, onSwitchSession }: { repo: RepoNode; sessionId?: string; onSwitchSession?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

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

function ProjectItem({ project, sessionId, onSwitchSession }: { project: ProjectNode; sessionId?: string; onSwitchSession?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-b border-border/50">
      <div
        className="flex items-center gap-1.5 pl-3 pr-3 py-2 cursor-pointer hover:bg-accent/20 text-sm"
        onClick={() => setExpanded(!expanded)}
      >
        <TreeToggle expanded={expanded} onClick={() => setExpanded(!expanded)} />
        {project.isAuto
          ? <FolderOpen size={14} className="text-muted-foreground shrink-0" />
          : <div className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color || '#6366f1' }} />
        }
        <span className="truncate flex-1 font-medium">{project.label}</span>
        {project.sessionCount > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{project.sessionCount}</span>
        )}
        <span className="text-[10px] text-muted-foreground/50">{fmtTime(project.lastActive)}</span>
      </div>
      {expanded && project.repos.map(r => (
        <RepoNodeItem key={r.id} repo={r} sessionId={sessionId} onSwitchSession={onSwitchSession} />
      ))}
    </div>
  );
}

// ── Panel ──

export default function ProjectTreePanel({ sessionId, onSwitchSession }: ProjectTreePanelProps) {
  const [tree, setTree] = useState<TreeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => { fetchTree(); }, [fetchTree]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
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
              <ProjectItem key={p.id} project={p} sessionId={sessionId} onSwitchSession={onSwitchSession} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
