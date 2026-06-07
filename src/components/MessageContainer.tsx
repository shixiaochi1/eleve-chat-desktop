import { useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import useThreadScrollAnchor from '@/hooks/useThreadScrollAnchor';
import { useMessage, useMessageSignature, getMessages } from '@/store/messages';
import { useScrolledUp } from '@/store/scroll';
import TimeBadge from './TimeBadge';
import MessageBubble from './MessageBubble';
import ReasoningBlock from './ReasoningBlock';
import ToolCallCard from './ToolCallCard';
import { cn } from '@/lib/utils';
import type { ChatMessage, ChatMessagePart } from '@/types';

/**
 * 1:1 architectural alignment with Hermes thread-virtualizer.tsx
 */

const ESTIMATED_ITEM_HEIGHT = 220;
const OVERSCAN = 4;
const AT_BOTTOM_THRESHOLD = 4;

interface SignatureRow {
  id: string;
  index: number;
  role: string;
}

interface StandaloneGroup {
  id: string;
  index: number;
  kind: 'standalone';
}

interface TurnGroup {
  id: string;
  indices: number[];
  kind: 'turn';
}

type MessageGroup = StandaloneGroup | TurnGroup;

interface MessageGroupItemProps {
  group: MessageGroup;
  onRegenerate?: (msg?: ChatMessage) => void;
}

interface SingleMessageItemProps {
  index: number;
  onRegenerate?: (msg?: ChatMessage) => void;
}

interface ScrollToBottomButtonProps {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  stickyBottomRef: React.MutableRefObject<boolean>;
  groupCount: number;
}

interface MessageContainerInnerProps {
  onRegenerate?: (msg?: ChatMessage) => void;
  gatewayOnline?: boolean;
  onGatewayRetry?: () => void;
  isStreaming?: boolean;
}

// ── Message grouping (1:1 from Hermes buildGroups) ──
// Accepts a signature string (not messages array).
// Signature only changes when message structure changes (id/type/count).
// Streaming content updates do NOT change the signature → groups stay stable.

function buildGroups(signature: string | null): MessageGroup[] {
  if (!signature) return [];

  const msgs: SignatureRow[] = signature.split('\n').map((row: string) => {
    const [index, id, role] = row.split(':');
    return { id, index: Number(index), role };
  });

  const groups: MessageGroup[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];

    if (m.role !== 'user') {
      groups.push({ id: m.id, index: m.index, kind: 'standalone' });
      continue;
    }

    const indices = [m.index];
    while (i + 1 < msgs.length && msgs[i + 1].role !== 'user') {
      indices.push(msgs[++i].index);
    }
    groups.push({ id: m.id, indices, kind: 'turn' });
  }

  return groups;
}

// ── MessageContainer (1:1 from Hermes VirtualizedThreadInner) ──

function MessageContainerInner({ onRegenerate, gatewayOnline, onGatewayRetry, isStreaming }: MessageContainerInnerProps) {
  const messageSignature = useMessageSignature();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickyBottomRef = useRef(true);
  // Shared between scrollToFn and useThreadScrollAnchor so that
  // virtualizer-initiated scroll adjustments aren't misread as user scrolls.
  const programmaticScrollPendingRef = useRef(0);

  // ── Build groups (1:1 from Hermes: signature-driven, not messages-driven) ──
  // Signature only changes on structural changes (new/removed messages).
  // Streaming content updates do NOT change groups → virtualizer stays stable.
  const groups = useMemo(() => buildGroups(messageSignature), [messageSignature]);
  const renderEmpty = groups.length === 0;

  // ── Derive sessionKey from signature (no useMessages needed) ──
  const sessionKey = useMemo(() => {
    if (!messageSignature) return null;
    const firstRow = messageSignature.split('\n')[0];
    return firstRow ? firstRow.split(':')[1] : null;
  }, [messageSignature]);

  // ── Virtualizer (1:1 from Hermes) ──
  const virtualizer = useVirtualizer({
    count: groups.length,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    getItemKey: (index: number) => groups[index]?.id ?? index,
    getScrollElement: () => scrollerRef.current,
    initialRect: { height: 600, width: 800 },
    overscan: OVERSCAN,
    // 1:1 from Hermes: skip virtualizer's scroll adjustment when at bottom.
    // Our RO + pinToBottom loop handles scroll anchoring; letting the
    // virtualizer also adjust creates a feedback loop (rubber-banding).
    //
    // Eleve addition: when user has scrolled up (stickyBottom=false),
    // skip the virtualizer's scrollTo entirely. In Hermes this path is
    // harmless because the component doesn't re-render on content changes
    // (assistant-ui scopes updates to individual message components).
    // In Eleve, useMessages() triggers a parent re-render on every RAF
    // flush → measureElement fires → scrollToFn called → el.scrollTo
    // overrides the user's scroll position. Skipping when not at bottom
    // prevents the virtualizer from fighting the user's wheel events.
    scrollToFn: (offset: number, _options: ScrollToOptions, instance: { scrollElement: HTMLElement | null }) => {
      const el = instance.scrollElement as HTMLElement | null;
      if (!el) return;

      if (stickyBottomRef.current) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        const distFromBottom = maxScroll - el.scrollTop;
        if (distFromBottom <= AT_BOTTOM_THRESHOLD && offset < maxScroll) {
          return;
        }
      }

      // Mark this as programmatic so onScroll in useThreadScrollAnchor
      // doesn't misinterpret it as user scrolling (which would wrongly
      // re-arm stickyBottom and trigger the pin loop).
      programmaticScrollPendingRef.current += 1;
      el.scrollTo(0, offset);
    },
  });

  // ── Scroll anchor hook (1:1 from Hermes) ──
  useThreadScrollAnchor({
    enabled: !renderEmpty,
    groupCount: groups.length,
    isRunning: !!isStreaming,
    scrollerRef: scrollerRef as React.RefObject<HTMLDivElement>,
    sessionKey: sessionKey ?? undefined,
    stickyBottomRef,
    virtualizer,
    programmaticScrollPendingRef,
  });

  // ── Scroll to specific message (outline panel) ──
  // Uses getMessages() for one-time lookup (no subscription, no re-render).
  const scrollToMessage = useCallback((messageId: string) => {
    const msgs = getMessages();
    const groupIndex = groups.findIndex(g =>
      g.kind === 'turn'
        ? (g as TurnGroup).indices.some(idx => msgs[idx]?.id === messageId)
        : (g as StandaloneGroup).id === messageId
    );
    if (groupIndex >= 0) {
      virtualizer.scrollToIndex(groupIndex, { align: 'center', behavior: 'smooth' });
    }
  }, [groups, virtualizer]);

  useEffect(() => {
    const handler = (e: CustomEvent) => scrollToMessage(e.detail.messageId);
    window.addEventListener('eleve:scroll-to-message', handler as EventListener);
    return () => window.removeEventListener('eleve:scroll-to-message', handler as EventListener);
  }, [scrollToMessage]);

  // ── Virtualized data ──
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = Math.max(0, totalSize - (virtualItems.at(-1)?.end ?? 0));

  return (
    <div className="relative min-h-0 max-w-full overflow-hidden contain-[layout_paint] flex-1">
      <div
        className="size-full overflow-x-hidden overflow-y-auto overscroll-contain"
        data-slot="thread-viewport"
        ref={scrollerRef}
      >
        {renderEmpty ? (
          <div className="mx-auto grid h-full w-full min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-4 px-6 py-8">
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16">
                <img src="/eleve_logo.png" alt="Eleve" className="w-full h-full object-contain" />
              </div>
              <h2 className="text-lg font-semibold">Eleve Agent</h2>
              <p className="text-sm text-muted-foreground">你的 AI 智能助手 · 开始对话吧</p>
              {!gatewayOnline && (
                <div className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-card text-center">
                  <span className="text-sm font-medium">网关未连接</span>
                  <p className="text-xs text-muted-foreground">请先启动 Eleve Gateway：<code className="bg-muted/50 px-1 rounded">eleved</code></p>
                  <button
                    className={cn(
                      'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-xs font-medium',
                      'transition-all outline-none h-8 px-3',
                      'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground'
                    )}
                    onClick={onGatewayRetry}
                  >
                    ↻ 重新检测
                  </button>
                </div>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Ctrl+N 新建会话</span>
                <span>Enter 发送</span>
                <span>Shift+Enter 换行</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full min-w-0 flex-col px-6 pt-6">
            <div style={{ paddingBottom: `${paddingBottom}px`, paddingTop: `${paddingTop}px` }}>
              {virtualItems.map((virtualItem: VirtualItem) => {
                const group = groups[virtualItem.index];
                if (!group) return null;

                return (
                  <div
                    className="flex min-w-0 flex-col pb-3"
                    data-index={virtualItem.index}
                    key={virtualItem.key}
                    ref={virtualizer.measureElement}
                  >
                    <MessageGroupItem
                      group={group}
                      onRegenerate={onRegenerate}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="absolute bottom-3 left-5 z-10 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
          <span className="text-xs text-muted-foreground ml-1">思考中…</span>
        </div>
      )}

      {/* Scroll to bottom button — independent component, subscribes to scroll store */}
      <ScrollToBottomButton
        scrollerRef={scrollerRef as React.RefObject<HTMLDivElement>}
        stickyBottomRef={stickyBottomRef}
        groupCount={groups.length}
      />
    </div>
  );
}

// ── MessageGroupItem — scoped rendering (1:1 alignment with Hermes) ──
// Hermes uses assistant-ui's MessageByIndex which scopes re-renders to
// individual messages. In Eleve, this component achieves the same effect:
// it subscribes to its own messages via useMessage(index), so the PARENT
// (MessageContainerInner) does NOT re-render on streaming content changes.
// Only the specific MessageGroupItem whose message actually changed re-renders.
// This eliminates the measurement storm that causes scroll hijacking in long sessions.

const MessageGroupItem = memo(function MessageGroupItem({ group, onRegenerate }: MessageGroupItemProps) {
  if (group.kind === 'turn') {
    return (
      <div className="relative flex min-w-0 flex-col gap-3">
        {(group as TurnGroup).indices.map(idx => (
          <SingleMessageItem key={idx} index={idx} onRegenerate={onRegenerate} />
        ))}
      </div>
    );
  }
  return <SingleMessageItem index={(group as StandaloneGroup).index} onRegenerate={onRegenerate} />;
});

// ── SingleMessageItem — subscribes to ONE message via useMessage(index) ──
// Only re-renders when THIS specific message changes (content update during streaming).
// All other messages preserve their reference → no re-render → no measureElement → no scroll fight.

const SingleMessageItem = memo(function SingleMessageItem({ index, onRegenerate }: SingleMessageItemProps) {
  const m = useMessage(index);
  if (!m || m.hidden) return null;

  // ── Parts-based rendering (1:1 aligned with Hermes) ──
  // Hermes: MessagePrimitive.Parts iterates parts, each rendered by type-specific component
  if (m.parts && m.parts.length > 0) {
    // User message — single text bubble
    if (m.role === 'user') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('');
      return <div className="flex justify-end px-4 mb-1.5"><MessageBubble type="user" content={text} /></div>;
    }

    // Assistant message — render each part with proper spacing
    if (m.role === 'assistant') {
      return (
        <div className="flex flex-col gap-2 px-4 mb-1.5">
          {m.parts.map((part, pi) => {
            switch (part.type) {
              case 'reasoning':
                return <ReasoningBlock key={`r-${pi}`} text={part.text} visible={!!part.text} />;
              case 'text': {
                const isLast = pi === m.parts.length - 1;
                return (
                  <MessageBubble
                    key={`t-${pi}`}
                    type="agent"
                    content={part.text}
                    streaming={!!m.pending && isLast}
                    onRegenerate={onRegenerate ? () => onRegenerate(m) : undefined}
                  />
                );
              }
              case 'tool-call':
                return (
                  <ToolCallCard
                    key={`tc-${part.toolCallId || pi}`}
                    name={part.toolName}
                    callId={part.toolCallId}
                    argsStr={part.argsText}
                    resultStr={part.result != null ? (typeof part.result === 'string' ? part.result : JSON.stringify(part.result)) : undefined}
                    status={part.result != null ? 'done' : 'pending'}
                  />
                );
              default:
                return null;
            }
          })}
          {m.error && <MessageBubble type="error" content={m.error} />}
        </div>
      );
    }

    // System message
    if (m.role === 'system') {
      const text = m.parts.filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('');
      return <div className="px-4 py-0.5"><MessageBubble type="system" content={text} /></div>;
    }
  }

  // ── Legacy flat-field fallback (for cached messages without parts) ──
  let element;
  switch (m.type) {
    case 'user':
      element = <MessageBubble type="user" content={m.content} />;
      break;
    case 'agent':
      element = (
        <MessageBubble
          type="agent"
          content={m.content}
          streaming={!!m._streaming}
          onRegenerate={onRegenerate ? () => onRegenerate(m) : undefined}
          agentAttribution={m.agentAttribution as unknown as Parameters<typeof MessageBubble>[0]['agentAttribution']}
        />
      );
      break;
    case 'system':
      element = <MessageBubble type="system" content={m.content} />;
      break;
    case 'error':
      element = <MessageBubble type="error" content={m.content || m.error} />;
      break;
    case 'reasoning':
      element = <ReasoningBlock text={m.content || m.reasoning_content} visible={!!(m.content || m.reasoning_content)} />;
      break;
    case 'tool':
      element = (
        <ToolCallCard
          name={m.toolName || m.tool_name}
          callId={m.callId || m.tool_call_id}
          argsStr={m.argsStr || m.tool_input}
          resultStr={m.resultStr || m.tool_output}
          status={m.status}
        />
      );
      break;
    case 'usage':
      element = (
        <div className="text-xs text-center text-muted-foreground py-1 px-3">
          Tokens: 输入 {m.inputTokens} | 输出 {m.outputTokens}
        </div>
      );
      break;
    default:
      return null;
  }

  const alignClass = m.type === 'user'
    ? 'flex justify-end px-4 mb-1.5'
    : m.type === 'agent'
      ? 'flex justify-start px-4 mb-1.5'
      : 'px-4 py-0.5';

  return <div className={alignClass}>{element}</div>;
});

// ── ScrollToBottomButton — 1:1 from Hermes: subscribes to $threadScrolledUp independently ──
// This component re-renders on scrolledUp changes, but the PARENT virtualizer does NOT.
// This breaks the feedback loop: scrollToFn → onScroll → setScrolledUp → forceUpdate → virtualizer re-render → scrollToFn
function ScrollToBottomButton({ scrollerRef, stickyBottomRef, groupCount }: ScrollToBottomButtonProps) {
  const scrolledUp = useScrolledUp();

  const handleClick = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    stickyBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [scrollerRef, stickyBottomRef]);

  if (!scrolledUp || groupCount <= 2) return null;

  return (
    <button
      className={cn(
        'absolute bottom-3 right-4 z-10',
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full',
        'border bg-background shadow-md hover:bg-accent hover:text-accent-foreground',
        'transition-all outline-none',
        'w-8 h-8 text-muted-foreground'
      )}
      onClick={handleClick}
      title="滚到底部"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

export default memo(MessageContainerInner);
