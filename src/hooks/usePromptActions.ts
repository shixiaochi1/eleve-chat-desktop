import { useRef, useCallback, type MutableRefObject } from 'react';
import { executeCommand } from '../utils/api';
import * as storage from '../utils/storage';
import { setMessages as storeSetMessages, getMessages } from '../store/messages';
import { textPart } from '@/lib/chat-messages'
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

  const drainQueue = useCallback(() => {
    isSendingRef.current = false;
    const next = pendingQueue.current.shift();
    if (!next) return;
    isSendingRef.current = true;

    addTimeBadge();
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(next)] } as ChatMessage]);

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
      const data = await executeCommand(cmdName, args, sess.sessionId as null | undefined) as { result?: string; session_id?: string };
      const session_id = data?.session_id;
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
        storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(data?.result || '')] } as ChatMessage]);
        if (setSessionListVersion) setSessionListVersion(v => v + 1);
      } else {
        storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(data?.result || '')] } as ChatMessage]);
      }
    } catch (err) {
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'assistant', parts: [textPart(`${(err as Error).message}`)], error: `${(err as Error).message}` } as ChatMessage]);
    }
  }, [sess, addTimeBadge, genId, setDebugInfo, setSessionListVersion]);

  // ── send message ──
  const handleSend = useCallback((text: string) => {
    if (!text.trim()) return;

    // 拦截以 / 开头的消息 → 走命令路径
    if (text.trimStart().startsWith('/')) {
      const cmdPart = text.trimStart().replace(/^\//, '').split(/\s/)[0].toLowerCase();
      const args = text.trimStart().replace(/^\/\S+\s*/, '').trim();
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

    if (sess.sessionId && !sess.titles[sess.sessionId]) {
      sess.setTitle(sess.sessionId, text.slice(0, 30));
    }

    setConnectionStatus('connected');
    setDebugInfo((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: text.slice(0, 40) }));
    addDebugEvent('text', `user: ${text.slice(0, 60)}`);
    send(text, sess.sessionId as null | undefined);
  }, [sess, addTimeBadge, genId, send, addDebugEvent, handleCommand, setConnectionStatus, setDebugInfo]);

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
