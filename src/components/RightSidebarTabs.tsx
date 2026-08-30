/**
 * RightSidebarTabs — Tab switcher between Files / Terminal / Preview / Artifacts
 */
import { File, Terminal, Globe, Box, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/themes';

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
  const { accent } = useTheme();

  return (
    <div className={cn('group/rail-tabs flex h-10 shrink-0 items-stretch border-b border-[var(--ui-stroke-tertiary)]')}>
      {TABS.map(({ key, label, Icon }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 shrink-0 whitespace-nowrap"
            style={{
              color: isActive ? accent : undefined,
              borderBottomColor: isActive ? accent : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.color = accent;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.color = '';
              }
            }}
            onClick={() => onTabChange?.(key)}
            title={label}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onClose}
        title="关闭面板"
        className="ml-auto mr-1.5 grid size-6 self-center shrink-0 place-items-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus-visible:opacity-100 group-hover/rail-tabs:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  );
}
