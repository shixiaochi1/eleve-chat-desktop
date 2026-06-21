import { useState, useCallback, useEffect, useRef } from 'react';
import { ThinkingIcon, CopyIcon, CheckIcon } from './Icons';
import ActivityTimerText from './ActivityTimerText';
import { useElapsedSeconds } from '@/hooks/useActivityTimer';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
  text?: string;
  visible?: boolean;
  /** 消息ID，用于 timer key（对齐 Eleve timerKey: `reasoning:${messageId}`） */
  messageId?: string;
  /** 是否正在思考（pending 状态） */
  pending?: boolean;
}

/**
 * 思维过程块 — 可折叠 + 渐隐预览 + shimmer动画 + 计时器
 * 
 * 对齐 Eleve ThinkingDisclosure:
 *   - 默认折叠，显示前几行 + 渐隐遮罩
 *   - 点击展开完整内容
 *   - pending 时 shimmer 微光流动动画
 *   - pending 时显示 "思考了 Xs" 计时器
 *   - 🔴 禁止 scrollIntoView — 虚拟化列表中会造成反馈循环
 *   - 思考气泡内 ResizeObserver 自动滚底（仅 preview 模式）
 */
export default function ReasoningBlock({ text, visible, messageId, pending }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 计时器（对齐 Eleve useElapsedSeconds）
  const timerKey = messageId ? `reasoning:${messageId}` : 'reasoning:unknown';
  const elapsed = useElapsedSeconds(!!pending, timerKey);

  // 预览模式：pending 且用户未手动展开时，自动滚到底
  const isPreview = !!pending && !expanded;

  useEffect(() => {
    if (!isPreview || !contentRef.current) return;
    const el = contentRef.current;
    const pin = () => { el.scrollTop = el.scrollHeight; };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isPreview]);

  const handleCopy = useCallback(() => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [text]);

  if (!visible || !text) return null;

  const lines = text.split('\n');
  const isLong = lines.length > 4 || text.length > 200;

  return (
    <div className="border-l-2 border-muted-foreground/30 pl-3 my-2 max-w-[85%]">
      {/* 标题行：图标 + "思考" + 计时器 + 展开/复制 */}
      <div className="flex items-center gap-1.5 mb-1">
        <button
          className={cn(
            'flex items-center gap-1.5 text-xs transition-colors',
            pending ? 'reasoning-shimmer text-foreground/55' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setExpanded(prev => !prev)}
        >
          <ThinkingIcon size={12} className="inline-block shrink-0" />
          思考
          {isLong && <span className="text-[10px] text-muted-foreground/50">{expanded ? '收起' : '展开'}</span>}
        </button>
        {/* 计时器 — 仅 pending 时显示 */}
        {pending && <ActivityTimerText seconds={elapsed} />}
        <button
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded text-xs',
            'transition-all outline-none opacity-40 hover:opacity-100',
            'text-muted-foreground hover:text-foreground',
            copied && 'opacity-100'
          )}
          title={copied ? '已复制' : '复制思考内容'}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
      </div>
      {/* 内容区 */}
      <div
        ref={contentRef}
        className={cn(
          'text-sm whitespace-pre-wrap break-words select-text',
          pending ? 'reasoning-shimmer text-muted-foreground/55' : 'text-muted-foreground',
          !expanded && isLong && 'max-h-[5.5em] overflow-hidden cursor-pointer [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)]',
          expanded && 'select-text',
          isPreview && 'max-h-[5.5em] overflow-y-auto',
        )}
        onClick={(e) => {
          const sel = window.getSelection();
          if (sel && sel.toString().length > 0) return;
          isLong && !expanded && setExpanded(true);
        }}
      >
        {text}
      </div>
    </div>
  );
}
