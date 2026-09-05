/**
 * 图标栏 — Apple 风格左侧竖向导航
 * Logo 按钮和其它工具栏一样，点击切换面板
 */
import { cn } from '@/lib/utils';
import {
  ChatIcon, CronIcon,
  DebugIcon, SettingsIcon, AboutIcon,
  PaletteIcon, ToolIcon,
  UsageIcon, ChannelsIcon, KanbanIcon, AgentIcon,
} from './Icons';
import { FolderGit, BookOpen } from 'lucide-react';
// 🔴 2026-08-16（平台受限项 d1 P0-5 闭合）：看板在飞计数（对齐 Hermes
//   KanbanCount）——IconBar kanban 图标右上角 running+ready 角标
import { useKanbanActiveCount } from '../hooks/useKanbanActiveCount';
// 🔴 2026-09-04 插件底座：IconBar 追加区消费 iconBar.action 贡献
//   （外挂应用注册/插件快捷动作；画布已迁为 canvas 插件贡献）
import { AREA_ICON_BAR_ACTION, useContributions, type IconBarActionData } from '../contrib';

interface NavItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isWindow?: boolean;
  isOverlay?: boolean;
  /** 自定义点击（如文件浏览器走 onToggleFiles，不参与 panel 切换） */
  onClick?: () => void;
  /** 右上角计数角标（>0 才显示；对齐 Hermes 无在飞任务时隐藏） */
  badge?: number;
  /** 🔴 2026-09-05 round-51：排序键（与插件 iconBar.action 贡献的 data.order
   *  合一排序——静态项与插件项可交错，群聊/画布得以插到文件浏览器与看板之间） */
  order?: number;
}

interface IconBarProps {
  activePanel?: string | null;
  onPanelChange?: (panel: string | null) => void;
  onOpenOverlay?: (id: string) => void;
  gatewayOnline?: boolean;
  onToggleFiles?: () => void;
}

export default function IconBar({ activePanel, onPanelChange, onOpenOverlay, gatewayOnline, onToggleFiles }: IconBarProps) {
  // 🔴 2026-08-16（d1 P0-5 闭合）：在飞计数——gateway 在线才轮询；
  //   计数仅作角标展示，点击行为仍走 kanban 项既有切换逻辑
  const { running, ready, active } = useKanbanActiveCount(Boolean(gatewayOnline));
  const navItems: NavItem[] = [
    { id: 'agents',   icon: AgentIcon,   label: 'Agent', order: 10 },
    // 🔴 2026-08-12 老大指示：取消"项目"按钮（项目功能已合并进 Agent 面板）；
    //   文件浏览器图标换成原项目图标（FolderGit），行为不变（开右侧文件抽屉）
    { id: 'files',    icon: FolderGit,  label: '文件浏览器', onClick: onToggleFiles, order: 20 },
    // 🔴 stage-4：bots 主区入口已迁 bots 插件（iconBar.action 贡献——
    // 禁用 Bot Mode 插件 = 无入口，对齐 Hermes "disable here if unwanted"）
    { id: 'kanban',   icon: KanbanIcon,  label: '看板', isWindow: true, badge: active, order: 40 },
    { id: 'cron',     icon: CronIcon,     label: '定时任务', order: 50 },
    { id: 'tools',    icon: ToolIcon,     label: '工具', order: 60 },
    { id: 'learning', icon: BookOpen,    label: '学习', order: 70 },
    // 🔴 2026-08-12 老大指示：频道按钮移到用量分析前面
    { id: 'channels', icon: ChannelsIcon, label: '频道', order: 80 },
    { id: 'usage',    icon: UsageIcon,    label: '用量分析', order: 90 },
    { id: 'debug',    icon: DebugIcon,    label: '调试', order: 100 },
  ];

  // 插件 iconBar.action 贡献（order 升序）转追加区 NavItem
  const pluginActions = useContributions<IconBarActionData>(AREA_ICON_BAR_ACTION);
  const pluginNavItems: NavItem[] = pluginActions
    .map(c => ({ c, data: c.data as IconBarActionData }))
    .map(({ c, data }) => ({
      id: c.id,
      icon: data.icon,
      label: data.label,
      onClick: data.activate,
      // 🔴 2026-09-05 round-53 修复：映射必须携带 order——此前丢失导致
      // 合并排序时插件项 fallback 100 排到末尾，群聊/画布"重排"实际未生效
      order: data.order,
    }));

  const bottomItems: NavItem[] = [
    { id: 'settings', icon: SettingsIcon, label: '设置', isOverlay: true },
  ];

  const logoActive = activePanel === 'gateway';

  // ── 统一导航按钮样式（渐变激活态 + 精致指示条 + hover 微动效） ──
  const navBtnBase =
    'group flex items-center justify-center w-10 h-10 rounded-[10px] text-muted-foreground transition-all duration-150 hover:bg-accent/50 hover:text-accent-foreground hover:scale-[1.04] active:scale-[0.97] relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
  const navBtnActive =
    'bg-gradient-to-b from-accent to-accent/70 text-accent-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_var(--theme-shadow-color)]';
  const indicator =
    'absolute -right-0.5 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-accent-foreground/90 shadow-[0_0_5px_var(--theme-shadow-color)]';

  const renderButton = (item: NavItem) => {
    const isActive = activePanel === item.id;
    const Icon = item.icon;
    // 🔴 2026-08-16（d1 P0-5 闭合）：有在飞任务时 tooltip 细分 running/ready
    //   （对齐 Hermes countTip(running, ready)）
    const title = item.id === 'kanban' && active > 0
      ? `${item.label} · ${running} 运行中 · ${ready} 就绪`
      : item.label;
    return (
      <button
        key={item.id}
        role="tab"
        aria-selected={isActive}
        className={cn(navBtnBase, isActive && navBtnActive)}
        title={title}
        aria-label={item.label}
        onClick={() => {
          if (item.onClick) {
            item.onClick();
          } else if (item.isOverlay) {
            onOpenOverlay?.(item.id);
          } else if (item.isWindow) {
            // 看板：切换到侧边栏面板
            onPanelChange?.(isActive ? null : item.id);
          } else {
            onPanelChange?.(isActive ? null : item.id);
          }
        }}
      >
        <Icon className={cn('w-5 h-5 transition-transform duration-150', isActive ? 'scale-105' : 'group-hover:scale-105')} />
        {isActive && <span className={indicator} />}
        {/* 🔴 2026-08-16（d1 P0-5 闭合）：在飞计数角标——>0 才显示，
            无在飞任务时隐藏（对齐 Hermes KanbanCount active===0 → null） */}
        {item.badge != null && item.badge > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[0.6rem] font-bold flex items-center justify-center leading-none shadow-[0_1px_3px_rgba(0,0,0,0.35)] border border-white/20 pointer-events-none"
            style={{ animation: 'scaleIn 150ms ease-out' }}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
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
        {/* 🔴 2026-09-05 round-51：静态项与插件贡献按 order 合一排序——
            群聊(25)/画布(30)得以插到文件浏览器(20)与看板(40)之间 */}
        {[...navItems, ...pluginNavItems]
          .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
          .map(renderButton)}
      </div>

      {/* 底部 */}
      <div className="flex flex-col items-center gap-0.5 py-2 border-t border-[var(--ui-stroke-tertiary)]">
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
