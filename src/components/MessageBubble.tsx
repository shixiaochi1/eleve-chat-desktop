import { useState, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { resolveMediaText } from '../utils/media';
import { formatMessageTime } from '../utils/time';
import { CopyIcon, CheckIcon, TrashIcon } from './Icons';
import { cn } from '@/lib/utils';
import StreamBlocks from './StreamBlocks';
import UserMessageText from './UserMessageText';
import { useSmoothReveal } from '@/hooks/useSmoothReveal';
import { useEnterAnimation } from '@/hooks/useEnterAnimation';

interface MessageBubbleProps {
  type: string;
  content?: string;
  streaming?: boolean;
  timestamp?: number;
  messageId?: string;
  onDelete?: (messageId: string) => void;
  /** 会话 ID（artifact 版本注册按会话隔离，对齐 Hermes） */
  sessionId?: string | null;
}

/**
 * 检查文本是否可能包含需要解析的本地图片
 */
function mayHaveLocalImage(text?: string): boolean {
  if (!text) return false;
  if (text.includes('MEDIA:')) return true;
  return /!\[[^\]]*\]\((?!https?:|data:|#|\/\/)[^)]+\)/.test(text);
}

/**
 * 消息气泡 — user / agent / system / error
 *
 * agent 流式渲染（对齐 Hermes markdown-text 管线）：
 * - 流式/完成共用同一渲染管线（StreamBlocks 块级渲染）→ 落定零突变
 * - useSmoothReveal：rAF 比例排空逐帧揭示，文字平滑流出不跳变
 * - useDeferredValue：渲染降优先级，React 并发调度可跳过中间 token 状态
 * - 气泡宽度占满容器（w-full），宽度恒定 → 消除流式宽度重排抖动
 */
export default function MessageBubble({ type, content, streaming, timestamp, messageId, onDelete, sessionId }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [resolvedMedia, setResolvedMedia] = useState<string | null>(null);
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  // 🔴 P2-3: 本地图片异步解析（仅非流式且可能含本地图时）。
  // 旧实现所有 content 都经 displayContent state 中转 → 完成首帧慢一拍（闪旧内容/二次重排）。
  // 新实现：无图路径 displayContent 直接由 props 派生（与渲染同帧）；仅图片解析结果走 state 覆盖。
  useEffect(() => {
    if (streaming || !mayHaveLocalImage(content ?? "")) {
      setResolvedMedia(null);
      return;
    }
    let cancelled = false;
    resolveMediaText(content ?? "").then((resolved) => {
      if (!cancelled) setResolvedMedia(resolved);
    });
    return () => { cancelled = true; };
  }, [content, streaming]);

  const displayContent = (!streaming && resolvedMedia != null) ? resolvedMedia : (content ?? "");

  // 🔴 对齐 Hermes：流式平滑揭示 + 渲染降级。
  // hooks 必须在所有 early return 之前（Rules of Hooks）；
  // 非 agent 分支（user/system/error）不受影响（reveal 直接返回原文）。
  const revealed = useSmoothReveal(displayContent || '', !!streaming);
  // useDeferredValue：流式渲染降为低优先级，输入/滚动不被每 token 的
  // Markdown 解析阻塞（对齐 Hermes DeferStreamingText）。
  const deferredContent = useDeferredValue(revealed);

  // 入场动画（对齐 Hermes useEnterAnimation）：仅挂载时处于流式态的消息播放
  // （= 新消息），历史消息/滚动重挂载被 animationKey 去重，不重播
  const enterRef = useEnterAnimation(!!streaming, messageId);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest('img');
      if (!img) return;
      e.preventDefault();
      setZoomedSrc(img.src);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [deferredContent]);

  useEffect(() => {
    if (!zoomedSrc) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomedSrc(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [zoomedSrc]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [content]);

  if (type === 'system') {
    return (
      <div className="text-xs text-center text-muted-foreground py-1 px-3">
        {content}
      </div>
    );
  }

  if (type === 'error') {
    return (
      <div className="w-fit max-w-[85%] bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-sm text-destructive">
        {content}
      </div>
    );
  }

  if (type === 'user') {
    return (
      <div className="group w-fit max-w-[80%] ml-auto">
        <div className="bg-user-bubble text-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed select-text border border-user-bubble-border shadow-sm">
          {/* 用户消息最小 Markdown（对齐 Hermes UserMessageText）：fence 代码块 + 行内 code */}
          <UserMessageText text={content || ''} />
        </div>
        {/* 操作栏 + 时间 — 时间左，复制右 */}
        <div className="flex items-center gap-1.5 mt-0.5 justify-between">
          {timestamp != null && (
            <span className="text-[10px] text-muted-foreground/70 select-none">{formatMessageTime(timestamp)}</span>
          )}
          <button
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-0.5 text-xs',
              'transition-all outline-none opacity-0 group-hover:opacity-100',
              'text-muted-foreground hover:text-foreground hover:bg-accent',
              copied && 'opacity-100 text-success'
            )}
            title={copied ? '已复制' : '复制'}
            onClick={handleCopy}
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          </button>
        </div>
      </div>
    );
  }

  // ── agent 消息（对齐 Hermes：流式/非流式同一渲染管线，无切换抖动）──
  // 流式期间：StreamBlocks 块级渲染 + 平滑揭示（文字逐帧流出）
  // 流式结束：同一管线，仅揭示排空，DOM 结构零切换
  // 🔴 操作栏 + 时间戳始终渲染（与流式前同结构），避免 message.complete 时突然插入 DOM 导致气泡跳变
  // 🔴 气泡宽度随文字自适应（w-fit + max-w 上限）：短消息小气泡、长消息封顶；
  //   宽度变化由 useSmoothReveal 逐帧驱动（每帧 ≤30 字符）→ 平滑缩放无跳变
  return (
    <div ref={enterRef} className="group w-fit max-w-[85%] min-w-0 select-text">
      <div className="bg-card text-card-foreground rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed border border-border shadow-sm overflow-hidden">
        <StreamBlocks ref={textRef} text={deferredContent} streaming={!!streaming} sessionId={sessionId} />
      </div>
      {/* 操作栏 + 时间 — 流式/非流式同结构，消除切换抖动 */}
      <div className="flex items-center gap-1.5 mt-1 justify-between">
        {timestamp != null && (
          <span className="text-[10px] text-muted-foreground/70 select-none">{formatMessageTime(timestamp)}</span>
        )}
        <div className="flex gap-0.5 opacity-0 translate-y-[-2px] transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto">
          <button
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 text-xs',
              'transition-all outline-none',
              'text-muted-foreground hover:text-foreground hover:bg-accent',
              copied && 'opacity-100 text-success'
            )}
            title={copied ? '已复制' : '复制'}
            onClick={handleCopy}
          >
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          </button>
          {onDelete && messageId && (
            <button
              className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all outline-none"
              title="删除消息"
              onClick={() => onDelete(messageId)}
            >
              <TrashIcon size={13} />
            </button>
          )}
        </div>
      </div>
      {/* 图片放大灯箱 — portal 到 body，避免外层 contain-[layout_paint] 裁剪 fixed 定位 */}
      {zoomedSrc && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: 'var(--ui-bg-chrome)', cursor: 'zoom-out' }}
          onClick={() => setZoomedSrc(null)}
        >
          <img
            src={zoomedSrc}
            className="max-w-[95vw] max-h-[95vh] object-contain"
            alt="放大预览"
          />
        </div>,
        document.body
      )}
    </div>
  );
}
