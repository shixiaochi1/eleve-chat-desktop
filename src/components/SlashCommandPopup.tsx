/**
 * SlashCommandPopup — `/` 命令补全弹窗（共享呈现组件）
 *
 * 单一权威源：单视图 InputArea 与宫格 AgentCardComposer 共用。
 * 纯呈现：items + 高亮索引 + 悬停/点选回调，不持任何状态。
 * onMouseDown + preventDefault：点选不丢输入框焦点。
 */
import { cn } from '@/lib/utils';
import type { CommandDef } from '@/hooks/useSlashAutocomplete';

interface SlashCommandPopupProps {
  items: CommandDef[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (cmd: CommandDef) => void;
  className?: string;
}

export default function SlashCommandPopup({
  items,
  selectedIndex,
  onHover,
  onPick,
  className,
}: SlashCommandPopupProps) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-full z-50 mb-1.5 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg',
        className,
      )}
    >
      {items.map((cmd, i) => (
        <div
          key={cmd.name}
          className={cn(
            'px-3 py-1.5 text-sm cursor-pointer rounded-md flex items-center gap-2',
            i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
          )}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(cmd);
          }}
        >
          <span className="font-mono text-xs font-medium text-primary">/{cmd.name}</span>
          {cmd.aliases.length > 0 && (
            <span className="text-xs text-muted-foreground">({cmd.aliases.join(', ')})</span>
          )}
          <span className="text-xs text-muted-foreground ml-auto truncate">{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}
