import { Shield, Zap, Lock, Power, FolderOpen, Brain, Wrench, Plug, MessageCircle, ShieldCheck, Mic, Network, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** 导航分组（对齐 Hermes gapBefore 纯视觉间隔，不展示组标签） */
const NAV_GROUPS: Array<{ id: string; items: NavItem[] }> = [
  {
    id: 'model',
    items: [
      { id: 'providers', label: '服务商', icon: Shield },
      { id: 'models', label: '模型', icon: Zap },
      { id: 'connection', label: '连接', icon: Network },
    ],
  },
  {
    id: 'experience',
    items: [
      { id: 'workspace', label: '工作区', icon: FolderOpen },
      { id: 'chat', label: '聊天', icon: MessageCircle },
      { id: 'voice', label: '语音', icon: Mic },
    ],
  },
  {
    id: 'data',
    items: [
      { id: 'memory', label: '记忆', icon: Brain },
      { id: 'safety', label: '安全防护', icon: ShieldCheck },
      { id: 'security', label: '密钥安全', icon: Lock },
    ],
  },
  {
    id: 'system',
    items: [
      { id: 'mcp', label: 'MCP', icon: Plug },
      { id: 'advanced', label: '高级', icon: Wrench },
      { id: 'system', label: '系统', icon: Power },
    ],
  },
];

/** 导航项（紧凑 h-8，对齐 Hermes OverlayNavItem 版式） */
function NavItemButton({
  item,
  active,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      className={cn(
        'flex h-8 w-full items-center justify-start gap-2.5 rounded-md px-3 text-sm text-left transition-colors',
        active
          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-foreground)] font-medium'
          : 'text-[var(--theme-muted-foreground)] hover:bg-[var(--theme-accent)]/20 hover:text-[var(--theme-foreground)]'
      )}
      onClick={onSelect}
      type="button"
    >
      <Icon size={16} strokeWidth={1.5} className="shrink-0" />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export default function SettingsNav({ activeSection, onSectionChange }: { activeSection: string; onSectionChange: (id: string) => void }) {
  return (
    <nav className="flex flex-col px-2.5 pt-6 pb-3">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.id} className={cn('flex flex-col', gi > 0 && 'mt-5')}>
          <div className="flex flex-col gap-0.5">
            {group.items.map(item => (
              <NavItemButton
                key={item.id}
                item={item}
                active={activeSection === item.id}
                onSelect={() => onSectionChange(item.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}