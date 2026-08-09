import { useState, useCallback, useMemo, useDeferredValue } from 'react';
import { ThinkingIcon, CopyIcon, CheckIcon, ExpandIcon } from './Icons';
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
 * 思维过程块 — 折叠漏两行预览 + 点击展开 + 计时器
 * 
 * 🔴 2026-08-05 老大定调（细节对齐 Hermes ThinkingDisclosure / DisclosureRow）：
 *   - 思考过程中默认折叠，漏出前两行预览（line-clamp-2 硬截断，Hermes overflow-hidden 同款语义）
 *   - 想看 → 点击预览区或标题"思考"展开；首次手动 toggle 后永久生效
 *   - 折叠/打开方向：caret 箭头收起 ▶ 朝右、展开 ▼ 朝下（rotate-90），
 *     静止淡显 0.4（Hermes thinking 专用 --disclosure-caret-rest）、hover/展开 0.8
 *   - 滚动形式：展开态无 max-h 无内部滚动条，内容自然撑开跟随页面滚动（Hermes 同款）
 *   - 字体颜色比回复正文淡（muted-foreground × 半透明），hover 提升可读性
 *   - pending 时静态浅色 + "思考了 Xs" 计时器（无呼吸动画，老大要求取消）
 *   - 🔴 禁止 scrollIntoView — 虚拟化列表中会造成反馈循环
 */
export default function ReasoningBlock({ text, visible, messageId, blockIndex, pending }: ReasoningBlockProps) {
  // 显示推理过程开关（config.yaml display.show_reasoning，设置>聊天）。
  // 关闭时整个推理块不渲染；数据层 parts 保留，重新打开后历史推理块恢复显示。
  const showReasoning = useShowReasoning();
  // 🔴 默认折叠（老大 2026-08-05 定调：思考过程中折叠，漏两行预览，想看点击展开）：
  // userOpen=null（从未手动操作）→ 恒折叠，不随 pending 自动展开；首次手动 toggle 后永久生效。
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const open = userOpen ?? false;

  // 计时器（🔴 Phase 3: 块级 key—多推理块各自计时，不再全块同读数）
  const timerKey = messageId ? `reasoning:${messageId}:${blockIndex ?? 0}` : 'reasoning:unknown';
  const elapsed = useElapsedSeconds(!!pending, timerKey);

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

  return (
    <div className="border-l-2 border-muted-foreground/30 pl-3 my-2 max-w-[85%]">
      {/* 标题行：图标 + "思考" + caret（方向指示） + 计时器 + 复制 */}
      <div className="flex items-center gap-1.5 mb-1">
        <button
          className={cn(
            // hover 胶囊贴合文字宽度（对齐 Hermes DisclosureRow：-mx-1.5 px-1.5）
            'group/disclosure-row flex items-center gap-1.5 text-xs transition-colors -m-1 p-1 rounded-md',
            'text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground'
          )}
          onClick={() => setUserOpen(!open)}
          aria-expanded={open}
        >
          <ThinkingIcon size={12} className="inline-block shrink-0" />
          思考
          {/* caret 对齐 Hermes DisclosureCaret（chevron-right）：收起 ▶ 朝右、
              展开 rotate-90 ▼ 朝下；静止淡显 0.4（Hermes thinking 专用
              --disclosure-caret-rest: 0.4）、hover/展开时 0.8 */}
          <ExpandIcon
            size={12}
            className={cn(
              'shrink-0 text-muted-foreground/80 transition-transform duration-150',
              open ? 'rotate-90 opacity-80' : 'opacity-40 group-hover/disclosure-row:opacity-80'
            )}
          />
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
          pending（流式）时尾块延迟高亮 + useDeferredValue 降载（对齐 Hermes defer）。
          🔴 折叠态 = 漏两行预览（line-clamp-2 硬截断，Hermes overflow-hidden 同款截断语义），
          点击预览区展开；展开态无 max-h 无内部滚动条 → 自然撑开跟随页面滚动。 */}
      <div
        className={cn(
          // 🔴 字体颜色（老大 2026-08-05 定调 + 2026-08-09 三次调淡）：推理过程文字
          // 必须比回复正文淡很多。2026-08-09 12:14 定位：内联 color 被子元素覆盖，
          // 改用 .reasoning-content !important 规则（style.css）强制压制所有子元素。
          'reasoning-content text-xs leading-snug break-words select-text transition-colors',
          // 折叠态：漏两行 + 光标提示可点击展开
          !open && 'line-clamp-2 cursor-pointer'
        )}
        onClick={(e) => {
          if (open) return;
          // 选择文本时不触发（复制/划词场景）
          const sel = window.getSelection();
          if (sel && sel.toString().length > 0) return;
          setUserOpen(true);
        }}
      >
        <StreamBlocks text={deferredClean} streaming={!!pending} disableArtifacts />
      </div>
    </div>
  );
}
