import { useRef, useCallback, type MutableRefObject } from 'react';
import { executeCommand, setSessionTitle } from '../utils/api';
import * as storage from '../utils/storage';
import { setMessages as storeSetMessages, getMessages } from '../store/messages';
import { textPart } from '@/lib/chat-messages'
import { getWsClient } from '../services/ws-client';
import type { ChatMessage } from '@/types'
import type { SessionManagerHandle } from './useMessageStream';

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
}: {
  sess: SessionManagerHandle
  addTimeBadge: () => void
  genId: () => string
  setConnectionStatus: React.Dispatch<React.SetStateAction<string>>
  setDebugInfo: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  addDebugEvent: (type: string, detail: string) => void
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  send: (text: string, sessionId?: string | null) => Promise<void>
  abort?: () => Promise<void>
  handleNewSession: (title?: string) => Promise<void>
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

    // ── 懒创建 session — 对齐 Eleve createBackendSessionForSend ──
    // 🔴 修复：drainQueue 也必须 ensureSession，否则 sessionId=null 会导致后端创建新 session
    if (sess.freshDraftReady) {
      await sess.create();
      sess.setFreshDraftReady(false);
      if (sess.pendingTitle && sess.sessionId) {
        try {
          await setSessionTitle(sess.sessionId, sess.pendingTitle);
          sess.setTitle(sess.sessionId, sess.pendingTitle);
        } catch (e) {
          console.warn('[drainQueue] setSessionTitle failed', e);
        }
        sess.setPendingTitle(null);
      }
    } else if (!sess.sessionId) {
      // 🔴 修复：排队消息发送前也必须确保有 sessionId
      await sess.create();
    }

    if (sess.sessionId && !sess.titles[sess.sessionId]) {
      sess.setTitle(sess.sessionId, next.slice(0, 30));
    }

    setConnectionStatus('connected');
    setDebugInfo((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: next.slice(0, 40) }));
    addDebugEvent('text', `user: ${next.slice(0, 60)}`);
    send(next, sess.sessionId as null | undefined);
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

    // ── 懒创建 session — 对齐 Hermes createBackendSessionForSend ──
    // Hermes: if (!sessionId) { sessionId = await createBackendSessionForSend() }
    // 无论 freshDraftReady 还是 sessionId=null，都需要后端 session 才能发消息
    const ensureSession = async (): Promise<string | null> => {
      if (sess.freshDraftReady) {
        await sess.create();
        sess.setFreshDraftReady(false);
        // 对齐 Hermes: /new <title> 时在懒创建后设置标题
        if (sess.pendingTitle && sess.sessionId) {
          try {
            await setSessionTitle(sess.sessionId, sess.pendingTitle);
            sess.setTitle(sess.sessionId, sess.pendingTitle);
          } catch (e) {
            console.warn('[ensureSession] setSessionTitle failed', e);
          }
          sess.setPendingTitle(null);
        }
      } else if (!sess.sessionId) {
        // 对齐 Hermes: 首次安装或无 session 时，发消息前自动创建
        await sess.create();
      }
      return sess.sessionId;
    };

    // ── 1. 先确保 WS 已连接（对齐 Hermes Desktop requestGateway）──
    // Hermes Desktop: requestGateway 自动确保 WS 连上再发 RPC
    // session.create 也需要 WS，所以 WS 必须先连上
    const wsClient = getWsClient();
    if (wsClient.state === 'disconnected') {
      console.log('[handleSend] WS disconnected, triggering reconnect');
      wsClient.connect(undefined);
      await wsClient.waitForConnected(10000);
    } else if (wsClient.state === 'connecting' || wsClient.state === 'reconnecting') {
      await wsClient.waitForConnected(10000);
    }

    // ── 2. WS 连上后再创建/确保 session（对齐 Hermes Desktop）──
    // Hermes Desktop: createBackendSessionForSend 通过 requestGateway('session.create') 创建
    // 此时 WS 已连上，session.create RPC 可以正常发送
    const sessionId = await ensureSession();
    console.log('[handleSend] sessionId after ensureSession:', sessionId, 'freshDraftReady:', sess.freshDraftReady);

    if (sessionId && !sess.titles[sessionId]) {
      sess.setTitle(sessionId, text.slice(0, 30));
    }

    setConnectionStatus('connected');
    setDebugInfo((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: text.slice(0, 40) }));
    addDebugEvent('text', `user: ${text.slice(0, 60)}`);
    send(text, sessionId as null | undefined);
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
