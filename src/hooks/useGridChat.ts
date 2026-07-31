/**
 * useGridChat — 宫格多 Agent 全功能聊天引擎
 *
 * ═══════════════════════════════════════════════════════════════════
 *  多 Profile 宫格模式 — 事件路由与隔离架构
 * ═══════════════════════════════════════════════════════════════════
 *
 * 【职责】
 *   管理 N 个 Agent 的独立聊天状态槽，通过单条 WS 连接解复用事件。
 *   每个 Agent 拥有独立的: sessionId / messages / streamText / pending 交互。
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
import { createAccumulator, resetAccumulator, processAccumulatorEvent, finalizeAccumulator, extractPendingInteractions, type StreamAccumulator } from '@/lib/ws-event-processor';
import { handleGlobalEvent } from '@/lib/global-events';
import { interpretSlashResult, type SlashExecResult } from '@/lib/slash-result';
import { enqueue as queueEnqueue, dequeue as queueDequeue, clearQueue, getQueueLength, MAX_DRAIN_ATTEMPTS } from '@/lib/message-queue';
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
  streamText: string;        // 当前流式累积（完成后并入 messages，清空）
  streamReasoning: string;
  streamParts: ChatMessagePart[];  // 流式中的工具调用 parts（复用 upsertToolPart 权威路径）
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
    isLoadingMore: false, status: 'idle', streamText: '', streamReasoning: '', streamParts: [],
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
  sendTo: (profile: string, text: string, modelOpts?: { model?: string; provider?: string }) => Promise<void>;
  abortAgent: (profile: string) => Promise<void>;
  clearPending: (profile: string, kind: 'approval' | 'clarify' | 'sudo' | 'secret' | 'slash_confirm') => void;
  /** 新建会话：清空本 Agent 上下文，下条 sendTo 后端自动建新 session */
  resetAgent: (profile: string) => void;
  /** per-agent slash 命令执行（路由到本 Agent 的 session） */
  execCommand: (profile: string, cmdName: string, args?: string) => Promise<void>;
  /** slash 破坏性命令确认完成（对齐单视图 handleSlashConfirmDone：输出上屏 + session 轮换） */
  handleSlashConfirmDone: (profile: string, choice: string, result?: { output?: string; session_id?: string }) => void;
} {
  const [states, setStates] = useState<Record<string, AgentChatState>>({});

  // per-agent 流式累加器（ref，高频写不触发渲染）
  const accRef = useRef<Record<string, StreamAccumulator>>({});
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statesRef = useRef(states);
  statesRef.current = states;

  // 🔴 per-agent 发送锁 + 排队（队列走 message-queue.ts localStorage 持久化，对齐 Hermes composer-queue）
  const sendingRef = useRef<Record<string, boolean>>({});
  // 🔴 对齐 Hermes MAX_AUTO_DRAIN_ATTEMPTS: per-profile 连续失败计数
  const drainAttemptsRef = useRef<Record<string, number>>({});
  // sendTo 镜像 ref（供 WS handler message.complete 内 drain 调用，避免循环依赖）
  const sendToRef = useRef<(profile: string, text: string, modelOpts?: { model?: string; provider?: string }, fromDrain?: boolean) => Promise<void>>(async () => {});

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
    patch(profile, (s) => ({ ...s, sessionId, status: 'idle', streamText: '', streamReasoning: '', streamParts: [], activityHint: '' }));
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
  const sendTo = useCallback(async (profile: string, text: string, modelOpts?: { model?: string; provider?: string }, fromDrain?: boolean) => {
    if (!text.trim()) return;

    // 🔴 per-agent 发送锁：流式期间排队（持久化，对齐 Hermes composer-queue），结束后自动发送
    if (sendingRef.current[profile]) {
      queueEnqueue(profile, { text, modelOpts });
      patch(profile, (st) => ({
        ...st,
        messages: [...st.messages, { id: gridMsgId(), role: 'user', parts: [textPart(text)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX),
      }));
      return;
    }

    const s = statesRef.current[profile];
    // 🔴 串台防御：sessionId 的 profile 前缀必须匹配目标 profile，否则丢弃（让后端新建）
    const rawSid = s?.sessionId ?? undefined;
    const sessionId = sessionIdMatchesProfile(rawSid, profile) ? rawSid : undefined;
    // 🔴 P1-2.6: drain 路径跳过用户消息追加（排队时已上屏，再追加 = 重复显示）
    if (!fromDrain) {
      const userMsg: ChatMessage = {
        id: gridMsgId(), role: 'user', parts: [textPart(text)], timestamp: Date.now(),
      };
      patch(profile, (st) => ({
        ...st,
        messages: [...st.messages, userMsg].slice(-WINDOW_MAX),
        status: 'streaming',
      }));
    } else {
      patch(profile, (st) => ({ ...st, status: 'streaming' }));
    }
    accRef.current[profile] = createAccumulator();

    // 🔴 P1-2.1: 先加锁再 await 连接（防双击竞态：两条快速消息都见 sendingRef=false → 双提交）
    sendingRef.current[profile] = true;

    // 🔴 3.1: 统一连接保障入口（消灭 3 份重复）
    const ws = getWsClient();
    // 🔴 P1-7: 检查返回值（对齐单视图 useSSE.send）—— 超时时快速失败，不让 sendRpc 排队 30min 静默卡死
    const connected = await ws.ensureConnected(10000);
    if (!connected) {
      sendingRef.current[profile] = false;
      patch(profile, (s) => ({ ...s, status: 'idle', streamText: '', streamReasoning: '', streamParts: [], activityHint: '' }));
      return;
    }

    try {
      const result = await ws.sendRpc('prompt.submit', {
        text, profile, session_id: sessionId ?? '',
        // 🔴 对齐单视图：传递 model/provider（ModelPill 选择的模型生效）
        ...(modelOpts?.model ? { model: modelOpts.model, provider: modelOpts.provider || '' } : {}),
      }) as { session_id?: string };
      // 后端可能新建 session → 记录 sessionId + 🔴 P1-F 即时持久化（防崩溃丢失）
      if (result?.session_id && result.session_id !== sessionId) {
        patch(profile, (st) => ({ ...st, sessionId: result.session_id! }));
        persistSessionPointer(result.session_id);
      }
    } catch (e) {
      sendingRef.current[profile] = false;
      patch(profile, (st) => ({ ...st, status: 'idle' }));
      console.error('[useGridChat] sendTo failed:', profile, e);
    }
  }, [patch]);

  // 同步 sendTo 镜像（供 WS handler drain 调用）
  sendToRef.current = sendTo;

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
    patch(profile, (st) => ({ ...st, status: 'idle', streamText: '', streamReasoning: '', activityHint: '' }));
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
            patch(profile, (st) => ({ ...st, messages: [...st.messages, { id: gridMsgId(), role: 'system', parts: [textPart(action.output!)] } as ChatMessage].slice(-WINDOW_MAX) }));
          }
          await sendTo(profile, action.kickoff);
          return;
        case 'rotate':
          patch(profile, (st) => ({
            ...st,
            sessionId: action.newSessionId,
            messages: [{ id: gridMsgId(), role: 'system', parts: [textPart(action.output)] } as ChatMessage],
          }));
          persistSessionPointer(action.newSessionId);
          return;
        case 'output':
          patch(profile, (st) => ({ ...st, messages: [...st.messages, { id: gridMsgId(), role: 'system', parts: [textPart(action.output)] } as ChatMessage].slice(-WINDOW_MAX) }));
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

      // 🔴 P2-D: 流式累加事件走共享处理器（与单视图 useMessageStream 同一权威路径）
      if (!processAccumulatorEvent(acc, eventName, payload)) {
      switch (eventName) {
        case 'run.started':
        case 'message.start':
          patch(profile, (s) => ({ ...s, status: 'streaming', lastActivity: Date.now() }));
          break;
        case 'message.complete': {
          // 🔴 P0-3: 过期流守卫 — 事件 session_id 与 slot 当前 sessionId 不匹配时，
          // 说明是旧流的终止事件（切会话后迟到）：释放锁但不 append（防旧流终稿注入新会话）
          const slotSid = statesRef.current[profile]?.sessionId;
          if (sessionId && slotSid && sessionId !== slotSid) {
            sendingRef.current[profile] = false;
            resetAccumulator(acc);
            break;
          }
          // 🔴 Phase 4b #5: 记录后端权威终稿（finalizeAccumulator 累加为空时兜底）
          acc.serverContent = (payload.content as string) || '';
          // 🔴 P2-D: 复用 finalizeAccumulator（与单视图同一 parts 组装逻辑）
          const finalParts = finalizeAccumulator(acc);
          resetAccumulator(acc);
          // 🔴 Phase 4b #5: 后端 message.complete 不带 usage（走独立 usage.summary 事件），
          // payload.usage 恒 undefined —— 仅在真有值时覆盖，避免冲掉 usage.summary 已写入的 lastUsage
          const mUsage = payload.usage as Record<string, unknown> | undefined;
          const usageData = mUsage ? {
            input: (mUsage.input_tokens as number) || 0,
            output: (mUsage.output_tokens as number) || 0,
            reasoning: mUsage.reasoning_tokens as number | undefined,
            total: mUsage.total_tokens as number | undefined,
          } : null;
          patch(profile, (s) => {
            const msgs = finalParts.length
              ? [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: finalParts, timestamp: Date.now() }]
              : s.messages;
            return { ...s, messages: msgs.slice(-WINDOW_MAX), status: 'idle', streamText: '', streamReasoning: '', streamParts: [], activityHint: '', lastUsage: usageData ?? s.lastUsage, lastActivity: Date.now() };
          });
          // 🔴 Phase B: 释放发送锁 + 排队消息自动发送（单一权威终止入口）
          // abort 不自 drain，message.complete 是唯一释放点 → 消灭双 drain 并发 turn
          sendingRef.current[profile] = false;
          drainAttemptsRef.current[profile] = 0; // 成功重置计数
          if (getQueueLength(profile) > 0) {
            const next = queueDequeue(profile);
            if (next) sendToRef.current(profile, next.text, next.modelOpts, true);
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
            const msgs = errParts.length
              ? [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: errParts, error: errMsg, timestamp: Date.now() }]
              : s.messages;
            return { ...s, messages: msgs.slice(-WINDOW_MAX), status: 'idle', streamText: '', streamReasoning: '', streamParts: [], activityHint: '' };
          });
          // 🔴 Phase B: error 也是权威终止事件，释放锁 + drain（对齐单视图 onError → drainQueue）
          sendingRef.current[profile] = false;
          drainAttemptsRef.current[profile] = (drainAttemptsRef.current[profile] ?? 0) + 1;
          if ((drainAttemptsRef.current[profile] ?? 0) < MAX_DRAIN_ATTEMPTS && getQueueLength(profile) > 0) {
            const next = queueDequeue(profile);
            if (next) sendToRef.current(profile, next.text, next.modelOpts, true);
          }
          break;
        }
        // ── 推理生命周期（reasoning.end 已由 processAccumulatorEvent 统一处理）──
        case 'reasoning.available':
          // 推理块开始通知（无文本，delta 事件随后到）—— 不额外处理
          break;
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
          // finalize 当前累加器 → 写入 messages 为独立气泡，重置累加器供下一步使用
          const stepParts = finalizeAccumulator(acc);
          resetAccumulator(acc);
          if (stepParts.length) {
            patch(profile, (s) => ({
              ...s,
              messages: [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts: stepParts, timestamp: Date.now() }].slice(-WINDOW_MAX),
              streamText: '', streamReasoning: '', streamParts: [],
              lastActivity: Date.now(),
            }));
          }
          break;
        }
        case 'interim.message': {
          const imContent = (payload.content as string) || '';
          if (imContent) {
            patch(profile, (s) => ({ ...s, messages: [...s.messages, { id: gridMsgId(), role: 'assistant', parts: [textPart(imContent)], timestamp: Date.now() } as ChatMessage].slice(-WINDOW_MAX), lastActivity: Date.now() }));
          }
          break;
        }
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
              return { ...s, messages: msgs.slice(-WINDOW_MAX), status: 'idle', streamText: '', streamReasoning: '', streamParts: [], activityHint: '', lastActivity: Date.now() };
            });
            // drain 排队消息（自愈 = 成功终止，重置计数）
            drainAttemptsRef.current[profile] = 0;
            if (getQueueLength(profile) > 0) {
              const next = queueDequeue(profile);
              if (next) sendToRef.current(profile, next.text, next.modelOpts, true);
            }
            break;
          }
          // 同步 model/usage（重连后状态对齐）
          const siModel = payload.model as string | undefined;
          const siUsage = payload.usage as Record<string, unknown> | undefined;
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
        // ── 用量汇总（对齐单视图 usage.summary）──
        case 'usage.summary': {
          const us = payload.usage as Record<string, unknown> | undefined;
          if (us) {
            patch(profile, (s) => ({ ...s, lastUsage: { input: (us.input_tokens as number) || 0, output: (us.output_tokens as number) || 0, reasoning: us.reasoning_tokens as number | undefined, total: us.total_tokens as number | undefined } }));
          }
          break;
        }
        default:
          // 🔴 P0-1.4: 带 session_id 的全局事件兜底（后端 build_ws_event 给几乎所有事件注入 session_id，
          // 不能仅凭“有无 session_id”区分全局/局部）—— notification/terminal.read.request/browser.progress 等
          handleGlobalEvent(eventName, payload);
          break;
      }
      } // end if (!processAccumulatorEvent)
    };

    ws.addEventListener(handler);

    // 30fps flush：把累加器同步到状态的 streamText（只更新流式气泡，不动 messages）
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
          if (cur.streamText !== a.text || cur.streamReasoning !== a.reasoning || cur.streamParts !== a.parts) {
            next[p] = { ...cur, streamText: a.text, streamReasoning: a.reasoning, streamParts: a.parts };
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

  return { states, loadLatest, loadMore, sendTo, abortAgent, clearPending, resetAgent, execCommand, handleSlashConfirmDone };
}
