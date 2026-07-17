import { useRef, useCallback, type MutableRefObject } from 'react';
import { executeCommand } from '../utils/api';
import * as storage from '../utils/storage';
import { setMessages as storeSetMessages, getMessages } from '../store/messages';
import { textPart } from '@/lib/chat-messages'
import { getWsClient } from '../services/ws-client';
import type { ChatMessage } from '@/types'
import type { SessionManagerHandle } from './useMessageStream';

// 对齐 Hermes: Hard guard — at most one prompt.submit in flight per session
// 防止快速双击或 stall turn 导致同一个 session 多个 turn 同时运行
const _submitInFlight = new Set<string>()

/**
 * usePromptActions — send/regenerate/abort/queue logic
 *
 * Extracted from App.jsx. Manages message sending (direct and queued during
 * streaming), command execution (/commands), regenerate, abort, and /btw.
 *
 * Returns { handleSend, handleAbort, handleRegenerate, handleCommand, handleBtw,
 *           pendingQueue, isSendingRef, drainQueue, drainQueueRef }
 */
export function usePromptActions({
  sess,
  addTimeBadge,
  genId,
  setConnectionStatus,
  setDebugInfo,
  addDebugEvent,
  setSessionListVersion,
  send,
  abort,
  handleNewSession,
  currentModel,
  currentProvider,
}: {
  sess: SessionManagerHandle
  addTimeBadge: () => void
  genId: () => string
  setConnectionStatus: React.Dispatch<React.SetStateAction<string>>
  setDebugInfo: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  addDebugEvent: (type: string, detail: string) => void
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  send: (text: string, sessionId?: string | null, modelOpts?: { model?: string; provider?: string; title?: string }) => Promise<void>
  abort?: () => Promise<void>
  handleNewSession: (title?: string) => Promise<void>
  /** 对齐 Hermes: UI 选择的模型，传入 session.create 作为 per-session override */
  currentModel?: string
  currentProvider?: string
}): {
  handleSend: (text: string) => void
  handleAbort: () => void
  handleRegenerate: (agentMsg?: { id?: string }) => void
  handleCommand: (cmdName: string, args?: string) => Promise<void>
  handleBtw: () => void
  pendingQueue: MutableRefObject<string[]>
  isSendingRef: MutableRefObject<boolean>
  drainQueue: () => void
  drainQueueRef: MutableRefObject<(() => void) | null>
  resetSendingLock: () => void
} {
  // ── 消息队列 — 流式期间允许输入并排队 ──
  const pendingQueue = useRef<string[]>([]);
  const isSendingRef = useRef(false);
  const drainQueueRef = useRef<(() => void) | null>(null);

  const drainQueue = useCallback(async () => {
    isSendingRef.current = false;
    const next = pendingQueue.current.shift();
    if (!next) return;
    isSendingRef.current = true;

    // 🔴 守卫：storage 未初始化完成时，不发消息
    if (!storage.isReady()) {
      console.warn('[drainQueue] Storage not ready, waiting...');
      await storage.init();
    }

    addTimeBadge();
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(next)] } as ChatMessage]);

    // 对齐架构原则：后端是 session 生命周期权威源，drainQueue 不预创建 session
    // 直接发 prompt.submit，后端自动处理
    const modelOpts = currentModel ? { model: currentModel, provider: currentProvider } : undefined;

    if (sess.sessionId && !sess.titles[sess.sessionId]) {
      sess.setTitle(sess.sessionId, next.slice(0, 30));
    }

    setConnectionStatus('connected');
    setDebugInfo((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: next.slice(0, 40) }));
    addDebugEvent('text', `user: ${next.slice(0, 60)}`);
    send(next, sess.sessionId as null | undefined, modelOpts);
  }, [sess, addTimeBadge, genId, send, addDebugEvent, setConnectionStatus, setDebugInfo]);

  // keep ref fresh for onDone callback
  drainQueueRef.current = drainQueue;

  // ── slash command handler ──
  const handleCommand = useCallback(async (cmdName: string, args?: string) => {
    const display = args ? `/${cmdName} ${args}` : `/${cmdName}`;
    addTimeBadge();
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(display)] } as ChatMessage]);

    try {
      // 走 WS slash.exec（对齐 Phase 6: 命令走 WS 而非 HTTP）
      const ws = getWsClient();
      const result = await ws.slashExec(`${cmdName} ${args || ''}`.trim(), sess.sessionId || undefined) as { output?: string; session_id?: string };
      const output = result?.output || '';
      const session_id = result?.session_id;
      if (session_id && session_id !== sess.sessionId) {
        if (sess.sessionId) {
          storeSetMessages((prev) => {
            sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: prev }));
            return prev;
          });
        }
        sess.setSessionId(session_id);
        storage.save('session_id', session_id);
        sess.refresh();
        setDebugInfo((prev) => ({ ...prev, sessionId: session_id, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));
        storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(output)] } as ChatMessage]);
        if (setSessionListVersion) setSessionListVersion(v => v + 1);
      } else {
        storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(output)] } as ChatMessage]);
      }
    } catch (err) {
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'assistant', parts: [textPart(`${(err as Error).message}`)], error: `${(err as Error).message}` } as ChatMessage]);
    }
  }, [sess, addTimeBadge, genId, setDebugInfo, setSessionListVersion]);

  // ── send message ──
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return;

    // 🔴 守卫：storage 未初始化完成时，不发消息（避免 sessionId=null 导致创建新 session）
    if (!storage.isReady()) {
      console.warn('[handleSend] Storage not ready, waiting...');
      await storage.init();
    }

    // 拦截以 / 开头的消息 → 走命令路径
    if (text.trimStart().startsWith('/')) {
      const cmdPart = text.trimStart().replace(/^\//, '').split(/\s/)[0].toLowerCase();
      const args = text.trimStart().replace(/^\/\S+\s*/, '').trim();
      // 对齐 Eleve：/new [title] 走前端纯重置（startFreshSessionDraft），不走后端 executeCommand
      if (cmdPart === 'new') {
        handleNewSession(args || undefined);
        return;
      }
      handleCommand(cmdPart, args);
      return;
    }

    // 流式期间 → 排队，结束后自动发送
    if (isSendingRef.current) {
      pendingQueue.current.push(text);
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)] } as ChatMessage]);
      return;
    }

    // 直接发送
    isSendingRef.current = true;
    addTimeBadge();
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)] } as ChatMessage]);

    // ── 确保 WS 已连接 ──
    const wsClient = getWsClient();
    if (wsClient.state === 'disconnected') {
      wsClient.connect(undefined);
      await wsClient.waitForConnected(10000);
    } else if (wsClient.state === 'connecting' || wsClient.state === 'reconnecting') {
      await wsClient.waitForConnected(10000);
    }

    // 对齐架构原则：后端是 session 生命周期的唯一权威源
    // 前端不预创建 session，直接发 prompt.submit
    // 后端自动创建 session + 应用 model/provider override
    // 如果有 pendingTitle（/new <title>），在 session 创建后设置
    const sessionId = sess.sessionId;
    console.log('[handleSend] sessionId:', sessionId, 'freshDraftReady:', sess.freshDraftReady);

    const submitLockKey = sessionId || '__pending_new__';
    if (_submitInFlight.has(submitLockKey)) {
      console.warn('[handleSend] submitInFlight guard: already submitting for', submitLockKey);
      isSendingRef.current = false;
      return;
    }
    _submitInFlight.add(submitLockKey);

    if (sessionId && !sess.titles[sessionId]) {
      sess.setTitle(sessionId, text.slice(0, 30));
    }

    // 对齐架构原则：model/provider 直接传 prompt.submit，后端应用
    // 对齐 Hermes pending_title: title 传给后端，后端在 message.complete 后应用到 DB
    const modelOpts: { model?: string; provider?: string; title?: string } = {};
    if (currentModel) {
      modelOpts.model = currentModel;
      modelOpts.provider = currentProvider;
    }
    // 首次消息且有 pendingTitle 时，传给后端
    if (sess.pendingTitle) {
      modelOpts.title = sess.pendingTitle;
    }

    setConnectionStatus('connected');
    setDebugInfo((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: text.slice(0, 40) }));
    addDebugEvent('text', `user: ${text.slice(0, 60)}`);

    try {
      await send(text, sessionId as null | undefined, modelOpts);
    } finally {
      _submitInFlight.delete(submitLockKey);
    }

    // 对齐 Hermes pending_title: 后端在 message.complete 后应用 title 并推 session.title 事件
    // 前端只需清除 pendingTitle 状态（后端负责持久化 + 事件推送）
    // 前端监听 session.title 事件更新 titles map（useMessageStream 已有处理）
    if (sess.pendingTitle) {
      sess.setPendingTitle(null);
    }
    if (sess.freshDraftReady) {
      sess.setFreshDraftReady(false);
    }
  }, [sess, addTimeBadge, genId, send, addDebugEvent, handleCommand, handleNewSession, setConnectionStatus, setDebugInfo]);

  // ── abort streaming ──
  const handleAbort = useCallback(() => {
    abort?.();
  }, [abort]);

  // ── regenerate ──
  const handleRegenerate = useCallback((agentMsg?: { id?: string }) => {
    if (!agentMsg?.id) return;
    const msgs = getMessages();
    const idx = msgs.findIndex((m) => m.id === agentMsg.id);
    if (idx < 1) return;
    const prev = msgs[idx - 1];
    if (prev.role === 'user') {
      const prevText = prev.parts.filter(p => p.type === 'text').map(p => p.text).join('');
      handleSend(prevText || "");
    }
  }, [handleSend]);

  // ── /btw — 临时提问 ──
  const handleBtw = useCallback(() => {
    const question = window.prompt('临时提问（不污染上下文，不使用工具）:');
    if (!question?.trim()) return;
    handleCommand('btw', question.trim());
  }, [handleCommand]);

  // ── 重置发送锁 ──
  const resetSendingLock = useCallback(() => {
    isSendingRef.current = false;
    pendingQueue.current = [];
  }, []);

  return {
    handleSend,
    handleAbort,
    handleRegenerate,
    handleCommand,
    handleBtw,
    pendingQueue,
    isSendingRef,
    drainQueue,
    drainQueueRef,
    resetSendingLock,
  };
}
