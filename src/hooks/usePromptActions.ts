import { useRef, useCallback, type MutableRefObject } from 'react';
import * as storage from '../utils/storage';
import { persistSessionPointer } from '../utils/session';
import { setMessages as storeSetMessages, getMessages } from '../store/messages';
import { textPart } from '@/lib/chat-messages'
import { getWsClient } from '../services/ws-client';
import { interpretSlashResult, type SlashExecResult } from '@/lib/slash-result';
import { enqueue, dequeue, clearQueue, getQueueLength, MAX_DRAIN_ATTEMPTS } from '@/lib/message-queue';
import type { ChatMessage } from '@/types'
import type { SessionManagerHandle } from './useMessageStream';

// 对齐 Hermes: Hard guard — at most one prompt.submit in flight per session
// 防止快速双击或 stall turn 导致同一个 session 多个 turn 同时运行
const _submitInFlight = new Set<string>()

/**
 * usePromptActions — send/abort/queue logic
 *
 * Extracted from App.jsx. Manages message sending (direct and queued during
 * streaming), command execution (/commands), and abort.
 *
 * Returns { handleSend, handleAbort, handleCommand,
 *           pendingQueue, isSendingRef, drainQueue, drainQueueRef }
 */
export function usePromptActions({
  sess,
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
  currentProfile,
  onSlashConfirm,
}: {
  sess: SessionManagerHandle
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
  /** 当前活跃 profile（队列键控） */
  currentProfile: string
  /** 破坏性斜杠命令确认回调（D1 slash_confirm GUI） */
  onSlashConfirm?: (data: { confirmId: string; command: string; description: string }) => void
}): {
  handleSend: (text: string) => void
  handleAbort: () => void
  handleCommand: (cmdName: string, args?: string) => Promise<void>
  isSendingRef: MutableRefObject<boolean>
  drainQueue: () => void
  drainQueueRef: MutableRefObject<(() => void) | null>
  resetSendingLock: () => void
} {
  // ── 消息队列 — 流式期间允许输入并排队（对齐 Hermes composer-queue: localStorage 持久化） ──
  const isSendingRef = useRef(false);
  const drainQueueRef = useRef<(() => void) | null>(null);
  // 🔴 对齐 Hermes MAX_AUTO_DRAIN_ATTEMPTS: 连续失败计数，超限停止自动出队
  const drainAttemptsRef = useRef(0);

  const drainQueue = useCallback(async () => {
    isSendingRef.current = false;
    // 🔴 对齐 Hermes MAX_AUTO_DRAIN_ATTEMPTS: 连续失败超限停止自动出队，条目留队等手动
    if (drainAttemptsRef.current >= MAX_DRAIN_ATTEMPTS) {
      if (getQueueLength(currentProfile) > 0) {
        console.warn(`[drainQueue] ${MAX_DRAIN_ATTEMPTS} consecutive failures, pausing auto-drain for ${currentProfile}`);
        import('../utils/notifications').then(({ notifyError }) => {
          notifyError(`排队消息发送连续失败 ${MAX_DRAIN_ATTEMPTS} 次，已暂停自动发送`, '队列暂停');
        });
      }
      return;
    }
    const entry = dequeue(currentProfile);
    if (!entry) { drainAttemptsRef.current = 0; return; }
    isSendingRef.current = true;

    // 🔴 守卫：storage 未初始化完成时，不发消息
    if (!storage.isReady()) {
      console.warn('[drainQueue] Storage not ready, waiting...');
      await storage.init();
    }

    // 🔴 P1-2.6: drain 不再追加用户消息（排队时已上屏，再追加 = 重复显示）
    const modelOpts = entry.modelOpts ?? (currentModel ? { model: currentModel, provider: currentProvider } : undefined);

    if (sess.sessionId && !sess.titles[sess.sessionId]) {
      sess.setTitle(sess.sessionId, entry.text.slice(0, 30));
    }

    setConnectionStatus('connected');
    setDebugInfo((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: entry.text.slice(0, 40) }));
    addDebugEvent('text', `user: ${entry.text.slice(0, 60)}`);
    try {
      await send(entry.text, sess.sessionId as null | undefined, modelOpts);
      drainAttemptsRef.current = 0; // 成功重置计数
    } catch {
      drainAttemptsRef.current++;
      isSendingRef.current = false;
    }
  }, [sess, send, addDebugEvent, setConnectionStatus, setDebugInfo, currentModel, currentProvider, currentProfile]);

  // keep ref fresh for onDone callback
  drainQueueRef.current = drainQueue;

  // ── slash command handler ──
  const handleCommand = useCallback(async (cmdName: string, args?: string) => {
    const display = args ? `/${cmdName} ${args}` : `/${cmdName}`;
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(display)], timestamp: Date.now() } as ChatMessage]);

    try {
      const ws = getWsClient();
      const result = await ws.slashExec(`${cmdName} ${args || ''}`.trim(), sess.sessionId || undefined) as SlashExecResult;
      const action = interpretSlashResult(result, sess.sessionId);

      switch (action.kind) {
        case 'confirm':
          onSlashConfirm?.({ confirmId: action.confirmId, command: action.command || cmdName, description: action.description });
          return;
        case 'send': {
          if (action.output) {
            storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(action.output!)] } as ChatMessage]);
          }
          storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(action.kickoff)] } as ChatMessage]);
          isSendingRef.current = true;
          // 🔴 P1-9: 不用 finally 释锁（send 在 prompt.submit 响应即 resolve，流还在跑 → 锁提前释放 → 并发 turn 交错）
          // 锁生命周期交给 onDone/drainQueue（对齐常规 handleSend 路径）；仅 send 本身 reject 时释锁
          try { await send(action.kickoff, sess.sessionId || undefined); }
          catch (e) { isSendingRef.current = false; throw e; }
          return;
        }
        case 'rotate':
          if (sess.sessionId) {
            storeSetMessages((prev) => { sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: prev })); return prev; });
          }
          sess.setSessionId(action.newSessionId);
          persistSessionPointer(action.newSessionId);
          sess.refresh();
          setDebugInfo((prev) => ({ ...prev, sessionId: action.newSessionId, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));
          storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(action.output)] } as ChatMessage]);
          if (setSessionListVersion) setSessionListVersion(v => v + 1);
          return;
        case 'output':
          storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(action.output)] } as ChatMessage]);
          return;
      }
    } catch (err) {
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'assistant', parts: [textPart(`${(err as Error).message}`)], error: `${(err as Error).message}`, timestamp: Date.now() } as ChatMessage]);
    }
  }, [sess, genId, setDebugInfo, setSessionListVersion, onSlashConfirm, send, isSendingRef]);

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
      // 🔴 Fix BUG#2: /reset 是 /new 的别名，必须一起拦截走前端重置
      // 不拦截 → 走 WS slash.exec → 后端返回前端不识别的格式
      if (cmdPart === 'new' || cmdPart === 'reset') {
        handleNewSession(args || undefined);
        return;
      }
      handleCommand(cmdPart, args);
      return;
    }

    // 流式期间 → 排队（持久化，对齐 Hermes composer-queue），结束后自动发送
    if (isSendingRef.current) {
      const modelOpts = currentModel ? { model: currentModel, provider: currentProvider } : undefined;
      enqueue(currentProfile, { text, modelOpts });
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], timestamp: Date.now() } as ChatMessage]);
      return;
    }

    // 直接发送
    isSendingRef.current = true;
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], timestamp: Date.now() } as ChatMessage]);

    // ── 确保 WS 已连接（3.1: 统一入口，消灭 3 份重复）──
    const wsClient = getWsClient();
    await wsClient.ensureConnected(10000);

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
  }, [sess, genId, send, addDebugEvent, handleCommand, handleNewSession, setConnectionStatus, setDebugInfo]);

  // ── abort streaming ──
  const handleAbort = useCallback(() => {
    abort?.();
  }, [abort]);

  // ── 重置发送锁 ──
  const resetSendingLock = useCallback(() => {
    isSendingRef.current = false;
    drainAttemptsRef.current = 0;
    clearQueue(currentProfile);
  }, [currentProfile]);

  return {
    handleSend,
    handleAbort,
    handleCommand,
    isSendingRef,
    drainQueue,
    drainQueueRef,
    resetSendingLock,
  };
}
