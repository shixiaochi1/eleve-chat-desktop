import { useState, useCallback, useEffect, useRef, useMemo, useDeferredValue } from 'react';
import { ThinkingIcon, CopyIcon, CheckIcon } from './Icons';
import ActivityTimerText from './ActivityTimerText';
import { useElapsedSeconds } from '@/hooks/useActivityTimer';
import { useShowReasoning } from '@/store/display-settings';
import { cleanThinkingText } from '@/lib/thinking-text';
import { cn } from '@/lib/utils';
import StreamBlocks from './StreamBlocks';

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
  // 显示推理过程开关（config.yaml display.show_reasoning，设置>聊天）。
  // 关闭时整个推理块不渲染；数据层 parts 保留，重新打开后历史推理块恢复显示。
  const showReasoning = useShowReasoning();
  // 🔴 Phase 3: 三态默认策略（对齐 Hermes message-parts: open = userOpen ?? pending）：
  // userOpen=null 时流式自动展开、完成自动折叠；用户首次手动 toggle 后永久生效。
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const open = userOpen ?? !!pending;

  // 计时器（🔴 Phase 3: 块级 key—多推理块各自计时，不再全块同读数）
  const timerKey = messageId ? `reasoning:${messageId}:${blockIndex ?? 0}` : 'reasoning:unknown';
  const elapsed = useElapsedSeconds(!!pending, timerKey);

  // 🔴 预览模式对齐 Hermes ThinkingDisclosure：`pending && userOpen === null`
  // 仅当用户从未手动 toggle 时才跟随流式预览；一旦手动展开/折叠（userOpen 非 null），
  // 立即脱离预览限制——手动展开=完全展开，手动折叠=完全收起。
  // ELEVE 旧实现 `pending && open` 的 bug：手动展开后仍被困预览态（max-h+滚动条），
  // 表现为"思考中折叠点不开、只能滚动条滚动"。
  const isPreview = !!pending && userOpen === null;

  useEffect(() => {
    if (!isPreview || !contentRef.current) return;
    const el = contentRef.current;
    const pin = () => { el.scrollTop = el.scrollHeight; };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isPreview]);

  // 显示层清洗（对齐 Hermes coerceThinkingText 定位：只动显示不动数据）：
  // 剥混入的 think 标签 + 状态前缀 + 纯垃圾推理流（"..."/":"）视为空隐藏。
  // trimStart：对齐 Hermes ReasoningTextPart 的 text.trimStart()（思考流首 token 常带前导空白）
  const cleanText = useMemo(() => cleanThinkingText(text ?? '').trimStart(), [text]);
  // 渲染降级：思考流每 token 重渲染，useDeferredValue 降为低优先级（对齐 Hermes DeferStreamingText）
  const deferredClean = useDeferredValue(cleanText);

  const handleCopy = useCallback(() => {
    if (!cleanText) return;
    navigator.clipboard.writeText(cleanText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [cleanText]);

  if (!showReasoning || !visible || !cleanText) return null;

  const lines = cleanText.split('\n');
  const isLong = lines.length > 4 || cleanText.length > 200;

  return (
    <div className="border-l-2 border-muted-foreground/30 pl-3 my-2 max-w-[85%]">
      {/* 标题行：图标 + "思考" + 计时器 + 展开/复制 */}
      <div className="flex items-center gap-1.5 mb-1">
        <button
          className={cn(
            'flex items-center gap-1.5 text-xs transition-colors',
            'text-muted-foreground hover:text-foreground'
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
      {/* 内容区 — markdown 渲染（对齐 Hermes ReasoningTextPart → MarkdownTextContent）：
          thinking 内容自带 markdown 语法（行内 code / 代码围栏 / 粗体 / 列表），纯文本直出会
          裸奔反引号与围栏标记；走与主气泡相同的 StreamBlocks 管线（merge → autolink →
          repair → split → marked）→ 行内 code 样式化、代码围栏变代码卡片、强调/列表正常排版。
          pending（流式）时尾块延迟高亮 + useDeferredValue 降载（对齐 Hermes defer） */}
      <div
        ref={contentRef}
        className={cn(
          // 🔴 字体对齐 Hermes ReasoningTextPart containerClassName：
          // text-xs leading-snug text-muted-foreground/85（12px 紧凑行高）—
          // 与正文（text-sm）明显区分；ELEVE 旧实现 text-sm 与正文同字号。
          'text-xs leading-snug break-words select-text',
          pending ? 'text-muted-foreground/55' : 'text-muted-foreground/85',
          !open && isLong && 'max-h-[5.5em] overflow-hidden cursor-pointer [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_28%,black_100%)]',
          open && 'select-text',
          // 🔴 预览态对齐 Hermes：overflow-hidden（无滚动条）+ 自动滚底，
          // 思考中最新 token 始终可见；ELEVE 旧实现 overflow-y-auto 出滚动条。
          isPreview && 'max-h-[10em] overflow-hidden',
        )}
        onClick={(e) => {
          const sel = window.getSelection();
          if (sel && sel.toString().length > 0) return;
          // 🔴 对称 toggle：折叠态点击展开，展开态点击收起。
          // ELEVE 旧实现仅在 !open 时展开，展开态点击无效 → "折叠点不开"。
          if (open) setUserOpen(false);
          else if (isLong) setUserOpen(true);
        }}
      >
        <StreamBlocks text={deferredClean} streaming={!!pending} disableArtifacts />
      </div>
    </div>
  );
}
