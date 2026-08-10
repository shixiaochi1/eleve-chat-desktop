/**
 * 图标栏 — Apple 风格左侧竖向导航
 * Logo 按钮和其它工具栏一样，点击切换面板
 */
import { cn } from '@/lib/utils';
import {
  ChatIcon, CronIcon,
  DebugIcon, SettingsIcon, AboutIcon,
  PaletteIcon, ToolIcon, FileIcon,
  UsageIcon, ChannelsIcon, KanbanIcon, AgentIcon,
} from './Icons';
import { FolderGit, BookOpen } from 'lucide-react';
import { openKanbanWindow } from '../utils/kanban-window';

interface NavItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isWindow?: boolean;
  isOverlay?: boolean;
  /** 自定义点击（如文件浏览器走 onToggleFiles，不参与 panel 切换） */
  onClick?: () => void;
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
    { id: 'agents',   icon: AgentIcon,   label: 'Agent' },
    { id: 'projects', icon: FolderGit,  label: '项目' },
    { id: 'files',    icon: FileIcon,   label: '文件浏览器', onClick: onToggleFiles },
    { id: 'kanban',   icon: KanbanIcon,  label: '看板', isWindow: true },
    { id: 'channels', icon: ChannelsIcon, label: '频道' },
    { id: 'cron',     icon: CronIcon,     label: '定时任务' },
    { id: 'tools',    icon: ToolIcon,     label: '工具' },
    { id: 'learning', icon: BookOpen,    label: '学习' },
    { id: 'usage',    icon: UsageIcon,    label: '用量分析' },
    { id: 'debug',    icon: DebugIcon,    label: '调试' },
  ];

  const bottomItems: NavItem[] = [
    { id: 'settings', icon: SettingsIcon, label: '设置', isOverlay: true },
  ];

  const logoActive = activePanel === 'gateway';

  // ── 统一导航按钮样式（渐变激活态 + 精致指示条 + hover 微动效） ──
  const navBtnBase =
    'group flex items-center justify-center w-10 h-10 rounded-[10px] text-muted-foreground transition-all duration-150 hover:bg-accent/50 hover:text-accent-foreground hover:scale-[1.04] active:scale-[0.97] relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
  const navBtnActive =
    'bg-gradient-to-b from-accent to-accent/70 text-accent-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.08)]';
  const indicator =
    'absolute -right-0.5 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-accent-foreground/90 shadow-[0_0_5px_rgba(0,0,0,0.15)]';

  const renderButton = (item: NavItem) => {
    const isActive = activePanel === item.id;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        role="tab"
        aria-selected={isActive}
        className={cn(navBtnBase, isActive && navBtnActive)}
        title={item.label}
        aria-label={item.label}
        onClick={() => {
          if (item.onClick) {
            item.onClick();
          } else if (item.isOverlay) {
            onOpenOverlay?.(item.id);
          } else if (item.isWindow) {
            openKanbanWindow();
          } else {
            onPanelChange?.(isActive ? null : item.id);
          }
        }}
      >
        <Icon className={cn('w-5 h-5 transition-transform duration-150', isActive ? 'scale-105' : 'group-hover:scale-105')} />
        {isActive && <span className={indicator} />}
      </button>
    );
  };

  return (
    <nav role="tablist" className="flex flex-col items-center w-14 h-full py-2 gap-1 select-none" style={{ background: 'transparent' }}>
      {/* 顶部品牌 Logo 按钮 — 和工具栏一样切换面板 */}
      <button
        className={cn(
          'group flex items-center justify-center w-10 h-10 rounded-[10px] relative transition-all duration-150 hover:scale-[1.04] active:scale-[0.97]',
          logoActive && navBtnActive
        )}
        title={`Eleve Agent · ${gatewayOnline ? '在线' : '离线'}`}
        aria-label="网关状态"
        onClick={() => onPanelChange?.(logoActive ? null : 'gateway')}
      >
        <img src="/Elogo.svg" alt="Eleve" className="w-6 h-6 rounded transition-transform duration-150 group-hover:scale-105" />
        {logoActive && <span className={indicator} />}
      </button>

      {/* 导航图标 */}
      <div className="flex flex-col items-center gap-0.5 flex-1 py-2">
        {navItems.map(renderButton)}
      </div>

      {/* 底部 */}
      <div className="flex flex-col items-center gap-0.5 py-2 border-t border-border">
        {bottomItems.map(renderButton)}
        <button
          className={cn(navBtnBase)}
          title="主题"
          aria-label="切换主题"
          onClick={() => onOpenOverlay?.('theme')}
        >
          <PaletteIcon className="w-5 h-5 transition-transform duration-150 group-hover:scale-105" />
        </button>
        <button
          className={cn(navBtnBase)}
          title="关于"
          aria-label="关于"
          onClick={() => onOpenOverlay?.('about')}
        >
          <AboutIcon className="w-5 h-5 transition-transform duration-150 group-hover:scale-105" />
        </button>
      </div>
    </nav>
  );
}
