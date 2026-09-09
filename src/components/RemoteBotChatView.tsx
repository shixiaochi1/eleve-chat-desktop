/**
 * 🔴 2026-09-08 round-76：RemoteBotChatView — 远端 bot 的 canonical 会话视图
 * （**事件驱动**，对齐 Hermes DF2 的本质："Desktop 持有每条 gateway socket，
 * 所有跨连接 I/O 与事件流都经它"——hermes-bot-mode-system-map §relay/§10.2）。
 *
 * 🔴 2026-09-08 v2（用户否决轮询妥协版）：远端 socket 本就是完整
 * GatewayWsClient 实例（connections.ts `new GatewayWsClient(); connectRemote()`），
 * 事件分发（handleMessage → emit）/ session.attach 订阅 / 断线重连 re-attach
 * 全部现成——之前的"3s 轮询等价语义"是错误判断下的偷懒方案，已删除。
 *
 * 事件驱动形态（与主聊天区同一协议）：
 * - 挂载：getRemoteSocket → subscribeSession（注册 + 自动 session.attach，
 *   后端把该连接注册进 ws_clients[sid]，事件只推给本连接）+ addEventListener
 * - `message.delta` → 流式累积（末尾流式气泡）
 * - `message.complete` → 一次 get_session_messages 重拉权威历史（后端唯一
 *   权威源，与主区"始终 loadHistory"同一原则）+ pending 合并清退
 * - 卸载：removeEventListener + unsubscribeSession（重连不再 re-attach）
 * - prompt.submit 骑 owner route（1800s 预算），回包/流全部走事件，零轮询
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Send } from 'lucide-react';
import { getRemoteSocket } from '../services/connections';
import { submitPromptViaWs } from '../lib/prompt-submit';
import { fetchRemoteSessionHistory, type RemoteChatMessage } from '../utils/api';
import type { RemoteBotChat } from '../plugins/bots/state';
import { cn } from '@/lib/utils';
// 🔴 阶段1 统一（frontend-chat-unification-2026-09-09）：渲染层收敛到
// MessageRow——删除手写气泡/自造光标，与单视图/宫格同一渲染原语。
import MessageRow from './MessageRow';
import type { ChatMessage } from '@/types';

function partsText(m: RemoteChatMessage): string {
  return (m.parts || [])
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
}

/** RemoteChatMessage（session.history lite 行）→ ChatMessage（MessageRow 输入）。
 *  远端历史是 lite 版（仅 text parts），role 收敛到 MessageRole 三态。 */
function toChatMessage(m: RemoteChatMessage, index: number): ChatMessage {
  const parts = (m.parts || [])
    .filter((p): p is { type: 'text'; text: string } => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => ({ type: 'text' as const, text: p.text }));
  return {
    id: m.id || `r-${index}`,
    role: m.role === 'user' || m.role === 'system' ? m.role : 'assistant',
    parts,
  };
}

export default function RemoteBotChatView({
  chat,
  onBack,
}: {
  chat: RemoteBotChat;
  onBack: () => void;
}) {
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const [messages, setMessages] = useState<RemoteChatMessage[]>([]);
  /** 流式中的 assistant 文本（message.delta 累积；message.complete 清空并 load） */
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** 已发送但服务器历史尚未出现的用户文本（optimistic；message.complete 后 load 清退） */
  const pendingRef = useRef<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** 权威历史重拉（后端唯一事实源；与主区"始终 loadHistory"同一原则） */
  const load = useCallback(async () => {
    const c = chatRef.current;
    try {
      // 🔴 round-78 P0：方法名必须是网关 WS 注册名 `session.history`——
      // requestForBot 有 route 时字面发送，bridge 的 get_session_messages
      // 映射仅 null-route 生效；此前直发 'get_session_messages' → 远端
      // method-not-found → 历史恒空 + "远程连接不可达"
      const server = await fetchRemoteSessionHistory(c.connId, c.sessionId, 50);
      // pending 合并：服务器出现该用户文本 → 乐观条目退役
      const serverUserTexts = new Set(
        server.filter((m) => m.role === 'user').map(partsText),
      );
      pendingRef.current = pendingRef.current.filter((t) => !serverUserTexts.has(t));
      const optimistic = pendingRef.current.map(
        (t) => ({ id: `pending-${t}`, role: 'user', parts: [{ type: 'text', text: t }] }) as RemoteChatMessage,
      );
      setError(null);
      setMessages([...server, ...optimistic]);
    } catch (e) {
      setError(`远程连接不可达：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // ── 事件订阅（对齐 Hermes：事件流经 Desktop 持有的 socket 直达）──
  useEffect(() => {
    let sock: ReturnType<typeof getRemoteSocket>;
    try {
      sock = getRemoteSocket(chat.connId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const sid = chat.sessionId;

    const handler = (eventName: string, rawData: unknown) => {
      const data = (rawData || {}) as Record<string, unknown>;
      if (data.session_id !== sid) return;
      if (eventName === 'message.delta') {
        const delta = (data.delta as string) || '';
        if (!delta) return;
        setStreamingText((cur) => (cur ?? '') + delta);
        return;
      }
      if (eventName === 'message.complete') {
        // 轮收口 → 权威历史覆盖（流式气泡退役）
        setStreamingText(null);
        void load();
        return;
      }
    };
    const unsub = sock.addEventListener(handler);

    // 订阅 + attach：subscribeSession 在"已连接"时自动发 session.attach；
    // 懒建 socket 尚在连接中 → ensureConnected 后补发（重连 re-attach 由
    // attachedSessions 注册表自动处理）。
    sock.subscribeSession(sid);
    void sock.ensureConnected(10_000).then((ok) => {
      if (ok) {
        sock.sendRpc('session.attach', { session_id: sid }).catch(() => {});
      }
    });

    void load();
    return () => {
      unsub();
      // 从注册表移除（重连不再 re-attach）；不发 detach RPC——与主客户端
      // detachSession 同款语义（LRU 注册表纯本地）
      sock.unsubscribeSession(sid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.connId, chat.sessionId]);

  // 自动滚底（新消息 / 流式增长）
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamingText]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    pendingRef.current = [...pendingRef.current, text];
    setDraft('');
    setMessages((cur) => [
      ...cur,
      { id: `pending-${text}`, role: 'user', parts: [{ type: 'text', text }] },
    ]);
    try {
      // 🔴 阶段2 统一：prompt.submit 公共骨架（ensureConnected + steer/queued
      // outcome toast + 新会话回调）——协议与单视图/宫格同源，此前独立实现
      // 无 outcome 消费。流式/回包全部经事件监听器到达（上方 handler），零轮询
      void submitPromptViaWs(
        getRemoteSocket(chat.connId),
        { text, sessionId: chat.sessionId },
      ).catch((e) => {
        setError(`发送失败：${e instanceof Error ? e.message : String(e)}`);
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--ui-stroke-tertiary)] shrink-0">
        <button className="p-1 rounded hover:bg-accent/50" onClick={onBack} title="返回">
          <ArrowLeft size={15} className="text-muted-foreground" />
        </button>
        <Bot size={15} className="text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">
            🤖 {chat.label}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            远程连接 · @{chat.profile} · Bot Chat
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      )}

      {/* 消息流：权威历史 + 流式气泡（事件驱动，无轮询）。
          🔴 阶段1 统一：渲染走 MessageRow（与单视图/宫格同一原语）；
          流式 = 合成 pending assistant 消息（MessageRow 的 streaming 门控
          自带平滑揭示与光标，删除原手写光标 span）。 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && !streamingText && (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
            尚无消息——发送第一条开始对话
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow key={m.id || `r-${i}`} message={toChatMessage(m, i)} />
        ))}
        {streamingText !== null && (
          <MessageRow
            message={{
              id: 'remote-streaming',
              role: 'assistant',
              parts: [{ type: 'text', text: streamingText || '…' }],
              pending: true,
            }}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入行 */}
      <div className="p-3 pt-1">
        <div className="composer-surface relative rounded-2xl border">
          <div className="flex items-end gap-2 px-(--composer-surface-pad-x) py-(--composer-surface-pad-y)">
            <textarea
              className="max-h-(--composer-input-max-height) min-h-(--composer-input-min-height) w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-normal outline-none placeholder:text-muted-foreground/60"
              placeholder={`发消息给 @${chat.profile}… (Enter 发送)`}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className={cn(
                'inline-flex size-(--composer-control-primary-size) shrink-0 cursor-pointer items-center justify-center rounded-full p-0 outline-none transition-all duration-150',
                'bg-foreground text-background hover:bg-foreground/90 active:scale-90',
                'disabled:cursor-not-allowed disabled:bg-foreground/30 disabled:opacity-100 disabled:active:scale-100',
              )}
              disabled={!draft.trim() || sending}
              onClick={() => void send()}
              title="发送"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
