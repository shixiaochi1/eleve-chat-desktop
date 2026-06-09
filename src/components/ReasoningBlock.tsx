import { useState, useCallback } from 'react';
import { ThinkingIcon, CopyIcon, CheckIcon } from './Icons';
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
 *   - 🔴 禁止 scrollIntoView — 虚拟化列表中 scrollIntoView 会造成
 *     反馈循环：mount → scrollIntoView → viewport 移动 → virtualizer
 *     重新计算 → 新 item mount → 又 scrollIntoView → 无限循环
 */
export default function ReasoningBlock({ text, visible }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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
      <div className="flex items-center gap-1.5 mb-1">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(prev => !prev)}
        >
          <ThinkingIcon size={12} className="inline-block shrink-0" />
          思考
          {isLong && <span className="text-[10px] text-muted-foreground/50">{expanded ? '收起' : '展开'}</span>}
        </button>
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
      <div
        className={cn(
          'text-sm whitespace-pre-wrap break-words text-muted-foreground select-text',
          !expanded && isLong && 'max-h-[5.5em] overflow-hidden cursor-pointer [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)]',
          expanded && 'select-text',
        )}
        onClick={(e) => {
          // 只在未选中文字时触发展开，允许正常选择文本
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
