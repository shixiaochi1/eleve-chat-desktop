import { formatElapsed } from '@/hooks/useActivityTimer';
import { cn } from '@/lib/utils';

interface ActivityTimerTextProps {
  /** 经过秒数 */
  seconds: number;
  className?: string;
}

/**
 * ActivityTimerText — 对齐 Hermes ActivityTimerText
 *
 * 在 Reasoning 气泡旁显示 "Xs" 或 "M:SS" 计时器
 */
export default function ActivityTimerText({ seconds, className }: ActivityTimerTextProps) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-[0.56rem] tabular-nums text-muted-foreground/60',
        className
      )}
    >
      {formatElapsed(seconds)}
    </span>
  );
}
