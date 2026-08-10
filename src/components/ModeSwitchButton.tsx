/**
 * ModeSwitchButton — 单视图 ↔ 宫格模式切换按钮
 *
 * 嵌入 ContextBar 左侧按钮组，对齐现有按钮样式。
 * Agent < 2 时禁用（1 个 Agent 开宫格没意义）。
 */
import { memo } from 'react';
import { LayoutGrid, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModeSwitchButtonProps {
  mode: 'single' | 'grid';
  onToggle: () => void;
  agentCount: number;
}

const ModeSwitchButton = memo(function ModeSwitchButton({ mode, onToggle, agentCount }: ModeSwitchButtonProps) {
  const disabled = agentCount < 2;
  const isGrid = mode === 'grid';

  return (
    <button
      className={cn(
        'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors border bg-transparent',
        disabled
          ? 'border-border/40 text-muted-foreground/30 cursor-not-allowed'
          : 'border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent/50'
      )}
      title={disabled ? '需要至少 2 个 Agent' : isGrid ? '单视图模式 (Ctrl+G)' : '宫格模式 (Ctrl+G)'}
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
    >
      {isGrid ? <Square size={14} strokeWidth={1.5} /> : <LayoutGrid size={14} strokeWidth={1.5} />}
      <span>{isGrid ? '单视图' : '宫格'}</span>
    </button>
  );
});

export default ModeSwitchButton;
