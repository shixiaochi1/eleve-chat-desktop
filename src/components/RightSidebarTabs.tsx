/**
 * RightSidebarTabs — Tab switcher between Files / Terminal / Preview / Artifacts
 */
import { File, Terminal, Globe, Box, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'files', label: '文件', Icon: File },
  { key: 'terminal', label: '终端', Icon: Terminal },
  { key: 'preview', label: '预览', Icon: Globe },
  { key: 'artifacts', label: '产物', Icon: Box },
];

interface RightSidebarTabsProps {
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** 关闭整个右栏（对齐 Hermes closeRightRail；悬停显示） */
  onClose?: () => void;
}

export default function RightSidebarTabs({ activeTab, onTabChange, onClose }: RightSidebarTabsProps) {
  return (
    <div className={cn('group/rail-tabs flex shrink-0 items-center border-b border-border')}>
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 border-transparent',
            activeTab === key
              ? 'text-accent-cyan border-accent-cyan'
              : 'text-accent-cyan/60 hover:text-accent-cyan hover:bg-accent/5',
          )}
          onClick={() => onTabChange?.(key)}
          title={label}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClose}
        title="关闭面板"
        className="ml-auto mr-1.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus-visible:opacity-100 group-hover/rail-tabs:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  );
}
