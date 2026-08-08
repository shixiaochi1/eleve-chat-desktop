/**
 * useGridChat — 宫格多 Agent 全功能聊天引擎
 *
 * ═══════════════════════════════════════════════════════════════════
 *  多 Profile 宫格模式 — 事件路由与隔离架构
 * ═══════════════════════════════════════════════════════════════════
 *
 * 【职责】
 *   管理 N 个 Agent 的独立聊天状态槽，通过单条 WS 连接解复用事件。
 *   每个 Agent 拥有独立的: sessionId / messages / streamParts / pending 交互。
 *
 * 【事件路由机制（核心隔离逻辑）】
 *
 *   后端事件帧格式:
 *     { params: { session_id: "agent:<profile>:ws:<uuid>", type: "message.delta", payload: {...} } }
 *
 *   路由链:
 *     ws-client.emit(eventName, data)
 *       → handler 提取 data.session_id
 *       → profileFromSessionId(session_id) 解析出 profile 名
 *       → patch(profile, ...) 只更新该 profile 的状态槽
 *
 *   隔离保证: 事件帧的 session_id 由后端在 session 创建时确定（agent:B:ws:xxx），
 *   前端仅解析不篡改。只要后端 session 创建正确，事件天然路由到正确 Agent。
 *
 * 【串台防御（sendTo 校验）】
 *
 *   发送前校验 statesRef[profile].sessionId 的 profile 前缀是否匹配目标 profile。
 *   不匹配 = localStorage 指针污染 → 丢弃该 sessionId，传空串让后端新建。
 *   详见 utils/session.ts 文件头的完整架构文档。
 *
 * 【与 useSSE 的互斥关系】
 *
 *   App 层以 viewMode 为键控制:
 *     viewMode === 'single' → useSSE(enabled=true),  useGridChat(active=false)
 *     viewMode === 'grid'   → useSSE(enabled=false), useGridChat(active=true)
 *
 *   useSSE enabled=false 时完全卸载 WS listener（useEffect cleanup），
 *   不存在两个 hook 同时消费 WS 事件的情况。
 *
 * 【内存控制】
 *   每 Agent 最多 WINDOW_MAX 条消息，超出从头部 evict。
 *   流式 delta 只写 ref 累加器，33ms flush 到状态（不触发消息列表重渲染）。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getWsClient } from '@/services/ws-client';
import { call } from '../utils/bridge';
import { profileFromSessionId, sessionIdMatchesProfile, persistSessionPointer } from '../utils/session';
import { toChatMessages, textPart, type SessionMessage, type ChatMessagePart } from '@/lib/chat-messages';
import { createAccumulator, resetAccumulator, resetAccumulatorForStep, processAccumulatorEvent, finalizeAccumulator, extractPendingInteractions, type StreamAccumulator } from '@/lib/ws-event-processor';
import { completionErrorText } from '@/lib/completion-error';
import { handleGlobalEvent } from '@/lib/global-events';
import { burstVibeHearts } from '@/lib/vibe-hearts';
import { interpretSlashResult, type SlashExecResult } from '@/lib/slash-result';
import { enqueue as queueEnqueue, dequeue as queueDequeue, peek as queuePeek, clearQueue, getQueueLength, getQueue, removeEntry, promoteEntry, MAX_DRAIN_ATTEMPTS, getDrainFailures, incrementDrainFailures, clearDrainFailures, resetAllDrainFailures, stashAttachmentData, takeAttachmentData, type QueuedAttachment } from '@/lib/message-queue';
import type { ChatMessage } from '@/types';

const WINDOW_MAX = 100;   // 每 Agent 内存最多保留消息数（超出 evict 头部）
const PAGE_SIZE = 20;     // 每次加载条数
const FLUSH_MS = 33;      // ~30fps 流式 flush

export type AgentStatus = 'idle' | 'streaming' | 'waiting';

export interface AgentChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  hasMore: boolean;
  oldestId: number | null;   // 上翻游标
  isLoadingMore: boolean;
  status: AgentStatus;
  /** 🔴 Phase 1: 流式 in-flight parts（到达序 segment，累加器 acc.parts 的 30fps flush 镜像）。
   *  完成后经 finalizeAccumulator 并入 messages、清空。与单视图 live parts 同构（同一套 segment 规则）。 */
  streamParts: ChatMessagePart[];
  pendingApproval: unknown | null;
  pendingClarify: unknown | null;
  pendingSudo: unknown | null;
  pendingSecret: unknown | null;
  /** 破坏性 slash 命令二次确认（对齐单视图 SlashConfirmCard） */
  pendingSlashConfirm: { confirmId: string; command: string; description: string } | null;
  /** 瞬态活动提示（thinking / tool.progress / delegate.progress，message.complete 清空） */
  activityHint: string;
  /** 后端推送的会话标题（session.title 事件） */
  sessionTitle: string | null;
  /** 当前模型名（model.name 事件） */
  modelName: string | null;
  /** 最近一轮 token 用量（message.complete usage） */
  lastUsage: { input: number; output: number; reasoning?: number; total?: number } | null;
  lastActivity: number;
}

function emptyState(): AgentChatState {
  return {
    sessionId: null, messages: [], hasMore: false, oldestId: null,
    isLoadingMore: false, status: 'idle', streamParts: [],
    pendingApproval: null, pendingClarify: null, pendingSudo: null, pendingSecret: null,
    pendingSlashConfirm: null, activityHint: '', sessionTitle: null, modelName: null, lastUsage: null,
    lastActivity: 0,
  };
}

let gridMsgSeq = 0;
const gridMsgId = () => `grid-${Date.now()}-${++gridMsgSeq}`;

export function useGridChat(active: boolean): {
  states: Record<string, AgentChatState>;
  loadLatest: (profile: string, sessionId: string) => Promise<void>;
  loadMore: (profile: string) => Promise<void>;
  sendTo: (profile: string, text: string, modelOpts?: { model?: string; provider?: string }, opts?: { attachments?: QueuedAttachment[]; attachmentDataURLs?: string[]; explicitSessionId?: string }) => Promise<void>;
  abortAgent: (profile: string) => Promise<void>;
  clearPending: (profile: string, kind: 'approval' | 'clarify' | 'sudo' | 'secret' | 'slash_confirm') => void;
  /** 新建会话：清空本 Agent 上下文，下条 sendTo 后端自动建新 session */
  resetAgent: (profile: string) => void;
  /** per-agent slash 命令执行（路由到本 Agent 的 session） */
  execCommand: (profile: string, cmdName: string, args?: string) => Promise<void>;
  /** slash 破坏性命令确认完成（对齐单视图 handleSlashConfirmDone：输出上屏 + session 轮换） */
  handleSlashConfirmDone: (profile: string, choice: string, result?: { output?: string; session_id?: string }) => void;
  /** 立即发送排队条目（对齐 Hermes sendQueuedNow） */
  sendQueueNow: (profile: string, id: string) => void;
  /** 删除排队条目 */
  deleteQueueEntry: (profile: string, id: string) => void;
} {
  const [states, setStates] = useState<Record<string, AgentChatState>>({});

  // per-agent 流式累加器（ref，高频写不触发渲染）
  const accRef = useRef<Record<string, StreamAccumulator>>({});
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statesRef = useRef(states);
  statesRef.current = states;

  // 🔴 per-agent 发送锁 + 排队（队列走 message-queue.ts localStorage 持久化，对齐 Hermes composer-queue）
  const sendingRef = useRef<Record<string, boolean>>({});
  // 🔴 per-entry 失败计数（对齐 Hermes drainFailuresRef Map）：记录当前正在 drain 的条目 ID
  const lastDrainEntryRef = useRef<Record<string, string | null>>({});
  // sendTo 镜像 ref（供 WS handler message.complete 内 drain 调用，避免循环依赖）
  const sendToRef = useRef<(profile: string, text: string, modelOpts?: { model?: string; provider?: string }, opts?: { attachments?: QueuedAttachment[]; attachmentDataURLs?: string[]; explicitSessionId?: string }, fromDrain?: boolean) => Promise<void>>(async () => {});

  // 单 Agent 状态更新（不可变 patch）
  const patch = useCallback((profile: string, updater: (s: AgentChatState) => AgentChatState) => {
    setStates((prev) => ({ ...prev, [profile]: updater(prev[profile] ?? emptyState()) }));
  }, []);

  // ── 加载最新 N 条（进入宫格 / 切到某 Agent 时） ──
  const loadLatest = useCallback(async (profile: string, sessionId: string) => {
    // 🔴 P0-3: 切会话前重置旧流状态（防旧流 message.complete 终稿注入新会话）
    if (accRef.current[profile]) resetAccumulator(accRef.current[profile]);
    sendingRef.current[profile] = false;
    clearQueue(profile);
    patch(profile, (s) => ({ ...s, sessionId, status: 'idle', streamParts: [], activityHint: '' }));
    try {
      const res = await call('get_session_messages', { session_id: sessionId, limit: PAGE_SIZE }) as {
        messages?: SessionMessage[]; has_more?: boolean; oldest_id?: number | null;
      };
      const msgs = toChatMessages((res?.messages ?? []) as SessionMessage[]);
      // 🔴 P1-10: 过期响应守卫 — 快速切换时旧响应不覆盖新会话
      patch(profile, (s) => {
        if (s.sessionId !== sessionId) return s;
        return {
          ...s,
          messages: msgs.slice(-WINDOW_MAX),
          hasMore: !!res?.has_more,
          oldestId: res?.oldest_id ?? null,
        };
      });
    } catch { /* offline：保留现有 */ }
  }, [patch]);

  // ── 上翻加载更早（before_id 游标） ──
  const loadMore = useCallback(async (profile: string) => {
    const s = statesRef.current[profile];
    if (!s?.sessionId || !s.hasMore || s.isLoadingMore || s.oldestId == null) return;
    // 🔴 P1-10: 快照当前 sessionId，用于过期响应守卫
    const expectedSid = s.sessionId;
    patch(profile, (st) => ({ ...st, isLoadingMore: true }));
    try {
      const res = await call('get_session_messages', {
        session_id: expectedSid, limit: PAGE_SIZE, before_id: s.oldestId,
      }) as { messages?: SessionMessage[]; has_more?: boolean; oldest_id?: number | null };
      const older = toChatMessages((res?.messages ?? []) as SessionMessage[]);
      patch(profile, (st) => {
        // 🔴 P1-10: 过期响应守卫 — 切会话期间旧响应不覆盖新会话
        if (st.sessionId !== expectedSid) return { ...st, isLoadingMore: false };
        const merged = [...older, ...st.messages];
        // 内存窗口：超 WINDOW_MAX 从尾部 evict（保留最新）—— 上翻加载的是更早的，插头部
        // 但为内存可控，限制总量；用户继续上翻会再加载
        // 🔴 P1-2.5: 上翻加载不做尾部裁剪（slice(-WINDOW_MAX) 会把刚加载的旧消息立刻 evict → loadMore 变 no-op）
        // 内存控制由新消息入队时的尾部 evict 保证（message.complete / step.complete 等）
        return {
          ...st,
          messages: merged,
          hasMore: !!res?.has_more,
          oldestId: res?.oldest_id ?? st.oldestId,
          isLoadingMore: false,
        };
      });
    } catch {
      patch(profile, (st) => ({ ...st, isLoadingMore: false }));
    }
  }, [patch]);

  // ── 发送消息到指定 Agent（显式 profile + session_id，不切全局盖章） ──
  const sendTo = useCallback(async (profile: string, text: string, modelOpts?: { model?: string; provider?: string }, opts?: { attachments?: QueuedAttachment[]; attachmentDataURLs?: string[]; explicitSessionId?: string }, fromDrain?: boolean) => {
    if (!text.trim()) return;

    // 🔴 Phase 2: per-agent 发送锁保留，但 busy 分支不再是"前端截流排队"——
    // 带附件/已排队条目才走前端队列（附件 base64 仅存本地内存，必须先上传后端，
    // 物理约束非截流）；纯文本直发后端 prompt.submit，由 route_busy_submit
    // 决定 steer/interrupt/queue（对齐 Hermes use-composer-submit busy 决策树：
    // busy + 纯文本 → steerDraft 直发；busy + 附件 → queueCurrentDraft）。
    // 前端队列定位降级为"回显 + 用户管理 UI + 附件暂存"（对齐 Hermes
    // $queuedPromptsBySession），drain 权归后端 spawn_ws_turn_with_drain。
    // 🔴 Phase 2: busy 判定 = 发送锁 OR 事件驱动状态非 idle（streaming/waiting）。
    // 关键：interrupt/queue 模式下后端 spawn_ws_turn_with_drain 会自动起新 turn
    // （run.started → status='streaming'，审批 → 'waiting'），该 turn 无前端锁 ——
    // 仅看 sendingRef 会把后端 drain turn 误判为 idle，走直发路径重置累加器抹掉终稿。
    const wasBusy = sendingRef.current[profile] || (statesRef.current[profile]?.status ?? 'idle') !== 'idle';
    if (wasBusy) {
      if (opts?.attachments?.length) {
        const entry = queueEnqueue(profile, { text, modelOpts, attachments: opts.attachments });
        // 🔴 附件 base64 暂存内存（drain 时取出附着后端，对齐单视图 stashAttachmentData）
        if (opts.attachmentDataURLs?.length) stashAttachmentData(entry.id, opts.attachmentDataURLs);
        patch(profile, (st) => ({
          ...st,
          messages: [...st.messages, { id: gridMsgId(), role: 'user', parts: [textPart(text)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX),
        }));
        return;
      }
      // 纯文本直发（乐观上屏由下方统一路径负责，此处 fall through）
    }

    const s = statesRef.current[profile];
    // 🔴 串台防御：sessionId 的 profile 前缀必须匹配目标 profile，否则丢弃（让后端新建）
    // 🔴 explicitSessionId 优先：新会话图片附件场景，AgentChatCard 已 session.create 并上传图片，
    //    必须用同一 session 提交（对齐 Hermes submit.ts: createBackendSessionForSend → syncAttachmentsForSubmit → prompt.submit）
    const rawSid = opts?.explicitSessionId ?? s?.sessionId ?? undefined;
    const sessionId = sessionIdMatchesProfile(rawSid, profile) ? rawSid : undefined;
    // explicitSessionId 场景：同步 slot 指针 + 持久化（该 session 由前端预创建，prompt.submit 不再返回新 id）
    if (opts?.explicitSessionId && sessionId) {
      patch(profile, (st) => ({ ...st, sessionId }));
      persistSessionPointer(sessionId);
    }
    // 🔴 自含防御（审查 P2）：前缀不匹配即同步清除 slot 脏指针 — 不归属本 profile 的 sessionId 不应占据 slot
    // （后续 abortAgent/execCommand 语义亦正确）。与 handler stale 守卫的前缀校验双保险：
    // 即使清除尚未镜像到 statesRef，守卫也不会拿脏值作丢弃依据；脏值清除后 slotSid=null 走“新鲜发送兼容”放行。
    if (rawSid && !sessionId) {
      patch(profile, (st) => ({ ...st, sessionId: null }));
    }
    // 🔴 P1-2.6: drain 路径跳过用户消息追加（排队时已上屏，再追加 = 重复显示）
    if (!fromDrain) {
      const userMsg: ChatMessage = {
        id: gridMsgId(), role: 'user', parts: [textPart(text)], timestamp: Date.now(),
      };
      patch(profile, (st) => ({
        ...st,
        messages: [...st.messages, userMsg].slice(-WINDOW_MAX),
        // 🔴 Phase 2: busy 直发不强置 streaming —— live turn 已持有 status（streaming/waiting）；
        // queued 类 outcome 等后端 drain 的 run.started 驱动，steered 沿用旧流
        ...(wasBusy ? {} : { status: 'streaming' as AgentStatus }),
      }));
    } else {
      patch(profile, (st) => ({ ...st, status: 'streaming' }));
    }
    // 🔴 Phase 2: busy 直发不重置累加器 —— live turn 正在其中累积 delta，
    // 重置会让当前轮 finalize 时丢失 acc.parts（终稿截断）
    if (!wasBusy) accRef.current[profile] = createAccumulator();

    // 🔴 P1-2.1: 先加锁再 await 连接（防双击竞态：两条快速消息都见 sendingRef=false → 双提交）
    // 🔴 Phase 2: wasBusy 直发路径【不加锁】——锁归属仍是 live turn（steered：旧流自带
    // message.complete 终止链；queued：后端 drain 循环起新 turn，run.started 驱动）。
    // 若此处加锁，旧 turn 的 complete 会误 drain 前端队列，且 queued 分支的释放逻辑双写。
    if (!wasBusy) sendingRef.current[profile] = true;

    // 🔴 3.1: 统一连接保障入口（消灭 3 份重复）
    const ws = getWsClient();
    // 🔴 P1-7: 检查返回值（对齐单视图 useSSE.send）—— 超时时快速失败，不让 sendRpc 排队 30min 静默卡死
    const connected = await ws.ensureConnected(10000);
    if (!connected) {
      if (!wasBusy) {
        sendingRef.current[profile] = false;
        patch(profile, (s) => ({ ...s, status: 'idle', streamParts: [], activityHint: '' }));
      }
      // 🔴 #11: 显式失败反馈（旧实现静默 return — 用户以为发出去了）
      import('../utils/notifications').then(({ notifyError }) => notifyError('WebSocket 连接超时，消息未发送', '发送失败')).catch(() => {});
      return;
    }

    // 🔴 Phase 2: drain 续发带 queued:true（红线 3 — Hermes server.py:7258 竞态保护：
    // client drain 的消息强制 queue，绝不劫持/打断 live turn）
    try {
      const result = await ws.sendRpc('prompt.submit', {
        text, profile, session_id: sessionId ?? '',
        // 🔴 对齐单视图：传递 model/provider（ModelPill 选择的模型生效）
        ...(modelOpts?.model ? { model: modelOpts.model, provider: modelOpts.provider || '' } : {}),
        ...(fromDrain ? { queued: true } : {}),
      }) as { session_id?: string; status?: string };
      // 后端可能新建 session → 记录 sessionId + 🔴 P1-F 即时持久化（防崩溃丢失）
      if (result?.session_id && result.session_id !== sessionId) {
        patch(profile, (st) => ({ ...st, sessionId: result.session_id! }));
        persistSessionPointer(result.session_id);
      }
      // 🔴 Phase 2: busy 直发消费后端路由结果（route_busy_submit outcome）：
      // - status 存在 = 命中 busy 分支。steered → 注入 live turn，无新 turn 事件，UI 提示。
      // - queued 类（interrupt 打断后入队 / 纯 queue / steer fall through）→ live turn 的
      //   message.complete(interrupted) 是锁释放 + drain 的唯一权威入口，后端
      //   spawn_ws_turn_with_drain 接续排队消息起新 turn，run.started 事件驱动 UI。
      //   两种情况都【不动发送锁】：锁归属仍是 live turn，早释放会打开双提交窗口。
      // - 无 status = idle accepted → 正常持锁（上方已加锁），等 message.complete 释放。
      if (result?.status === 'steered') {
        import('../utils/notifications').then(({ notifyInfo }) => notifyInfo('已注入当前轮（steer）', '消息已送达')).catch(() => {});
      }
    } catch (e) {
      // 🔴 Phase 2: wasBusy 直发失败不动锁 —— 锁归属是 live turn（其 complete 负责释放）
      if (!wasBusy) {
        sendingRef.current[profile] = false;
        patch(profile, (st) => ({ ...st, status: 'idle' }));
      }
      console.error('[useGridChat] sendTo failed:', profile, e);
      import('../utils/notifications').then(({ notifyError }) => notifyError('发送失败，请检查连接', '发送失败')).catch(() => {});
    }
  }, [patch]);

  // 同步 sendTo 镜像（供 WS handler drain 调用）
  sendToRef.current = sendTo;

  // ── drain 附件 re-attach + 发送（对齐单视图 drainQueue 附件流）──
  const drainSendEntry = useCallback(async (profile: string, entry: { id: string; text: string; modelOpts?: { model?: string; provider?: string }; attachments: QueuedAttachment[] }) => {
    // 🔴 附件 re-attach：drain 时取出内存 base64 → imageAttachBytes → 后端 session.attached_images
    const dataURLs = takeAttachmentData(entry.id);
    if (entry.attachments.length > 0 && dataURLs && dataURLs.length > 0) {
      try {
        const ws = getWsClient();
        const sid = statesRef.current[profile]?.sessionId;
        for (const dataURL of dataURLs) {
          const base64 = dataURL.includes(',') ? dataURL.split(',')[1]! : dataURL;
          await ws.imageAttachBytes(base64, undefined, sid ?? undefined);
        }
      } catch (e) {
        console.warn('[useGridChat] drain attachment re-attach failed:', e);
        import('../utils/notifications').then(({ notifyWarning }) => notifyWarning('附件重新附着失败，已降级为纯文本发送', '附件失效')).catch(() => {});
      }
    } else if (entry.attachments.length > 0 && !dataURLs) {
      import('../utils/notifications').then(({ notifyWarning }) => notifyWarning('页面刷新后附件数据已失效，已降级为纯文本发送', '附件失效')).catch(() => {});
    }
    await sendToRef.current(profile, entry.text, entry.modelOpts, undefined, true);
  }, []);

  // ── 中止某 Agent 的流 ──
  // 🔴 Phase B 重构：abort 不自释放锁 / 不自 drain。
  // 后端 session.interrupt 后必发 message.complete(interrupted=true)，
  // 该事件是锁释放 + drain 的唯一权威入口（消灭 abort 双 drain 并发 turn）。
  // 若 WS 断连导致 complete 丢失，session.info(running=false) 自愈分支兜底。
  const abortAgent = useCallback(async (profile: string) => {
    const s = statesRef.current[profile];
    if (!s?.sessionId) return;
    try { await getWsClient().abortStream(s.sessionId); } catch { /* ignore */ }
    // 只更新 UI 状态（清流式显示），不动锁 / 不 drain — 等 message.complete 权威终止
    patch(profile, (st) => ({ ...st, status: 'idle', streamParts: [], activityHint: '' }));
  }, [patch]);

  // ── 清除 per-agent pending 交互状态 ──
  // 审批/澄清/sudo 的实际回传由复用的交互卡片组件自行发送（ApprovalCard 走 WS
  // approval.respond、ClarifyCard 走 HTTP submitClarifyResponse、CredentialCard 由
  // AgentChatCard 提供 sudo_respond 的 onSubmit）——与单视图完全一致的单一权威路径。
  // 本 hook 只负责交互状态管理：卡片完成后调用 clearPending 收起弹窗、恢复 streaming。
  const clearPending = useCallback((profile: string, kind: 'approval' | 'clarify' | 'sudo' | 'secret' | 'slash_confirm') => {
    // 🔴 Phase 4b #7: status 由权威发送锁决定——锁在 = run 进行中 → streaming；
    // 锁不在 = run 已结束（或 onDismiss/deny 终止 turn）→ idle。
    // 根治“run 已结束 → 迟到卡片交互误置 streaming 卡死转圈”。
    const next: AgentStatus = sendingRef.current[profile] ? 'streaming' : 'idle';
    patch(profile, (st) => {
      if (kind === 'approval') return { ...st, pendingApproval: null, status: next };
      if (kind === 'clarify') return { ...st, pendingClarify: null, status: next };
      if (kind === 'sudo') return { ...st, pendingSudo: null, status: next };
      if (kind === 'slash_confirm') return { ...st, pendingSlashConfirm: null, status: next };
      return { ...st, pendingSecret: null, status: next };
    });
  }, [patch]);

  // ── slash 破坏性命令确认完成（镜像单视图 App.handleSlashConfirmDone）──
  // 后端 slash_confirm.respond 返回 { type:'exec', output, session_id? }：
  // output 上屏为 system 消息；session_id 轮换时重置消息窗口 + persistSessionPointer。
  const handleSlashConfirmDone = useCallback((profile: string, choice: string, result?: { output?: string; session_id?: string }) => {
    if (choice === 'cancel' || !result) {
      patch(profile, (st) => ({ ...st, pendingSlashConfirm: null, status: 'idle' }));
      return;
    }
    const output = result.output || '';
    const newSid = result.session_id;
    patch(profile, (st) => {
      if (newSid && newSid !== st.sessionId) {
        return {
          ...st, pendingSlashConfirm: null, sessionId: newSid, status: 'idle',
          messages: [{ id: gridMsgId(), role: 'system', parts: [textPart(output)], timestamp: Date.now() } as ChatMessage],
        };
      }
      return {
        ...st, pendingSlashConfirm: null, status: 'idle',
        messages: [...st.messages, { id: gridMsgId(), role: 'system', parts: [textPart(output)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX),
      };
    });
    if (newSid) persistSessionPointer(newSid);
  }, [patch]);

  // ── 新建会话：清空本 Agent 的 session 指针 + 消息 + 流式/交互状态 ──
  // 下一条 sendTo 的 session_id 为空 → 后端自动新建 session（与单视图 handleNewSession 同语义）。
  const resetAgent = useCallback((profile: string) => {
    // 🔴 abort 旧流，防残影 delta 写入重置后的状态槽
    const oldSid = statesRef.current[profile]?.sessionId;
    if (oldSid) getWsClient().abortStream(oldSid).catch(() => {});
    if (accRef.current[profile]) accRef.current[profile] = createAccumulator();
    // 🔴 释放发送锁 + 清排队消息（对齐单视图 resetSendingLock）
    // 不释放 → 旧流被 abort 后 message.complete 永不到达 → sendingRef 恒 true → Agent 锁死
    sendingRef.current[profile] = false;
    lastDrainEntryRef.current[profile] = null;
    resetAllDrainFailures();
    clearQueue(profile);
    patch(profile, (st) => ({
      ...emptyState(),
      lastActivity: st.lastActivity,
    }));
  }, [patch]);

  // ── per-agent slash 命令执行（对齐单视图 handleCommand，路由到本 Agent 的 session）──
  // prompt.submit 不解析 `/`，命令必须走 slash.exec。宫格从状态槽取本 Agent 的 sessionId。
  const execCommand = useCallback(async (profile: string, cmdName: string, args = '') => {
    const s = statesRef.current[profile];
    const sessionId = sessionIdMatchesProfile(s?.sessionId, profile) ? (s?.sessionId ?? undefined) : undefined;
    const display = args ? `/${cmdName} ${args}` : `/${cmdName}`;
    // 🔴 对齐 Hermes slashStatusText：system 消息用 `slash:/cmd\noutput` 格式，
    // SystemMessage 组件据此渲染 mono 命令 + 输出（单行居中/多行左对齐）
    const slashStatusText = (command: string, output: string) =>
      [`slash:/${command.replace(/^\//, '')}`, output.trim()].filter(Boolean).join('\n');
    // 乐观追加用户命令消息
    patch(profile, (st) => ({ ...st, messages: [...st.messages, { id: gridMsgId(), role: 'user', parts: [textPart(display)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX) }));
    try {
      // 🔴 P1-7: 显式传 sessionId（含空串），禁止 fallback 到 ws-client 陈旧全局 sessionId
      const result = await getWsClient().slashExec(`${cmdName} ${args}`.trim(), sessionId ?? '') as SlashExecResult;
      const action = interpretSlashResult(result, sessionId);

      switch (action.kind) {
        case 'confirm':
          patch(profile, (st) => ({
            ...st,
            pendingSlashConfirm: { confirmId: action.confirmId, command: action.command || cmdName, description: action.description },
            status: 'waiting',
          }));
          return;
        case 'send':
          if (action.output) {
            patch(profile, (st) => ({ ...st, messages: [...st.messages, { id: gridMsgId(), role: 'system', parts: [textPart(slashStatusText(cmdName, action.output!))] } as ChatMessage].slice(-WINDOW_MAX) }));
          }
          await sendTo(profile, action.kickoff);
          return;
        case 'rotate':
          patch(profile, (st) => ({
            ...st,
            sessionId: action.newSessionId,
            messages: [{ id: gridMsgId(), role: 'system', parts: [textPart(slashStatusText(cmdName, action.output))] } as ChatMessage],
          }));
          persistSessionPointer(action.newSessionId);
          return;
        case 'output':
          patch(profile, (st) => ({ ...st, messages: [...st.messages, { id: gridMsgId(), role: 'system', parts: [textPart(slashStatusText(cmdName, action.output))] } as ChatMessage].slice(-WINDOW_MAX) }));
          return;
      }
    } catch (err) {
      const msg = (err as Error).message;
      patch(profile, (st) => ({ ...st, messages: [...st.messages, { id: gridMsgId(), role: 'assistant', parts: [textPart(msg)], error: msg, timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX) }));
    }
  }, [patch, sendTo]);

  // ── WS 事件解复用（active 时接管所有事件） ──
  useEffect(() => {
    if (!active) return;
    const ws = getWsClient();

    const handler = (eventName: string, data: unknown) => {
      const raw = data as Record<string, unknown>;
      if (!raw) return;
      const payload = (raw.payload && typeof raw.payload === 'object' ? raw.payload : raw) as Record<string, unknown>;
      const sessionId = (raw.session_id ?? payload.session_id) as string | undefined;
      const profile = profileFromSessionId(sessionId);
      if (!profile) {
        // ── 全局事件（无 session_id）— 委托共享处理器（与单视图 useMessageStream 同一权威源）──
        handleGlobalEvent(eventName, payload);
        return;
      }

      const acc = (accRef.current[profile] ??= createAccumulator());

      // 🔴 #10: 过期流统一守卫 — 事件 session 与 slot 当前 session 不匹配（切会话后迟到）。
      // 累加事件直接丢弃（防旧流 delta 注入新会话）；终止事件释放 per-profile 锁（旧轮持锁）后丢弃。
      // 新鲜发送兼容：slot sessionId 为 null（新会话未拿到 id）时放行 — 事件已按 profile 前缀正确路由。
      // 🔴 自含防御（审查 P2）：slotSid 必须前缀归属本 profile 才可作丢弃依据；前缀不匹配的 slotSid = 脏指针，
      // 视同 null 放行。所有 sessionId 写入点均经校验（GridModeView 初始化/switchToSession + 后端响应天然正确），
      // 脏数据理论上不可能；此行使守卫不依赖“slot 恒干净”的隐式不变量，
      // 并覆盖 sendTo 同步清理尚未镜像到 statesRef（render-phase 镜像）的理论窗口。
      const slotSid = statesRef.current[profile]?.sessionId;
      if (sessionId && slotSid && sessionIdMatchesProfile(slotSid, profile) && sessionId !== slotSid) {
        if (eventName === 'message.complete' || eventName === 'error') {
          sendingRef.current[profile] = false;
          resetAccumulator(acc);
        }
        return;
      }

      // 🔴 P2-D: 流式累加事件走共享处理器（与单视图 useMessageStream 同一权威路径）
      if (!processAccumulatorEvent(acc, eventName, payload)) {
      switch (eventName) {
        case 'run.started':
        case 'message.start':
          patch(profile, (s) => ({ ...s, status: 'streaming', lastActivity: Date.now() }));
          break;
        case 'message.complete': {
          // 🔴 Phase 4b #5: 记录后端权威终稿（finalizeAccumulator 累加为空时兜底）
          // （过期流守卫已上提至 handler 顶部统一处理 — #10）
          acc.serverContent = (payload.content as string) || '';
          // 🔴 P2-D: 复用 finalizeAccumulator（与单视图同一 parts 组装逻辑）
          const finalParts = finalizeAccumulator(acc);
          resetAccumulator(acc);
          // 🔴 Phase 4b #5: 后端 message.complete 带 usage（C-3 2026-08-08 对齐 Hermes 内嵌，
          // 原独立 usage.summary 事件已删）——有值才覆盖，避免冲掉 session.info 已写入的 lastUsage
          const mUsage = payload.usage as Record<string, unknown> | undefined;
          const usageData = mUsage ? {
            input: (mUsage.input_tokens as number) || 0,
            output: (mUsage.output_tokens as number) || 0,
            reasoning: mUsage.reasoning_tokens as number | undefined,
            total: mUsage.total_tokens as number | undefined,
          } : null;
          // 🔴 C-1（2026-08-08）：结构化 failure 语义（对齐 Hermes gateway-event.ts L722-733）——
          // status=error 时消息带 error 标记（MessageRow 渲染 type=error 气泡）；
          // partial=true 保留流式部分文本，非 partial 剥文本只显错误。
          const failure =
            payload.status === 'error'
              ? {
                  error: ((payload.error as string) || (payload.content as string) || 'Agent 错误').trim(),
                  partial: Boolean(payload.partial),
                }
              : undefined;
          // 🔴 C-2（2026-08-08）：legacy 错误文本启发式（对齐 Hermes completionErrorText）——
          // 结构化 failure 优先，否则匹配 "API call failed after N retries:" / "HTTP xxx" /
          // "Provider error:" 文本（provider 200 但返回错误串的场景）
          const finalText = finalParts
            .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
            .map((p) => p.text)
            .join('')
          const completionError = failure?.error ?? completionErrorText(finalText)
          const keepFailedPartialText = Boolean(failure?.partial && finalText)
          const effectiveParts =
            completionError && !keepFailedPartialText
              ? finalParts.filter((p) => p.type !== 'text')
              : finalParts;
          patch(profile, (s) => {
            const msgs = effectiveParts.length || completionError
              ? [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: effectiveParts, timestamp: Date.now(), ...(completionError ? { error: completionError } : {}) }]
              : s.messages;
            return { ...s, messages: msgs.slice(-WINDOW_MAX), status: 'idle', streamParts: [], activityHint: '', lastUsage: usageData ?? s.lastUsage, lastActivity: Date.now() };
          });
          // 🔴 Phase B: 释放发送锁 + 排队消息自动发送（单一权威终止入口）
          // abort 不自 drain，message.complete 是唯一释放点 → 消灭双 drain 并发 turn
          sendingRef.current[profile] = false;
          // 🔴 per-entry 失败计数：成功重置当前 drain 条目
          { const eid = lastDrainEntryRef.current[profile]; if (eid) clearDrainFailures(eid); lastDrainEntryRef.current[profile] = null; }
          if (getQueueLength(profile) > 0) {
            const next = queueDequeue(profile);
            if (next) { lastDrainEntryRef.current[profile] = next.id; void drainSendEntry(profile, next); }
          }
          break;
        }
        case 'approval.request':
          // 🔴 run_id 在顶层（params.run_id = session_id），payload 内没有 → 合并进去，
          // 供 ApprovalCard 调 approval.respond（对齐 useSSE routeWsEvent 的 chunk 构造，
          // 否则宫格审批会发 session_id:undefined 导致审批失败）
          patch(profile, (s) => ({
            ...s,
            pendingApproval: { ...payload, run_id: (raw.run_id as string) ?? (raw.session_id as string) },
            status: 'waiting',
            lastActivity: Date.now(),
          }));
          break;
        case 'clarify.request':
          patch(profile, (s) => ({ ...s, pendingClarify: payload, status: 'waiting', lastActivity: Date.now() }));
          break;
        case 'sudo.request':
          patch(profile, (s) => ({ ...s, pendingSudo: payload, status: 'waiting', lastActivity: Date.now() }));
          break;
        case 'secret.request':
          patch(profile, (s) => ({ ...s, pendingSecret: payload, status: 'waiting', lastActivity: Date.now() }));
          break;
        // 🔴 P2-D: 审批被其他人/路径响应后收起卡片（对齐单视图 approval.responded）
        case 'approval.responded':
          // P2-9: 不硬编码 status，由后续事件（message.delta/complete）驱动真实状态
          patch(profile, (s) => s.pendingApproval ? { ...s, pendingApproval: null } : s);
          break;
        // 🔴 P2-D: 子 Agent 委托事件（对齐单视图 delegate.start/end）
        case 'delegate.start':
          patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'system', parts: [textPart(`▶ 委托子 Agent: ${(payload.goal as string) || payload.task_id || ''}`)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), lastActivity: Date.now() }));
          break;
        case 'delegate.end':
          patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'system', parts: [textPart(`✔ 子 Agent 完成: ${(payload.summary as string) || payload.status || 'done'}`)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), lastActivity: Date.now() }));
          break;
        case 'status.update': {
          // 按 kind 分流（对齐单视图 useMessageStream onStatusUpdate）
          const suKind = payload.kind as string;
          const suText = (payload.text as string) || '';
          if (suKind === 'background' && suText) {
            // 后台任务结果回推 → 追加到该 Agent 聊天流
            patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'system', parts: [textPart(suText)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), lastActivity: Date.now() }));
          } else if (suKind === 'lifecycle') {
            // 🔴 后端 reset 响应（/new /reset 后端路径）— 对齐单视图 onSessionReset
            const newSid = payload.new_session_id as string | undefined;
            // 🔴 释放发送锁 + 清排队（后端 reset 会中断当前流，message.complete 可能不到达）
            sendingRef.current[profile] = false;
            clearQueue(profile);
            if (newSid) {
              patch(profile, (s) => ({
                ...emptyState(),
                sessionId: newSid,
                lastActivity: Date.now(),
              }));
              persistSessionPointer(newSid);
            }
          } else if ((suKind === 'goal' || suKind === 'compressing') && suText) {
            // 目标状态 / 压缩进度 → 系统消息 + 活动提示
            patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'system', parts: [textPart(suText)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), activityHint: suText, lastActivity: Date.now() }));
          } else if (suText) {
            // 其他 status.update → 活动提示
            patch(profile, (s) => ({ ...s, activityHint: suText, lastActivity: Date.now() }));
          }
          break;
        }
        case 'error': {
          // 🔴 P1-6: 保留已累积内容（对齐单视图 onError：finalize + 错误标记 + toast）
          const errParts = finalizeAccumulator(acc);
          resetAccumulator(acc);
          const errMsg = (payload.message as string) || (payload.error as string) || '未知错误';
          patch(profile, (s) => {
            // 🔴 #9: 累加器为空时 errMsg 也必须上屏（旧实现静默丢弃错误）+ toast（对齐单视图 onError）
            const msgs = errParts.length
              ? [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: errParts, error: errMsg, timestamp: Date.now() }]
              : [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: [textPart(errMsg)], error: errMsg, timestamp: Date.now() }];
            return { ...s, messages: msgs.slice(-WINDOW_MAX), status: 'idle', streamParts: [], activityHint: '' };
          });
          import('../utils/notifications').then(({ notifyError }) => notifyError(errMsg, 'Agent 错误')).catch(() => {});
          // 🔴 Phase B: error 也是权威终止事件，释放锁 + drain（对齐单视图 onError → drainQueue）
          sendingRef.current[profile] = false;
          // 🔴 per-entry 失败计数：失败累加，超限暂停自动出队
          { const eid = lastDrainEntryRef.current[profile]; if (eid) incrementDrainFailures(eid); lastDrainEntryRef.current[profile] = null; }
          { const next = queuePeek(profile);
            if (next && getDrainFailures(next.id) < MAX_DRAIN_ATTEMPTS) {
              queueDequeue(profile); lastDrainEntryRef.current[profile] = next.id; void drainSendEntry(profile, next);
            } else if (next) {
              import('../utils/notifications').then(({ notifyError }) => notifyError(`排队消息连续失败 ${MAX_DRAIN_ATTEMPTS} 次，已暂停自动发送`, '队列暂停')).catch(() => {});
            }
          }
          break;
        }
        // ── 推理生命周期（reasoning.available / reasoning.delta / reasoning.end 均由 processAccumulatorEvent 统一处理）──
        // ── Agent 思考状态（对齐单视图 onThinking）──
        case 'thinking.delta':
          patch(profile, (s) => ({ ...s, activityHint: (payload.text as string) || '', lastActivity: Date.now() }));
          break;
        // ── 工具进度（对齐单视图 onToolProgress）──
        case 'tool.progress': {
          const tpTool = (payload.tool as string) || (payload.tool_name as string) || '';
          const tpPreview = payload.preview as string | undefined;
          patch(profile, (s) => ({ ...s, activityHint: tpPreview ? `${tpTool}: ${tpPreview}` : `⚙ ${tpTool} 执行中...`, lastActivity: Date.now() }));
          break;
        }
        // ── 子 Agent 详细进度（对齐单视图 onDelegateProgress）──
        case 'delegate.progress': {
          const dpEventType = payload.event_type as string | undefined;
          const dpSummary = (payload.progress_summary as string) || (payload.summary as string) || '';
          const dpGoal = payload.goal as string | undefined;
          const dpTool = payload.tool_name as string | undefined;
          if (dpEventType === 'complete' || dpEventType === 'end') {
            patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'system', parts: [textPart(`✔ 子 Agent 完成: ${dpSummary || dpGoal || 'done'}`)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), activityHint: '', lastActivity: Date.now() }));
          } else if (dpTool) {
            patch(profile, (s) => ({ ...s, activityHint: `↳ 子Agent: ${dpTool}`, lastActivity: Date.now() }));
          } else if (dpSummary) {
            patch(profile, (s) => ({ ...s, activityHint: `↳ ${dpSummary}`, lastActivity: Date.now() }));
          }
          break;
        }
        // ── 会话标题更新（对齐单视图 onSessionTitle）──
        case 'session.title':
          patch(profile, (s) => ({ ...s, sessionTitle: (payload.title as string) || null, lastActivity: Date.now() }));
          break;
        // ── 模型名 / Fallback（对齐单视图 onModelName / onFallbackActivated）──
        case 'model.name':
          patch(profile, (s) => ({ ...s, modelName: (payload.name as string) || null, lastActivity: Date.now() }));
          break;
        case 'fallback.activated': {
          const fbModel = (payload.model as string) || '';
          const fbProvider = (payload.provider as string) || '';
          patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'system', parts: [textPart(`⚠ 模型回退: ${fbProvider}/${fbModel}`)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), modelName: fbModel || s.modelName, lastActivity: Date.now() }));
          break;
        }
        // ── 步骤完成（对齐 Hermes _emit_interim_assistant_message 消息分界）/ 中间消息 / 后台审查 ──
        case 'step.complete': {
          // finalize 当前累加器 → 写入 messages 为独立气泡，步骤级重置（保留 sawStepComplete 标记）
          const stepParts = finalizeAccumulator(acc);
          resetAccumulatorForStep(acc);
          if (stepParts.length) {
            patch(profile, (s) => ({
              ...s,
              messages: [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: stepParts, timestamp: Date.now() }].slice(-WINDOW_MAX),
              streamParts: [],
              lastActivity: Date.now(),
            }));
          }
          break;
        }
        case 'message.interim': {
          const imContent = (payload.content as string) || '';
          // 🔴 #12: already_streamed 守卫（对齐单视图）— 流式已上屏的内容不重复 append
          if (imContent && !(payload.already_streamed as boolean)) {
            patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'assistant', parts: [textPart(imContent)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), lastActivity: Date.now() }));
          }
          break;
        }
        // reaction — 用户 affection（ily / <3 / good bot / 心形 emoji）→ 爱心彩蛋
        // 对齐 Hermes: gateway-event.ts reaction → burstVibeHearts()；纯 UI，永不触碰对话
        case 'reaction':
          if ((payload.kind as string) === 'vibe') {
            burstVibeHearts();
          }
          break;
        case 'background.review': {
          const brSummary = (payload.summary as string) || '';
          if (brSummary) {
            patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'system', parts: [textPart(`🔍 后台审查: ${brSummary}`)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), lastActivity: Date.now() }));
          }
          break;
        }
        // ── 会话详情恢复（对齐单视图 onSessionInfo — pending 交互重建 + 🔴 Phase B running=false 自愈）──
        case 'session.info': {
          // 🔴 Phase B: running=false 自愈 — WS 重连 / 后端重启后，锁可能泄漏（message.complete 丢失）
          // 单视图 useMessageStream:565 有等价分支；宫格之前缺失 → 流式卡死锁无逃生
          if (payload.running === false && sendingRef.current[profile]) {
            sendingRef.current[profile] = false;
            const finalParts = finalizeAccumulator(acc);
            resetAccumulator(acc);
            patch(profile, (s) => {
              const msgs = finalParts.length
                ? [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: finalParts, timestamp: Date.now() }]
                : s.messages;
              return { ...s, messages: msgs.slice(-WINDOW_MAX), status: 'idle', streamParts: [], activityHint: '', lastActivity: Date.now() };
            });
            // drain 排队消息（自愈 = 成功终止，重置计数）
            { const eid = lastDrainEntryRef.current[profile]; if (eid) clearDrainFailures(eid); lastDrainEntryRef.current[profile] = null; }
            if (getQueueLength(profile) > 0) {
              const next = queueDequeue(profile);
              if (next) { lastDrainEntryRef.current[profile] = next.id; void drainSendEntry(profile, next); }
            }
            break;
          }
          // 同步 model/usage（重连后状态对齐）
          const siModel = payload.model as string | undefined;
          const siUsage = payload.usage as Record<string, unknown> | undefined;
          // C-5（2026-08-08 对齐 Hermes resume inflight 投影）：failed turn 恢复——
          // 断线窗口错误帧丢失后，session.info 携带 inflight.error；重建失败气泡（幂等：
          // 按 error 文本匹配，session.info 每次状态变化都会推送）。
          const inflight = payload.inflight as { error?: string; assistant?: string } | undefined;
          if (inflight?.error && !statesRef.current[profile]?.messages.some((m) => m.error === inflight.error)) {
            const partial = (inflight.assistant || '').trim();
            patch(profile, (s) => ({
              ...s,
              messages: [
                ...s.messages,
                { id: gridMsgId(), role: 'assistant' as const, parts: partial ? [textPart(partial)] : [], error: inflight.error, timestamp: Date.now() },
              ].slice(-WINDOW_MAX),
              lastActivity: Date.now(),
            }));
          }
          const pending = extractPendingInteractions(
            payload.pending_prompts as Record<string, Record<string, unknown>> | undefined,
            (payload.run_id as string) ?? statesRef.current[profile]?.sessionId ?? undefined,
          );
          if (pending || siModel || siUsage) {
            patch(profile, (s) => ({
              ...s,
              ...(pending ? {
                pendingApproval: pending.approval ?? s.pendingApproval,
                pendingClarify: pending.clarify ?? s.pendingClarify,
                pendingSudo: pending.sudo ?? s.pendingSudo,
                pendingSecret: pending.secret ?? s.pendingSecret,
                pendingSlashConfirm: pending.slashConfirm ?? s.pendingSlashConfirm,
                status: 'waiting' as AgentStatus,
              } : {}),
              ...(siModel ? { modelName: siModel } : {}),
              ...(siUsage ? { lastUsage: { input: (siUsage.input_tokens as number) || 0, output: (siUsage.output_tokens as number) || 0 } } : {}),
              lastActivity: Date.now(),
            }));
          }
          break;
        }
        // 🔴 C-3（2026-08-08 对齐 Hermes）：usage 已内嵌 message.complete（唯一权威），
        // 删独立 usage.summary 消费（后端不再推此事件）
        default:
          // 🔴 P0-1.4: 带 session_id 的全局事件兜底（后端 build_ws_event 给几乎所有事件注入 session_id，
          // 不能仅凭“有无 session_id”区分全局/局部）—— notification/terminal.read.request/browser.progress 等
          handleGlobalEvent(eventName, payload);
          break;
      }
      } // end if (!processAccumulatorEvent)
    };

    ws.addEventListener(handler);

    // 30fps flush：把累加器 parts 镜像到状态的 streamParts（只更新流式气泡，不动 messages）
    flushTimerRef.current = setInterval(() => {
      const accs = accRef.current;
      const profiles = Object.keys(accs);
      if (profiles.length === 0) return;
      setStates((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const p of profiles) {
          const a = accs[p];
          const cur = next[p] ?? emptyState();
          if (cur.streamParts !== a.parts) {
            next[p] = { ...cur, streamParts: a.parts };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, FLUSH_MS);

    return () => {
      ws.removeEventListener(handler);
      if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null; }
    };
  }, [active, patch]);

  // ── 立即发送排队条目（对齐 Hermes sendQueuedNow：busy→promote+abort / idle→立即发）──
  const sendQueueNow = useCallback((profile: string, id: string) => {
    if (sendingRef.current[profile]) {
      promoteEntry(profile, id);
      clearDrainFailures(id);
      const s = statesRef.current[profile];
      if (s?.sessionId) getWsClient().abortStream(s.sessionId).catch(() => {});
      patch(profile, (st) => ({ ...st, status: 'idle', streamParts: [], activityHint: '' }));
      return;
    }
    clearDrainFailures(id);
    const entries = getQueue(profile);
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    removeEntry(profile, id);
    lastDrainEntryRef.current[profile] = entry.id;
    void drainSendEntry(profile, entry);
  }, [patch, drainSendEntry]);

  // ── 删除排队条目 ──
  const deleteQueueEntry = useCallback((profile: string, id: string) => {
    removeEntry(profile, id);
    clearDrainFailures(id);
  }, []);

  return { states, loadLatest, loadMore, sendTo, abortAgent, clearPending, resetAgent, execCommand, handleSlashConfirmDone, sendQueueNow, deleteQueueEntry };
}
