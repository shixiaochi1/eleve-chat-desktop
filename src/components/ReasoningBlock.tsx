import { useRef, useEffect, useState } from 'react';
import { ThinkingIcon } from './Icons';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
  text?: string;
  visible?: boolean;
}

/**
 * 思维过程块 — 可折叠 + 顶部渐隐预览
 * 
 * 对齐 Hermes ThinkingDisclosure:
 *   - 默认折叠，显示前几行 + .thinking-preview 渐隐遮罩
 *   - 点击展开完整内容
 */
export default function ReasoningBlock({ text, visible }: ReasoningBlockProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (visible && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [text, visible]);

  if (!visible || !text) return null;

  const lines = text.split('\n');
  const isLong = lines.length > 4 || text.length > 200;

  return (
    <div className="border-l-2 border-muted-foreground/30 pl-3 my-2" ref={ref}>
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1 hover:text-foreground transition-colors"
        onClick={() => setExpanded(prev => !prev)}
      >
        <ThinkingIcon size={12} className="inline-block shrink-0" />
        思考
        {isLong && <span className="text-[10px] text-muted-foreground/50">{expanded ? '收起' : '展开'}</span>}
      </button>
      <div
        className={cn(
          'text-sm whitespace-pre-wrap break-words text-muted-foreground',
          !expanded && isLong && 'max-h-[5.5em] overflow-hidden cursor-pointer [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)]',
        )}
        onClick={() => isLong && !expanded && setExpanded(true)}
      >
        {text}
      </div>
    </div>
  );
}
