import { Compass } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 系统消息 — 对齐 Hermes system-message.tsx 三形态
 *
 * 1. `steer:` 前缀 → compass 图标 + 「引导」标签 + 文本（防御性：ELEVE 后端 steer
 *    当前注入 tool message 而非 system 消息，此形态暂为兼容预留，Hermes 同款渲染）
 * 2. `slash:/cmd\noutput` 前缀 → mono 命令 + 输出（斜杠命令状态回显；前端本地生成，
 *    对齐 Hermes slashStatusText：单行居中、多行左对齐更宽布局）
 * 3. 普通文本 → 居中灰字（ELEVE 现状 MessageBubble type="system" 同款）
 */
const STEER_NOTE_RE = /^steer:(?<text>[\s\S]+)$/;
const SLASH_STATUS_RE = /^slash:(?<command>\/[^\n]+)\n(?<output>[\s\S]*)$/;

interface SystemMessageProps {
  text: string;
}

export default function SystemMessage({ text }: SystemMessageProps) {
  if (!text) return null;

  const steerNote = text.match(STEER_NOTE_RE);
  if (steerNote?.groups) {
    return (
      <div
        className="flex max-w-[min(86%,44rem)] items-center gap-1.5 self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/60"
        data-role="system"
      >
        <Compass className="text-muted-foreground/55" size={12} strokeWidth={1.5} />
        <span className="text-muted-foreground/55">引导</span>
        <span className="text-muted-foreground/35">·</span>
        <span className="whitespace-pre-wrap">{steerNote.groups.text.trim()}</span>
      </div>
    );
  }

  const slashStatus = text.match(SLASH_STATUS_RE);
  if (slashStatus?.groups) {
    const output = slashStatus.groups.output.trim();
    // 单行状态（如 "model → x"）居中内联最易读；多行输出（目录/用量表）需左对齐更宽空间
    const multiline = output.includes('\n');

    return (
      <div
        className={cn(
          'w-[60%] max-w-[44rem] self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/60',
          multiline ? 'text-left' : 'text-center'
        )}
        data-role="system"
      >
        <span className="font-mono text-muted-foreground/55">{slashStatus.groups.command}</span>
        {multiline ? (
          <span className="mt-0.5 block whitespace-pre-wrap">{output}</span>
        ) : (
          <>
            <span className="mx-1.5 text-muted-foreground/35">·</span>
            <span className="whitespace-pre-wrap">{output}</span>
          </>
        )}
      </div>
    );
  }

  const multiline = text.includes('\n');
  return (
    <div
      className={cn(
        'w-[60%] max-w-[44rem] self-center px-2 py-0.5 text-[0.6875rem] leading-5 text-muted-foreground/55',
        multiline ? 'text-left' : 'text-center'
      )}
      data-role="system"
    >
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  );
}
