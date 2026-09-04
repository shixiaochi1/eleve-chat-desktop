/**
 * DiffCount — git 增删行数徽标（🔴 2026-09-05 对齐 Hermes components/ui/diff-count：
 * 单一实现收敛此前散落四处（ToolEntry 徽标 / ChangedFilesCard / ReviewFileTree /
 * ReviewPane diff 头）的 +N −M 内联渲染）
 *
 * - 默认隐藏零值项（行内徽标语义：+12 −3）
 * - showZero：零值也显示（ChangedFilesCard 摘要语义：-0 暗显）
 */
import { cn } from '@/lib/utils';

interface DiffCountProps {
  added: number;
  removed: number;
  /** 零值也显示（暗色）；默认隐藏 */
  showZero?: boolean;
  className?: string;
}

export function DiffCount({ added, removed, showZero = false, className }: DiffCountProps) {
  const showAdded = showZero || added > 0;
  const showRemoved = showZero || removed > 0;
  if (!showAdded && !showRemoved) return null;

  return (
    <span className={cn('flex shrink-0 items-center gap-1 font-mono tabular-nums', className)}>
      {showAdded && (
        <span className={cn(added > 0 ? 'text-success' : 'text-muted-foreground/40')}>+{added}</span>
      )}
      {showRemoved && (
        <span className={cn(removed > 0 ? 'text-destructive' : 'text-muted-foreground/40')}>−{removed}</span>
      )}
    </span>
  );
}

export default DiffCount;
