/**
 * 侧边面板容器 — 中间栏 260px
 * 根据 activePanel 渲染不同内容
 * 包含顶部标题 + 内容区
 */
import { cn } from '@/lib/utils';
import type { Session } from '@/types';
import AgentsPanel from './AgentsPanel';
import CronPanel from './CronPanel';
import DebugPanel from './DebugPanel';
import ToolsPanel from './ToolsPanel';
import GatewayPanel from './GatewayPanel';
import MemoryPanel from './MemoryPanel';
import UsagePanel from './UsagePanel';
import ProcessPanel from './ProcessPanel';
import RollbackPanel from './RollbackPanel';
import LearningPanel from './LearningPanel';
import ChannelsPanel from './ChannelsPanel';
// kanban 移至 OverlayView 弹出（需要更大空间展示5列看板）
import {
  CronIcon,
  DebugIcon, ToolIcon, MemoryIcon,
  UsageIcon, ChannelsIcon, AgentIcon,
} from './Icons';
import { Radio, FolderGit, Activity, GitCommit, BookOpen } from 'lucide-react';
import ProjectTreePanel from './ProjectTreePanel';

interface SidePanelProps {
  activePanel?: string | null;
  onPanelChange?: (panel: string | null) => void;
  gatewayOnline?: boolean;
  // ── Agent / Profile ──
  currentProfile?: string;
  /** 🔴 昵称全局生效：当前 Agent 的显示名（display_name），由 App 从 ProfilePanel 上抛映射解析 */
  currentProfileLabel?: string;
  onProfileChange?: (name: string) => void;
  onProfilesChange?: (count: number) => void;
  /** 🔴 昵称映射上抛（name → display_name），App 驱动状态栏/会话列表 */
  onDisplayNamesChange?: (map: Record<string, string>) => void;
  onOpenSettings?: () => void;
  onRestart?: () => void;
  // ── 会话 ──
  sessionId?: string | null;
  sessions?: Session[];
  onSwitchSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  sessionTitles?: Record<string, string>;
  onRenameTitle?: (id: string, title: string) => void;
  onNewSession?: () => void;
  isStreaming?: boolean;
  messageCount?: number;
}

export default function SidePanel({ activePanel, onPanelChange, ...props }: SidePanelProps) {
  if (!activePanel) return null;

  const panels: Record<string, { title: string; Icon: React.ComponentType<any>; component: React.ComponentType<any> }> = {
    agents:   { title: 'Agent', Icon: AgentIcon,   component: AgentsPanel },
    gateway:  { title: '网关状态',   Icon: Radio,       component: GatewayPanel },
    projects: { title: '项目',     Icon: FolderGit,  component: ProjectTreePanel },
    channels: { title: '频道',     Icon: ChannelsIcon, component: ChannelsPanel },
    cron:     { title: '定时任务', Icon: CronIcon,    component: CronPanel },
    memory:   { title: '记忆',     Icon: MemoryIcon,  component: MemoryPanel },
    tools:    { title: '工具',     Icon: ToolIcon,    component: ToolsPanel },
    processes: { title: '进程',     Icon: Activity,    component: ProcessPanel },
    learning: { title: '学习',     Icon: BookOpen,   component: LearningPanel },
    rollback: { title: '回滚',     Icon: GitCommit,  component: RollbackPanel },
    debug:    { title: '调试',     Icon: DebugIcon,   component: DebugPanel },
    usage:    { title: '用量分析', Icon: UsageIcon,   component: UsagePanel },
  };

  const cfg = panels[activePanel];
  if (!cfg) return null;

  const PanelComponent = cfg.component;
  const HeaderIcon = cfg.Icon;

  return (
    <aside role="tabpanel" aria-label={cfg.title} className="h-full flex flex-col overflow-hidden flex-1 min-w-0">
      {/* 面板头部 — gateway/agents 面板自带标题，隐藏 */}
      {activePanel !== 'gateway' && activePanel !== 'agents' && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <HeaderIcon size={16} strokeWidth={1.5} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{cfg.title}</span>
        </div>
      )}

      {/* 面板内容 — 用 key 触发 panel-enter 动画 */}
      <div className="flex-1 overflow-hidden min-h-0">
        {PanelComponent ? (
          <div key={activePanel} className="panel-enter h-full">
            <PanelComponent {...props} activePanel={activePanel} onPanelChange={onPanelChange} />
          </div>
        ) : (
          <div key={activePanel} className="panel-enter flex flex-col items-center justify-center py-12 text-muted-foreground gap-1">
            <span className="text-sm">{cfg.title} — 开发中</span>
            <span className="text-xs text-muted-foreground/60">后续 Phase 实现</span>
          </div>
        )}
      </div>
    </aside>
  );
}
