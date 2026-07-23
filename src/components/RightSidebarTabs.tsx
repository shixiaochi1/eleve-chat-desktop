/**
 * RightSidebarTabs — Tab switcher between Files and Terminal
 */
import { File, Terminal, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'files', label: '文件', Icon: File },
  { key: 'terminal', label: '终端', Icon: Terminal },
  { key: 'preview', label: '预览', Icon: Globe },
];

interface RightSidebarTabsProps {
  activeTab?: string;
  onTabChange?: (key: string) => void;
}

export default function RightSidebarTabs({ activeTab, onTabChange }: RightSidebarTabsProps) {
  return (
    <div className={cn('flex border-b border-border shrink-0')}>
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 border-transparent',
            activeTab === key
              ? 'text-accent-cyan border-accent-cyan'
              : 'text-accent-cyan/60 hover:text-accent-cyan hover:bg-accent/5'
          )}
          onClick={() => onTabChange?.(key)}
          title={label}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
