import { useState, useCallback, useEffect, useRef } from 'react';
import { ThinkingIcon, CopyIcon, CheckIcon } from './Icons';
import ActivityTimerText from './ActivityTimerText';
import { useElapsedSeconds } from '@/hooks/useActivityTimer';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
  text?: string;
  visible?: boolean;
  /** 消息ID，用于 timer key */
  messageId?: string;
  /** 🔴 Phase 3: 推理块序号（块级 timerKey—消灭多块同读数；审查 #7） */
  blockIndex?: number;
  /** 是否正在思考（pending 状态—由 MessageRow 自门控：仅未冻结块随消息 pending） */
  pending?: boolean;
}

/**
 * 思维过程块 — 可折叠 + 渐隐预览 + 计时器
 * 
 * 对齐 Eleve ThinkingDisclosure:
 *   - 默认折叠，显示前几行 + 渐隐遮罩
 *   - 点击展开完整内容
 *   - pending 时静态浅色 + "思考了 Xs" 计时器（无呼吸动画，老大要求取消）
 *   - 🔴 禁止 scrollIntoView — 虚拟化列表中会造成反馈循环
 *   - 思考气泡内 ResizeObserver 自动滚底（仅 preview 模式）
 */
export default function ReasoningBlock({ text, visible, messageId, blockIndex, pending }: ReasoningBlockProps) {
  // 🔴 Phase 3: 三态默认策略（对齐 Hermes message-parts: open = userOpen ?? pending）：
  // userOpen=null 时流式自动展开、完成自动折叠；用户首次手动 toggle 后永久生效。
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const open = userOpen ?? !!pending;

  // 计时器（🔴 Phase 3: 块级 key—多推理块各自计时，不再全块同读数）
  const timerKey = messageId ? `reasoning:${messageId}:${blockIndex ?? 0}` : 'reasoning:unknown';
  const elapsed = useElapsedSeconds(!!pending, timerKey);

  // 预览模式：pending 且展开时，自动滚到底
  const isPreview = !!pending && open;

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
            pending ? 'text-foreground/55' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setUserOpen(!open)}
        >
          <ThinkingIcon size={12} className="inline-block shrink-0" />
          思考
          {isLong && <span className="text-[10px] text-muted-foreground/50">{open ? '收起' : '展开'}</span>}
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
      {/* 内容区 — whitespace-pre-line：单换行折叠为空格、空行保留段落（对齐 Hermes 换行语义，
          消灭推理文本“几个字占一行”的碎行） */}
      <div
        ref={contentRef}
        className={cn(
          'text-sm whitespace-pre-line break-words select-text',
          pending ? 'text-muted-foreground/55' : 'text-muted-foreground',
          !open && isLong && 'max-h-[5.5em] overflow-hidden cursor-pointer [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)]',
          open && 'select-text',
          isPreview && 'max-h-[5.5em] overflow-y-auto',
        )}
        onClick={(e) => {
          const sel = window.getSelection();
          if (sel && sel.toString().length > 0) return;
          isLong && !open && setUserOpen(true);
        }}
      >
        {text}
      </div>
    </div>
  );
}
