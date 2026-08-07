/**
 * WakeWordButton — "Hey Hermes" 唤醒词开关（对齐 Hermes composer controls.tsx WakeWordButton）。
 *
 * 耳朵永不隐藏（用户必须随时能点击开启被动监听）；状态：listening（accent 高亮）/
 * off（灰 EarOff）/ 后端拒绝（tooltip 展示 reason/hint）。persist:true 显式手势
 * 翻 `wake_word.enabled` 配置（跨重启保留，对齐 Hermes toggleWakeWord）。
 */
import { cn } from '@/lib/utils';
import { Ear, EarOff } from 'lucide-react';
import { useWakeWord } from '@/hooks/useWakeWord';

interface Props {
  /** 录音中（voice.record 独占麦克风时禁用——唤醒必须让 mic，对齐 Hermes pausedForVoice） */
  pausedForVoice?: boolean;
  size?: number;
}

export function WakeWordButton({ pausedForVoice = false, size = 14 }: Props) {
  const wake = useWakeWord();
  const listening = wake.listening && !pausedForVoice;
  const label = pausedForVoice
    ? `唤醒已暂停（语音输入中）— ${wake.phrase}`
    : listening
      ? `正在聆听唤醒词 — ${wake.phrase}`
      : `唤醒词关闭 — ${wake.phrase}`;
  const tooltip = !pausedForVoice && wake.notice ? `${label} — ${wake.notice}` : label;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={listening}
      title={tooltip}
      disabled={pausedForVoice || wake.pending}
      onClick={() => { void wake.toggle(); }}
      className={cn(
        'inline-flex size-(--composer-control-size) shrink-0 items-center justify-center rounded-md transition-colors duration-150',
        listening
          ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        pausedForVoice && 'cursor-not-allowed opacity-50'
      )}
    >
      {listening ? <Ear size={size} /> : <EarOff size={size} />}
    </button>
  );
}
