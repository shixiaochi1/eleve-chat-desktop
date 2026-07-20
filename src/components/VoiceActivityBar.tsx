import { cn } from '@/lib/utils';
import { MicIcon, LoadingIcon } from './Icons';
import type { VoiceStatus } from '@/hooks/useVoice';

interface VoiceActivityBarProps {
  status: Exclude<VoiceStatus, 'idle'>;
  /** 录音已持续秒数 */
  elapsed: number;
  /** 转录中点击"取消"回到空闲 */
  onCancel?: () => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 录音电平条 — 五条错相位舞动的竖线，传达"正在聆听"的活感 */
function LevelBars() {
  return (
    <div aria-hidden="true" className="flex h-4 items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="voice-bar w-0.5 rounded-full bg-current"
          style={{ animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </div>
  );
}

/**
 * 语音活动状态条 — 对齐 Hermes composer VoiceActivity
 *
 * 录音中：红色调 + 麦克风 + 计时 + 舞动电平条
 * 转录中：主色调 + 转圈 + 计时 + 取消按钮
 * 位于容器表面内、输入区上方，随状态出现/消失。
 */
export default function VoiceActivityBar({ status, elapsed, onCancel }: VoiceActivityBarProps) {
  const recording = status === 'recording';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-xl border px-2.5 text-xs backdrop-blur-sm',
        'transition-colors duration-200',
        recording
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-primary/25 bg-primary/10 text-primary'
      )}
    >
      <div
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full',
          recording ? 'bg-destructive/15' : 'bg-primary/15'
        )}
      >
        {recording ? (
          <MicIcon size={12} />
        ) : (
          <LoadingIcon size={12} className="animate-spin" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium text-foreground/85">
          {recording ? '正在录音…' : '正在转录…'}
        </span>
        <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground/85">
          {formatElapsed(elapsed)}
        </span>
      </div>

      {recording ? (
        <LevelBars />
      ) : (
        <button
          onClick={onCancel}
          className="shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-[0.6875rem] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground"
        >
          取消
        </button>
      )}
    </div>
  );
}
