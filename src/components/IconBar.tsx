/**
 * 图标栏 — Apple 风格左侧竖向导航
 * Logo 按钮和其它工具栏一样，点击切换面板
 */
import { cn } from '@/lib/utils';
import {
  ChatIcon, CronIcon,
  DebugIcon, SettingsIcon, AboutIcon,
  PaletteIcon, ToolIcon, FileIcon, MemoryIcon,
  UsageIcon, ChannelsIcon, KanbanIcon, AgentIcon,
} from './Icons';
import { FolderGit } from 'lucide-react';
import { openKanbanWindow } from '../utils/kanban-window';

interface NavItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isWindow?: boolean;
  isOverlay?: boolean;
}

interface IconBarProps {
  activePanel?: string | null;
  onPanelChange?: (panel: string | null) => void;
  onOpenOverlay?: (id: string) => void;
  gatewayOnline?: boolean;
  onToggleFiles?: () => void;
}

export default function IconBar({ activePanel, onPanelChange, onOpenOverlay, gatewayOnline, onToggleFiles }: IconBarProps) {
  const navItems: NavItem[] = [
    { id: 'sessions', icon: ChatIcon,    label: '会话' },
    { id: 'projects', icon: FolderGit,  label: '项目' },
    { id: 'kanban',   icon: KanbanIcon,  label: '看板', isWindow: true },
    { id: 'agents',   icon: AgentIcon,   label: '多 Profile' },
    { id: 'channels', icon: ChannelsIcon, label: '频道' },
    { id: 'memory',   icon: MemoryIcon,  label: '记忆' },
    { id: 'cron',     icon: CronIcon,     label: '定时任务' },
    { id: 'tools',    icon: ToolIcon,     label: '工具' },
    { id: 'usage',    icon: UsageIcon,    label: '用量分析' },
    { id: 'debug',    icon: DebugIcon,    label: '调试' },
  ];

  const bottomItems: NavItem[] = [
    { id: 'settings', icon: SettingsIcon, label: '设置', isOverlay: true },
  ];

  const logoActive = activePanel === 'gateway';

  const renderButton = (item: NavItem) => {
    const isActive = activePanel === item.id;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        role="tab"
        aria-selected={isActive}
        className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors relative',
          isActive && 'bg-accent text-accent-foreground'
        )}
        title={item.label}
        aria-label={item.label}
        onClick={() => {
          if (item.isOverlay) {
            onOpenOverlay?.(item.id);
          } else if (item.isWindow) {
            openKanbanWindow();
          } else {
            onPanelChange?.(isActive ? null : item.id);
          }
        }}
      >
        <Icon className="w-5 h-5" />
        {isActive && <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-1 h-4 bg-accent-foreground rounded-full" />}
      </button>
    );
  };

  return (
    <nav role="tablist" className="flex flex-col items-center w-14 h-full py-2 gap-1 select-none" style={{ background: 'transparent' }}>
      {/* 顶部品牌 Logo 按钮 — 和工具栏一样切换面板 */}
      <button
        className={cn(
          'flex items-center justify-center w-10 h-10 rounded-lg relative transition-colors',
          logoActive && 'bg-accent'
        )}
        title={`Eleve Agent · ${gatewayOnline ? '在线' : '离线'}`}
        aria-label="网关状态"
        onClick={() => onPanelChange?.(logoActive ? null : 'gateway')}
      >
        <img src="/Elogo.svg" alt="Eleve" className="w-6 h-6 rounded" />
        <span className={cn(
          'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-sidebar',
          gatewayOnline ? 'bg-success' : 'bg-danger'
        )} />
        {logoActive && <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-1 h-4 bg-accent-foreground rounded-full" />}
      </button>

      {/* 导航图标 */}
      <div className="flex flex-col items-center gap-0.5 flex-1 py-2">
        {navItems.map(renderButton)}
      </div>

      {/* 底部 */}
      <div className="flex flex-col items-center gap-0.5 py-2 border-t border-border">
        {bottomItems.map(renderButton)}
        <button
          className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
          title="文件浏览器"
          aria-label="文件浏览器"
          onClick={onToggleFiles}
        >
          <FileIcon className="w-5 h-5" />
        </button>
        <button
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors'
          )}
          title="主题"
          aria-label="切换主题"
          onClick={() => onOpenOverlay?.('theme')}
        >
          <PaletteIcon className="w-5 h-5" />
        </button>
        <button
          className="flex items-center justify-center w-10 h-10 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground transition-colors"
          title="关于"
          aria-label="关于"
          onClick={() => onOpenOverlay?.('about')}
        >
          <AboutIcon className="w-5 h-5" />
        </button>
      </div>
    </nav>
  );
}
