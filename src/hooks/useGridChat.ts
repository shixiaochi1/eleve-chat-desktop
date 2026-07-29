/**
 * useGridChat — 宫格多 Agent 全功能聊天引擎
 *
 * 架构原则（对齐多 Agent 独立性北极星）：
 * - 每个 Agent 一个独立状态槽（messages / streaming / pending 交互），互不干扰
 * - 后端是消息唯一权威源：窗口化加载（最新 N 条 + 上翻加载更早），不全量缓存
 * - WS 单连接解复用：事件按 session_id 前缀路由到对应 Agent 槽
 * - 流式高频 delta 只写 ref 累加器，30fps flush 到状态（不触发消息列表重渲染）
 * - 内存可控：每 Agent 最多 WINDOW_MAX 条，超出从头部 evict（ELEVE 常驻内存安全）
 *
 * 与 useSSE 的关系：宫格模式激活时 useSSE 暂停（由 App 层控制），本 hook 接管所有 WS 事件。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { getWsClient } from '@/services/ws-client';
import { call } from '../utils/bridge';
import { toChatMessages, textPart, type SessionMessage } from '@/lib/chat-messages';
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
  pendingApproval: unknown | null;
  pendingClarify: unknown | null;
  pendingSudo: unknown | null;
  lastActivity: number;
}

function emptyState(): AgentChatState {
  return {
    sessionId: null, messages: [], hasMore: false, oldestId: null,
    isLoadingMore: false, status: 'idle', streamText: '', streamReasoning: '',
    pendingApproval: null, pendingClarify: null, pendingSudo: null, lastActivity: 0,
  };
}

/** session_id → profile 解析（agent:<profile>:...，main 归一为 default） */
function profileFromSessionId(sid: string | undefined | null): string | null {
  if (!sid) return null;
  const parts = sid.split(':');
  if (parts[0] !== 'agent' || parts.length < 2) return null;
  const p = parts[1];
  return p === 'main' ? 'default' : p;
}

let gridMsgSeq = 0;
const gridMsgId = () => `grid-${Date.now()}-${++gridMsgSeq}`;

export function useGridChat(active: boolean): {
  states: Record<string, AgentChatState>;
  loadLatest: (profile: string, sessionId: string) => Promise<void>;
  loadMore: (profile: string) => Promise<void>;
  sendTo: (profile: string, text: string) => Promise<void>;
  abortAgent: (profile: string) => Promise<void>;
  respondApproval: (profile: string, runId: string, choice: string) => Promise<void>;
  respondClarify: (profile: string, clarifyId: string, answer: string) => Promise<void>;
} {
  const [states, setStates] = useState<Record<string, AgentChatState>>({});

  // per-agent 流式累加器（ref，高频写不触发渲染）
  const accRef = useRef<Record<string, { text: string; reasoning: string }>>({});
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statesRef = useRef(states);
  statesRef.current = states;

  // 单 Agent 状态更新（不可变 patch）
  const patch = useCallback((profile: string, updater: (s: AgentChatState) => AgentChatState) => {
    setStates((prev) => ({ ...prev, [profile]: updater(prev[profile] ?? emptyState()) }));
  }, []);

  // ── 加载最新 N 条（进入宫格 / 切到某 Agent 时） ──
  const loadLatest = useCallback(async (profile: string, sessionId: string) => {
    patch(profile, (s) => ({ ...s, sessionId }));
    try {
      const res = await call('session.history', { session_id: sessionId, limit: PAGE_SIZE }) as {
        messages?: SessionMessage[]; has_more?: boolean; oldest_id?: number | null;
      };
      const msgs = toChatMessages((res?.messages ?? []) as SessionMessage[]);
      patch(profile, (s) => ({
        ...s,
        messages: msgs.slice(-WINDOW_MAX),
        hasMore: !!res?.has_more,
        oldestId: res?.oldest_id ?? null,
      }));
    } catch { /* offline：保留现有 */ }
  }, [patch]);

  // ── 上翻加载更早（before_id 游标） ──
  const loadMore = useCallback(async (profile: string) => {
    const s = statesRef.current[profile];
    if (!s?.sessionId || !s.hasMore || s.isLoadingMore || s.oldestId == null) return;
    patch(profile, (st) => ({ ...st, isLoadingMore: true }));
    try {
      const res = await call('session.history', {
        session_id: s.sessionId, limit: PAGE_SIZE, before_id: s.oldestId,
      }) as { messages?: SessionMessage[]; has_more?: boolean; oldest_id?: number | null };
      const older = toChatMessages((res?.messages ?? []) as SessionMessage[]);
      patch(profile, (st) => {
        const merged = [...older, ...st.messages];
        // 内存窗口：超 WINDOW_MAX 从尾部 evict（保留最新）—— 上翻加载的是更早的，插头部
        // 但为内存可控，限制总量；用户继续上翻会再加载
        return {
          ...st,
          messages: merged.slice(-WINDOW_MAX),
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
  const sendTo = useCallback(async (profile: string, text: string) => {
    if (!text.trim()) return;
    const s = statesRef.current[profile];
    const sessionId = s?.sessionId ?? undefined;
    // 乐观追加用户消息
    const userMsg: ChatMessage = {
      id: gridMsgId(), role: 'user', parts: [textPart(text)], timestamp: Date.now(),
    };
    patch(profile, (st) => ({
      ...st,
      messages: [...st.messages, userMsg].slice(-WINDOW_MAX),
      status: 'streaming',
    }));
    accRef.current[profile] = { text: '', reasoning: '' };
    try {
      const ws = getWsClient();
      const result = await ws.sendRpc('prompt.submit', {
        text, profile, session_id: sessionId ?? '',
      }) as { session_id?: string };
      // 后端可能新建 session → 记录 sessionId
      if (result?.session_id && result.session_id !== sessionId) {
        patch(profile, (st) => ({ ...st, sessionId: result.session_id! }));
      }
    } catch (e) {
      patch(profile, (st) => ({ ...st, status: 'idle' }));
      console.error('[useGridChat] sendTo failed:', profile, e);
    }
  }, [patch]);

  // ── 中止某 Agent 的流 ──
  const abortAgent = useCallback(async (profile: string) => {
    const s = statesRef.current[profile];
    if (!s?.sessionId) return;
    try { await getWsClient().abortStream(s.sessionId); } catch { /* ignore */ }
    patch(profile, (st) => ({ ...st, status: 'idle', streamText: '', streamReasoning: '' }));
    accRef.current[profile] = { text: '', reasoning: '' };
  }, [patch]);

  // ── 响应交互弹窗 ──
  const respondApproval = useCallback(async (profile: string, runId: string, choice: string) => {
    try {
      await getWsClient().sendRpc('approval.respond', { run_id: runId, choice, profile });
    } catch { /* ignore */ }
    patch(profile, (st) => ({ ...st, pendingApproval: null, status: 'streaming' }));
  }, [patch]);

  const respondClarify = useCallback(async (profile: string, clarifyId: string, answer: string) => {
    try {
      await getWsClient().sendRpc('clarify.respond', { clarify_id: clarifyId, answer, profile });
    } catch { /* ignore */ }
    patch(profile, (st) => ({ ...st, pendingClarify: null, status: 'streaming' }));
  }, [patch]);

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
      if (!profile) return;   // 无 session_id 的全局事件：宫格不处理

      const acc = (accRef.current[profile] ??= { text: '', reasoning: '' });

      switch (eventName) {
        case 'message.delta':
          acc.text += (payload.delta as string) || '';
          break;
        case 'reasoning.delta':
          acc.reasoning += (payload.text as string) || '';
          break;
        case 'run.started':
        case 'message.start':
          patch(profile, (s) => ({ ...s, status: 'streaming', lastActivity: Date.now() }));
          break;
        case 'message.complete': {
          // 流式完成：累加器转为消息并入列表
          const finalText = acc.text;
          const finalReasoning = acc.reasoning;
          accRef.current[profile] = { text: '', reasoning: '' };
          patch(profile, (s) => {
            const parts = [];
            if (finalReasoning) parts.push({ type: 'reasoning' as const, text: finalReasoning });
            if (finalText) parts.push(textPart(finalText));
            const msgs = parts.length
              ? [...s.messages, { id: gridMsgId(), role: 'assistant' as const, parts, timestamp: Date.now() }]
              : s.messages;
            return { ...s, messages: msgs.slice(-WINDOW_MAX), status: 'idle', streamText: '', streamReasoning: '', lastActivity: Date.now() };
          });
          break;
        }
        case 'approval.request':
          patch(profile, (s) => ({ ...s, pendingApproval: payload, status: 'waiting', lastActivity: Date.now() }));
          break;
        case 'clarify.request':
          patch(profile, (s) => ({ ...s, pendingClarify: payload, status: 'waiting', lastActivity: Date.now() }));
          break;
        case 'sudo.request':
          patch(profile, (s) => ({ ...s, pendingSudo: payload, status: 'waiting', lastActivity: Date.now() }));
          break;
        case 'error':
          patch(profile, (s) => ({ ...s, status: 'idle', streamText: '', streamReasoning: '' }));
          accRef.current[profile] = { text: '', reasoning: '' };
          break;
        default:
          break;
      }
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
          if (cur.streamText !== a.text || cur.streamReasoning !== a.reasoning) {
            next[p] = { ...cur, streamText: a.text, streamReasoning: a.reasoning };
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

  return { states, loadLatest, loadMore, sendTo, abortAgent, respondApproval, respondClarify };
}
