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
import UsagePanel from './UsagePanel';
import ProcessPanel from './ProcessPanel';
import RollbackPanel from './RollbackPanel';
import LearningPanel from './LearningPanel';
import ChannelsPanel from './ChannelsPanel';
import KanbanPanelForSidebar from './KanbanPanelForSidebar';
import {
  CronIcon,
  DebugIcon, ToolIcon,
  UsageIcon, ChannelsIcon, AgentIcon, KanbanIcon,
} from './Icons';
import { Radio, Activity, GitCommit, BookOpen, Bot as BotIcon } from 'lucide-react';
import { useContributions } from '@/contrib/registry';
import type { Contribution } from '@/contrib/registry';

/** 🔴 2026-09-05 round-42：插件贡献的左栏 pane（sidePanel.pane area——
 * 对齐 Hermes hermes-bots 的 panes 贡献形态：Bots pane 进左栏 tab strip） */
interface PluginPaneContribution {
  component: React.ComponentType<any>;
}

interface SidePanelProps {
  activePanel?: string | null;
  onPanelChange?: (panel: string | null) => void;
  gatewayOnline?: boolean;
  /** 网关检测中（GatewayPanel 透传） */
  gatewayChecking?: boolean;
  /** 网关重连（GatewayPanel 透传，pool/port 重新探测） */
  onGatewayRetry?: () => void;
  /** 🔴 2026-08-13 v8：Agent 数量（App agentCount 唯一持有者，ProfilePanel onProfilesChange 上抛）
   *  —— AgentsPanel 高度对齐的唯一触发器（老大逻辑：数量不变 → 项目区完全不动） */
  agentCount?: number;
  // ── Agent / Profile ──
  currentProfile?: string;
  /** 🔴 昵称全局生效：当前 Agent 的显示名（display_name），由 App 从 ProfilePanel 上抛映射解析 */
  currentProfileLabel?: string;
  onProfileChange?: (name: string) => void;
  onProfilesChange?: (count: number) => void;
  /** 🔴 昵称映射上抛（name → display_name），App 驱动状态栏/会话列表 */
  onDisplayNamesChange?: (map: Record<string, string>) => void;
  /** 🔴 颜色映射上抛（name → color），App 驱动编辑面板初始色/宫格卡片主题色 */
  onColorsChange?: (map: Record<string, string>) => void;
  /** 🔴 默认头像 key 映射上抛（name → avatar_key），App 驱动编辑面板初始头像 */
  onAvatarKeysChange?: (map: Record<string, string>) => void;
  /** 🔴 编辑保存后自增：触发 Agent 列表重拉（昵称/颜色热更新） */
  refreshSignal?: number;
  /** 双击 Agent 卡片 → 打开编辑面板（App 层渲染 EditAgentDialog） */
  onEditAgent?: (name: string) => void;
  onOpenSettings?: () => void;
  onRestart?: () => void;
  /** 🔴 2026-08-13 问题2：会话行点击 → 项目域 scope 同步（透传 ProjectTreePanel） */
  onProjectScopeChange?: (path: string | null) => void;
  /** 🔴 2026-08-13 切 Agent 恢复激活项目（透传 ProjectTreePanel） */
  onProjectScopeRestored?: (path: string | null) => void;
  // ── 会话 ──
  sessionId?: string | null;
  sessions?: Session[];
  onSwitchSession?: (id: string) => void;
  /** 🔴 2026-09-04 Bot Mode：打开 bot 的 canonical chat（宫格先退单视图 + forceProfile） */
  onOpenBotChat?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  sessionTitles?: Record<string, string>;
  onRenameTitle?: (id: string, title: string) => void;
  onNewSession?: () => void;
  isStreaming?: boolean;
  messageCount?: number;
  /** 🔴 2026-08-12 会话列表版本号（新建/切会话/发消息 bump）——透传给 ProjectTreePanel 做树自动刷新信号 */
  sessionListVersion?: number;
  /** 🔴 在该项目新建会话（对齐 Hermes onNewSessionInWorkspace）：worktree 创建成功后的自动建会话 */
  onNewSessionInProject?: (cwd: string) => void;
  /** 🔴 2026-08-09 进入项目（对齐 Hermes onEnterProject/syncProjectCwd）：
   *  透传给 ProjectTreePanel——进入时文件面板切项目根目录 + 设 scope（新会话落点）；
   *  2026-08-12 扩展：第二参 = 后端分组的最活跃会话 id（消息区联动，无则前端兜底） */
  onEnterProject?: (path: string, sessionId?: string | null) => void;
}

export default function SidePanel({ activePanel, onPanelChange, ...props }: SidePanelProps) {
  if (!activePanel) return null;

  const panels: Record<string, { title: string; Icon: React.ComponentType<any>; component: React.ComponentType<any> }> = {
    agents:   { title: 'Agent', Icon: AgentIcon,   component: AgentsPanel },
    kanban:   { title: '看板', Icon: KanbanIcon,   component: KanbanPanelForSidebar },
    gateway:  { title: '网关状态',   Icon: Radio,       component: GatewayPanel },
    // 🔴 2026-08-12：projects 面板已合并进 Agent 面板（AgentsPanel 内嵌项目区），
    //   IconBar 无入口，此配置为死项已删除
    channels: { title: '频道',     Icon: ChannelsIcon, component: ChannelsPanel },
    cron:     { title: '定时任务', Icon: CronIcon,    component: CronPanel },
    tools:    { title: '工具',     Icon: ToolIcon,    component: ToolsPanel },
    processes: { title: '进程',     Icon: Activity,    component: ProcessPanel },
    learning: { title: '学习',     Icon: BookOpen,   component: LearningPanel },
    rollback: { title: '回滚',     Icon: GitCommit,  component: RollbackPanel },
    debug:    { title: '调试',     Icon: DebugIcon,   component: DebugPanel },
    usage:    { title: '用量分析', Icon: UsageIcon,   component: UsagePanel },
  };

  const cfg = panels[activePanel];
  if (!cfg) {
    // 🔴 2026-09-05 round-42：插件贡献 pane 回退（sidePanel.pane area）——
    // 静态 panels 表未命中时查插件贡献（bots pane 等），props 全量透传
    // （贡献组件经 shim 桥 host 门回调，与 App 直传等价）。
    return <PluginPaneSlot panelId={activePanel} panelProps={props} />;
  }

  const PanelComponent = cfg.component;
  const HeaderIcon = cfg.Icon;

  return (
    <aside role="tabpanel" aria-label={cfg.title} className="h-full flex flex-col overflow-hidden flex-1 min-w-0">
      {/* 面板头部 — gateway/agents/tools/kanban 面板自带标题或 Tab 栏，隐藏 */}
      {activePanel !== 'gateway' && activePanel !== 'agents' && activePanel !== 'tools' && activePanel !== 'kanban' && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--ui-stroke-tertiary)] shrink-0">
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

/** 插件 pane 槽位（sidePanel.pane 贡献的渲染器；无匹配贡献 = 空）。
 *  独立组件：useContributions 是 hook，必须在组件体内调用。 */
function PluginPaneSlot({ panelId, panelProps }: { panelId: string; panelProps: Record<string, unknown> }) {
  const panes = useContributions<PluginPaneContribution>('sidePanel.pane');
  const match = panes.find((c: Contribution<PluginPaneContribution>) => c.id.endsWith(`:${panelId}`) || c.id === panelId);
  if (!match?.data) return null;
  const Comp = match.data.component;
  if (!Comp) return null;
  return (
    <aside role="tabpanel" aria-label={match.title} className="h-full flex flex-col overflow-hidden flex-1 min-w-0">
      <div className="flex-1 overflow-hidden min-h-0">
        <div className="panel-enter h-full">
          <Comp {...panelProps} activePanel={panelId} />
        </div>
      </div>
    </aside>
  );
}
