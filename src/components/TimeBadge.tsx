/**
 * 时间标签 — 避免相邻重复
 */
import { cn } from '@/lib/utils';

interface TimeBadgeProps {
  time?: string;
  show?: boolean;
}

export default function TimeBadge({ time, show }: TimeBadgeProps) {
  if (!show) return null;
  return <div className={cn('text-xs text-muted-foreground text-center py-1 select-none')}>{time}</div>;
}
