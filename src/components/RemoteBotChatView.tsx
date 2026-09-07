/**
 * 🔴 2026-09-08 round-76：RemoteBotChatView — 远端 bot 的 canonical 会话视图。
 *
 * 对齐 Hermes："点远端 bot 行 = 打开远端 chat"（requestForBot 骑 owner 连接，
 * 本机 active connection 纹丝不动——hermes-bot-mode-system-map 10.2 DF2/四.3）。
 *
 * 形态取舍（Hermes 语义、ELEVE 机制）：
 * - Hermes 的远端会话 = session.resume 骑 route + 全事件流镜像（Desktop 持有
 *   socket、事件直达）。ELEVE 的 RemoteSocket 只有**一次性 sendRpc**（无事件
 *   转发）→ 采用「get_session_messages 轮询 + prompt.submit 后台发射」的轻量
 *   视图：后端是消息唯一权威源，覆盖式渲染（对齐"始终 loadHistory"既有原则）。
 * - 发送：optimistic 上屏（pending 合并，服务器消息出现后自然清空）+
 *   prompt.submit 骑 route（1800s 预算，与本地同款；不阻塞 UI）。
 * - 简化渲染（text parts 气泡）：跨连接视图是轻量通信面，不复制主聊天区的
 *   工具卡/审批/流式 machinery。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Send } from 'lucide-react';
import { requestForBot } from '../services/connections';
import type { RemoteBotChat } from '../plugins/bots/state';
import { cn } from '@/lib/utils';

interface ChatMessageLite {
  id?: string;
  role: string;
  parts?: Array<{ type?: string; text?: string }>;
}

function partsText(m: ChatMessageLite): string {
  return (m.parts || [])
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
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
  const [messages, setMessages] = useState<ChatMessageLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const pendingRef = useRef<string[]>([]);
  const timerRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const c = chatRef.current;
    try {
      const res = await requestForBot<{ messages?: ChatMessageLite[] }>(
        { connectionId: c.connId, profile: 'default' },
        'get_session_messages',
        { session_id: c.sessionId, limit: 50 },
        15_000,
      );
      const server = Array.isArray(res?.messages) ? res.messages : [];
      // pending 合并：服务器出现该用户文本 → 乐观条目退役（单一权威 = 后端）
      const serverUserTexts = new Set(
        server.filter((m) => m.role === 'user').map(partsText),
      );
      pendingRef.current = pendingRef.current.filter((t) => !serverUserTexts.has(t));
      const optimistic = pendingRef.current.map(
        (t) => ({ id: `pending-${t}`, role: 'user', parts: [{ type: 'text', text: t }] }) as ChatMessageLite,
      );
      setError(null);
      setMessages([...server, ...optimistic]);
    } catch (e) {
      setError(`远程连接不可达：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => { void load(); }, 3_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, chat.sessionId]);

  // 自动滚底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

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
      // prompt.submit 骑 owner 连接（1800s 预算与本地同款）；后台等——UI 靠轮询
      void requestForBot(
        { connectionId: chat.connId, profile: 'default' },
        'prompt.submit',
        { session_id: chat.sessionId, text },
        1_800_000,
      ).catch((e) => {
        setError(`发送失败：${e instanceof Error ? e.message : String(e)}`);
      });
      // 加速首轮拉取
      setTimeout(() => { void load(); }, 800);
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

      {/* 消息流（覆盖式渲染：后端是唯一权威源 + optimistic 合并） */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/70">
            尚无消息——发送第一条开始对话
          </div>
        )}
        {messages.map((m, i) => {
          const text = partsText(m);
          if (m.role === 'user') {
            return (
              <div key={m.id || `u-${i}`} className="flex justify-end">
                <div className="max-w-[85%] bg-user-bubble text-foreground border border-user-bubble-border rounded-2xl rounded-br-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm select-text">
                  {text}
                </div>
              </div>
            );
          }
          if (m.role === 'system') {
            return (
              <div key={m.id || `s-${i}`} className="text-center text-[11px] text-muted-foreground/60 py-1">
                {text}
              </div>
            );
          }
          return (
            <div key={m.id || `a-${i}`} className="flex justify-start">
              <div className="max-w-[85%] bg-[var(--ui-bg-card)] text-foreground border border-[var(--ui-stroke-tertiary)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words select-text">
                {text || '（无文本内容）'}
              </div>
            </div>
          );
        })}
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
