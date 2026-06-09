/**
 * 侧边面板容器 — 中间栏 260px
 * 根据 activePanel 渲染不同内容
 * 包含顶部标题 + 内容区
 */
import { cn } from '@/lib/utils';
import SessionsPanel from './SessionsPanel';
import CronPanel from './CronPanel';
import DebugPanel from './DebugPanel';
import ToolsPanel from './ToolsPanel';
import GatewayPanel from './GatewayPanel';
import MemoryPanel from './MemoryPanel';
import UsagePanel from './UsagePanel';
import ChannelsPanel from './ChannelsPanel';
// kanban 移至 OverlayView 弹出（需要更大空间展示5列看板）
import AgentPanel from './AgentPanel';
import {
  ChatIcon, CronIcon,
  DebugIcon, ToolIcon, MemoryIcon,
  UsageIcon, ChannelsIcon, AgentIcon,
} from './Icons';
import { Radio } from 'lucide-react';

interface SidePanelProps {
  activePanel?: string | null;
  onPanelChange?: (panel: string | null) => void;
  gatewayOnline?: boolean;
  [key: string]: unknown;
}

export default function SidePanel({ activePanel, onPanelChange, ...props }: SidePanelProps) {
  if (!activePanel) return null;

  const panels: Record<string, { title: string; Icon: React.ComponentType<any>; component: React.ComponentType<any> }> = {
    agents:   { title: 'Agent 协作', Icon: AgentIcon,   component: AgentPanel },
    gateway:  { title: '网关状态',   Icon: Radio,       component: GatewayPanel },
    sessions: { title: '会话',     Icon: ChatIcon,    component: SessionsPanel },
    channels: { title: '频道',     Icon: ChannelsIcon, component: ChannelsPanel },
    cron:     { title: '定时任务', Icon: CronIcon,    component: CronPanel },
    memory:   { title: '记忆',     Icon: MemoryIcon,  component: MemoryPanel },
    tools:    { title: '工具',     Icon: ToolIcon,    component: ToolsPanel },
    debug:    { title: '调试',     Icon: DebugIcon,   component: DebugPanel },
    usage:    { title: '用量分析', Icon: UsageIcon,   component: UsagePanel },
  };

  const cfg = panels[activePanel];
  if (!cfg) return null;

  const PanelComponent = cfg.component;
  const HeaderIcon = cfg.Icon;

  return (
    <aside role="tabpanel" aria-label={cfg.title} className="h-full flex flex-col overflow-hidden flex-1 min-w-0">
      {/* 面板头部 — gateway 面板自带标题，隐藏 */}
      {activePanel !== 'gateway' && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <HeaderIcon size={16} strokeWidth={1.5} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{cfg.title}</span>
        </div>
      )}

      {/* 面板内容 — 用 key 触发 panel-enter 动画 */}
      <div className="flex-1 overflow-hidden min-h-0">
        {PanelComponent ? (
          <div key={activePanel} className="panel-enter h-full">
            <PanelComponent {...props} activePanel={activePanel} onPanelChange={onPanelChange} gatewayOnline={props.gatewayOnline} />
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
