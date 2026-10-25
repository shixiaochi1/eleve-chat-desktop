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
import { WsEvent, WsMethod } from '../types/ws-contract.generated';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Paperclip, Send, Square, X } from 'lucide-react';
import { base64FromDataURL, readFileAsDataURL } from '../utils/file';
import { getRemoteSocket } from '../services/connections';
import { submitPromptViaWs } from '../lib/prompt-submit';
import { fetchRemoteSessionHistory, type RemoteChatMessage } from '../utils/api';
import type { RemoteBotChat } from '../plugins/bots/state';
import {
  appendRemoteChatDelta, appendRemoteChatMessage, claimRemoteChatState,
  clearRemoteChatStreaming, remoteChatOwner, setRemoteChatError,
  setRemoteChatMessages, useRemoteChatState,
} from '../plugins/bots/remoteChatState';
import { cn } from '@/lib/utils';
// 🔴 阶段1 统一（frontend-chat-unification-2026-09-09）：渲染层收敛到
// MessageRow——删除手写气泡/自造光标，与单视图/宫格同一渲染原语。
import MessageRow from './MessageRow';
import ApprovalCard from './ApprovalCard';
import ClarifyCard from './ClarifyCard';
import ClarifyBatchCard, { type BatchQuestionWire } from './ClarifyBatchCard';
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
  // 🔴 阶段3 统一：消息/流式/错误状态迁组件外 atom（remoteChatState，owner 键
  // 守卫写入）——draft/sending/optimistic pending 是纯视图局部态，保留 useState/ref
  const remoteState = useRemoteChatState();
  const { messages, streamingText, error } = remoteState;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** 🔴 2026-10-25：远端私聊图片附件（先在 target 侧 `image.attach_bytes`
   *  附着到成员会话，再 `prompt.submit` 自动 drain——与本地单视图同链路）。 */
  const [attached, setAttached] = useState<
    Array<{
      id: string;
      name: string;
      preview: string;
      dataUrl: string;
      kind: 'image' | 'file';
    }>
  >([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** 🔴 2026-10-25：远端会话的交互卡（审批/澄清）。事件由目标网关的
   *  `approval.request` / `clarify.request` 推来；响应骑目标 socket。 */
  const [interactions, setInteractions] = useState<
    Record<string, { kind: 'approval' | 'clarify'; data: Record<string, unknown> }>
  >({});
  const removeInteraction = useCallback((requestId: string) => {
    setInteractions((cur) => {
      if (!cur[requestId]) return cur;
      const next = { ...cur };
      delete next[requestId];
      return next;
    });
  }, []);
  /**
   * 已发送但服务器历史尚未出现的用户消息（optimistic；服务器出现同文本后由 load 清退）。
   *
   * 🔴 round-120：存 `{id, text}` 而不是裸文本——`id` 要当 React key，必须**唯一**。
   * 此前 id = `` `pending-${text}` ``：连发两条相同文本 → key 冲突（渲染错乱/丢项）。
   */
  const pendingRef = useRef<Array<{ id: string; text: string }>>([]);
  /** 乐观条目 id 的单调序号（唯一性只在本视图内需要） */
  const pendingSeqRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** 权威历史重拉（后端唯一事实源；与主区"始终 loadHistory"同一原则） */
  const load = useCallback(async () => {
    const c = chatRef.current;
    // owner 在发起点钉死：async 响应期间切 chat → 写入被 owner 守卫丢弃
    const owner = remoteChatOwner(c.connId, c.sessionId);
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
      pendingRef.current = pendingRef.current.filter((p) => !serverUserTexts.has(p.text));
      const optimistic = pendingRef.current.map(
        (p) => ({ id: p.id, role: 'user', parts: [{ type: 'text', text: p.text }] }) as RemoteChatMessage,
      );
      setRemoteChatError(owner, null);
      setRemoteChatMessages(owner, [...server, ...optimistic]);
    } catch (e) {
      setRemoteChatError(owner, `远程连接不可达：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  /** 🔴 2026-10-25：target 拒写附件目录时的文本兜底（不落盘，直接把内容
   *  内联进 prompt；仅文本/代码，64KB 上限）。二进制没有安全的零落盘表示。 */
  async function inlineTextAttachment(dataUrl: string, name: string): Promise<string | null> {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const meta = dataUrl.slice(0, comma).toLowerCase();
    const textual =
      meta.includes('text/') ||
      meta.includes('json') ||
      meta.includes('xml') ||
      meta.includes('javascript') ||
      /\.(txt|md|markdown|json|jsonl|yaml|yml|toml|csv|tsv|log|py|rs|ts|tsx|js|jsx|go|java|c|h|cpp|css|html|xml|sql|sh)$/i.test(
        name,
      );
    if (!textual || !meta.includes('base64')) return null;
    try {
      const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (c) => c.charCodeAt(0));
      if (bytes.byteLength > 64 * 1024) return null;
      const text = new TextDecoder().decode(bytes);
      return text.trim() ? text : null;
    } catch {
      return null;
    }
  }

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const picked: Array<{
      id: string;
      name: string;
      preview: string;
      dataUrl: string;
      kind: 'image' | 'file';
    }> = [];
    for (const file of Array.from(files)) {
      if (attached.length + picked.length >= 4) break;
      if (file.size > 25 * 1024 * 1024) continue;
      const isImage =
        /^image\//.test(file.type || '') ||
        /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || '');
      try {
        const dataUrl = await readFileAsDataURL(file);
        picked.push({
          id: crypto.randomUUID(),
          name: file.name || (isImage ? 'image' : 'file'),
          preview: isImage ? dataUrl : '',
          dataUrl,
          kind: isImage ? 'image' : 'file',
        });
      } catch {
        /* 单个文件读取失败跳过 */
      }
    }
    if (picked.length) setAttached((cur) => [...cur, ...picked].slice(0, 4));
  }, [attached.length]);

  // ── 事件订阅（对齐 Hermes：事件流经 Desktop 持有的 socket 直达）──
  useEffect(() => {
    const owner = remoteChatOwner(chat.connId, chat.sessionId);
    setAttached([]);
    setInteractions({});
    // 🔴 阶段3：挂载/切换 chat 即认领（reset + 换 owner——旧 chat 状态不残留，
    // 旧视图迟到写入被 owner 守卫丢弃）
    claimRemoteChatState(owner);
    let sock: ReturnType<typeof getRemoteSocket>;
    try {
      sock = getRemoteSocket(chat.connId);
    } catch (e) {
      setRemoteChatError(owner, e instanceof Error ? e.message : String(e));
      return;
    }
    const sid = chat.sessionId;

    const handler = (eventName: string, rawData: unknown) => {
      const data = (rawData || {}) as Record<string, unknown>;
      // 交互事件可能不带 session_id（按连接推送）——只在它存在时过滤。
      if (data.session_id !== undefined && data.session_id !== sid) return;
      if (
        eventName === WsEvent.APPROVAL_REQUEST ||
        eventName === WsEvent.CLARIFY_REQUEST ||
        eventName === WsEvent.CLARIFY_BATCH_REQUEST
      ) {
        const requestId = String(data.request_id ?? data.clarify_id ?? '');
        if (!requestId) return;
        const kind = eventName === WsEvent.APPROVAL_REQUEST ? 'approval' : 'clarify';
        setInteractions((cur) => ({ ...cur, [requestId]: { kind, data } }));
        return;
      }
      if (eventName === WsEvent.APPROVAL_RESPONDED) {
        const requestId = String(data.request_id ?? '');
        if (requestId) removeInteraction(requestId);
        return;
      }
      if (eventName === WsEvent.MESSAGE_DELTA) {
        const delta = (data.delta as string) || '';
        if (!delta) return;
        appendRemoteChatDelta(owner, delta);
        return;
      }
      if (eventName === WsEvent.MESSAGE_COMPLETE) {
        // 轮收口 → 权威历史覆盖（流式气泡退役）
        clearRemoteChatStreaming(owner);
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
        sock.sendRpc(WsMethod.SESSION_ATTACH, { session_id: sid }).catch(() => {});
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
  }, [messages.length, streamingText, interactions]);

  // 🔴 2026-10-25（对齐 Hermes 远端会话复用主视图的停止能力）：远端轮此前一旦
  // 开跑就无法从 UI 停下，只能等预算耗尽。`session.interrupt` 是远端网关的
  // 既有方法（清 inbox + 置中断 + deny 审批），骑 owner socket 直发。
  const stop = async () => {
    const owner = remoteChatOwner(chat.connId, chat.sessionId);
    try {
      await getRemoteSocket(chat.connId).sendRpc(WsMethod.SESSION_INTERRUPT, {
        session_id: chat.sessionId,
      });
    } catch (e) {
      setRemoteChatError(owner, `停止失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const send = async () => {
    const text = draft.trim();
    const files = attached;
    if ((!text && !files.length) || sending) return;
    setSending(true);
    const owner = remoteChatOwner(chat.connId, chat.sessionId);
    setRemoteChatError(owner, null);
    const display = text || `（${files.length} 个附件）`;
    const pendingId = `pending-${(pendingSeqRef.current += 1)}`;
    pendingRef.current = [...pendingRef.current, { id: pendingId, text: display }];
    setDraft('');
    setAttached([]);
    appendRemoteChatMessage(owner, {
      id: pendingId,
      role: 'user',
      parts: [{ type: 'text', text: display }],
    });
    try {
      const sock = getRemoteSocket(chat.connId);
      const refs: string[] = [];
      // 图片走 bytes 附件（vision 链路）；普通文件走 `file.attach` 的
      // data_url staging，返回 `@file:` 引用注入 prompt（target workspace 落盘）。
      for (const f of files) {
        if (f.kind === 'image') {
          await sock.sendRpc(WsMethod.IMAGE_ATTACH_BYTES, {
            session_id: chat.sessionId,
            content_base64: base64FromDataURL(f.dataUrl),
            filename: f.name,
          });
        } else {
          try {
            const res = (await sock.sendRpc(WsMethod.FILE_ATTACH, {
              session_id: chat.sessionId,
              data_url: f.dataUrl,
              name: f.name,
            })) as { ref_text?: string; ref_path?: string };
            const ref = String(
              res?.ref_text || (res?.ref_path ? `@file:${res.ref_path}` : ''),
            ).trim();
            if (ref) refs.push(ref);
          } catch (e) {
            // target 附件目录不可写：文本/代码内联进 prompt（不落盘）；二进制
            // 没有安全的零落盘表示，保持明确失败。
            const text = await inlineTextAttachment(f.dataUrl, f.name);
            if (!text) throw e;
            refs.push(`[附件 ${f.name}]\n\`\`\`text\n${text}\n\`\`\``);
          }
        }
      }
      // 🔴 阶段2 统一：prompt.submit 公共骨架（ensureConnected + steer/queued
      // outcome toast + 新会话回调）——协议与单视图/宫格同源，此前独立实现
      // 无 outcome 消费。流式/回包全部经事件监听器到达（上方 handler），零轮询
      const promptText = [text, ...refs].filter(Boolean).join('\n\n') || '（附件）';
      void submitPromptViaWs(
        sock,
        { text: promptText, sessionId: chat.sessionId },
      ).catch((e) => {
        setRemoteChatError(owner, `发送失败：${e instanceof Error ? e.message : String(e)}`);
      });
    } catch (e) {
      setRemoteChatError(owner, `附件上传失败：${e instanceof Error ? e.message : String(e)}`);
      setAttached(files);
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
        <button
          type="button"
          className="ml-auto p-1 rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground shrink-0"
          title="停止当前轮"
          aria-label="停止当前轮"
          onClick={() => void stop()}
        >
          <Square size={13} />
        </button>
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
        {Object.entries(interactions).map(([requestId, it]) => {
          if (it.kind === 'approval') {
            return (
              <div key={`interact-${requestId}`} className="max-w-[92%] self-center w-full">
                <ApprovalCard
                  command={String(it.data.command ?? it.data.args_preview ?? '')}
                  description={String(it.data.description ?? '')}
                  pattern={String(it.data.pattern ?? '')}
                  choices={['once', 'deny']}
                  run_id={chat.sessionId}
                  request_id={requestId}
                  profile={chat.profile}
                  onSubmit={async (choice) => {
                    const res = (await getRemoteSocket(chat.connId).sendRpc(
                      WsMethod.APPROVAL_RESPOND,
                      {
                        session_id: chat.sessionId,
                        choice,
                        all: false,
                        request_id: requestId,
                        profile: chat.profile,
                      },
                    )) as { resolved?: number };
                    if (res?.resolved !== 0) removeInteraction(requestId);
                    return res || {};
                  }}
                  onDone={() => removeInteraction(requestId)}
                />
              </div>
            );
          }
          // 🔴 2026-10-25：批量澄清渲染完整多题表单（此前只取第一题，
          // 后续问题永远拿不到答案）。提交载荷仍为 Hermes 的
          // `{answers:{qid:raw}, timed_out:false}`，骑目标 socket 发。
          const batchItems = [
            it.data.questions,
            it.data.items,
            it.data.prompts,
            (it.data.batch as Record<string, unknown> | undefined)?.questions,
          ].find((v): v is Array<Record<string, unknown>> =>
            Array.isArray(v) && v.length > 0
          );
          if (batchItems) {
            const questions: BatchQuestionWire[] = batchItems.map((q, idx) => {
              // 自定义 batch schema：字段名常见变体统一归一（不猜业务语义，
              // 只接受明确等价的 id/question/choices/multi 字段）。
              const rawChoices = q.choices ?? q.options ?? q.values;
              return {
                qid: String(q.qid ?? q.id ?? q.key ?? q.name ?? `q${idx + 1}`),
                question: String(q.question ?? q.prompt ?? q.text ?? q.label ?? q.title ?? ''),
                choices: Array.isArray(rawChoices)
                  ? (rawChoices as unknown[])
                      .map((c) =>
                        typeof c === 'string'
                          ? c
                          : String((c as Record<string, unknown>)?.label ?? (c as Record<string, unknown>)?.value ?? ''),
                      )
                      .filter(Boolean)
                  : null,
                multi_select: (q.multi_select ?? q.multiSelect) === true,
              };
            });
            return (
              <div key={`interact-${requestId}`} className="max-w-[92%] self-center w-full">
                <ClarifyBatchCard
                  clarifyId={requestId}
                  title={String(it.data.title ?? '远端成员想确认几个问题')}
                  questions={questions}
                  submit={async (payload) => {
                    const res = await getRemoteSocket(chat.connId).sendRpc(
                      WsMethod.CLARIFY_RESPOND,
                      { request_id: requestId, answer: payload },
                    );
                    removeInteraction(requestId);
                    return (res as { status?: string; ok?: boolean }) || { status: 'ok' };
                  }}
                  onDone={() => removeInteraction(requestId)}
                />
              </div>
            );
          }
          const choices = Array.isArray(it.data.choices)
            ? (it.data.choices as string[])
            : undefined;
          return (
            <div key={`interact-${requestId}`} className="max-w-[92%] self-center w-full">
              <ClarifyCard
                clarifyId={requestId}
                title="远端成员想确认一下"
                question={String(it.data.question ?? '')}
                choices={choices}
                multiSelect={Boolean(it.data.multi_select)}
                submit={async (answer) => {
                  await getRemoteSocket(chat.connId).sendRpc(WsMethod.CLARIFY_RESPOND, {
                    request_id: requestId,
                    answer,
                  });
                  removeInteraction(requestId);
                  return { status: 'ok' };
                }}
                onDone={() => removeInteraction(requestId)}
                onExpired={() => removeInteraction(requestId)}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入行 */}
      <div className="p-3 pt-1">
        <div className="composer-surface relative rounded-2xl border">
          {attached.length > 0 && (
            <div className="flex flex-wrap gap-2 px-(--composer-surface-pad-x) pt-2">
              {attached.map((f) => (
                <div key={f.id} className="relative group">
                  {f.preview ? (
                    <img
                      src={f.preview}
                      alt={f.name}
                      className="h-14 w-14 object-cover rounded-md border border-[var(--ui-stroke-tertiary)]"
                    />
                  ) : (
                    <div className="h-14 max-w-40 px-2 flex items-center rounded-md border border-[var(--ui-stroke-tertiary)] bg-accent/40 text-[10px] text-muted-foreground">
                      <span className="truncate">{f.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-background border border-[var(--ui-stroke-tertiary)] text-muted-foreground"
                    title="移除附件"
                    onClick={() => setAttached((cur) => cur.filter((i) => i.id !== f.id))}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 px-(--composer-surface-pad-x) py-(--composer-surface-pad-y)">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => fileRef.current?.click()}
              title="添加附件（最多 4 个）"
              aria-label="Add attachment"
            >
              <Paperclip size={15} />
            </button>
            <textarea
              className="max-h-(--composer-input-max-height) min-h-(--composer-input-min-height) w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-normal outline-none placeholder:text-muted-foreground/60"
              placeholder={`发消息给 @${chat.profile}… (Enter 发送，可粘贴图片/文件)`}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                const fs = e.clipboardData?.files;
                if (fs?.length) {
                  e.preventDefault();
                  void addFiles(fs);
                }
              }}
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
              disabled={(!draft.trim() && !attached.length) || sending}
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
