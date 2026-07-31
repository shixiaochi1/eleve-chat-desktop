import { useRef, useCallback, type MutableRefObject } from 'react';
import * as storage from '../utils/storage';
import { persistSessionPointer } from '../utils/session';
import { setMessages as storeSetMessages, getMessages } from '../store/messages';
import { textPart } from '@/lib/chat-messages'
import { getWsClient } from '../services/ws-client';
import { interpretSlashResult, type SlashExecResult } from '@/lib/slash-result';
import {
  enqueue, dequeue, clearQueue, getQueueLength, getQueue, removeEntry, promoteEntry,
  MAX_DRAIN_ATTEMPTS, getDrainFailures, incrementDrainFailures, clearDrainFailures,
  resetAllDrainFailures, stashAttachmentData, takeAttachmentData,
  type QueuedAttachment,
} from '@/lib/message-queue';
import type { ChatMessage } from '@/types'
import type { SessionManagerHandle } from './useMessageStream';

// 对齐 Hermes: Hard guard — at most one prompt.submit in flight per session
const _submitInFlight = new Set<string>()

/**
 * usePromptActions — send/abort/queue logic
 *
 * 对齐 Hermes use-composer-queue.ts：
 * - per-entry 失败计数（替代旧全局计数，一条卡住不拖死全队列）
 * - sendQueueNow（busy→promote+abort / idle→立即发）
 * - 附件排队（entry 级元数据 + 内存 base64 + drain 时附着）
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
  currentModel?: string
  currentProvider?: string
  currentProfile: string
  onSlashConfirm?: (data: { confirmId: string; command: string; description: string }) => void
}): {
  handleSend: (text: string, attachments?: QueuedAttachment[], attachmentDataURLs?: string[]) => void
  handleAbort: () => void
  handleCommand: (cmdName: string, args?: string) => Promise<void>
  isSendingRef: MutableRefObject<boolean>
  drainQueue: () => void
  drainQueueRef: MutableRefObject<(() => void) | null>
  resetSendingLock: () => void
  /** 对齐 Hermes sendQueuedNow：busy→promote+abort / idle→立即发 */
  sendQueueNow: (id: string) => void
  /** 删除排队条目 */
  deleteQueueEntry: (id: string) => void
} {
  const isSendingRef = useRef(false);
  const drainQueueRef = useRef<(() => void) | null>(null);

  // ── drain：per-entry 失败计数 + 附件附着（对齐 Hermes runDrain + autoDrainNext）──
  const drainQueue = useCallback(async () => {
    isSendingRef.current = false;

    const queue = getQueueLength(currentProfile);
    if (queue === 0) return;

    // 取队首
    const entry = dequeue(currentProfile);
    if (!entry) return;

    // 🔴 per-entry 失败计数（对齐 Hermes drainFailuresRef Map）：一条卡住不拖死全队列
    if (getDrainFailures(entry.id) >= MAX_DRAIN_ATTEMPTS) {
      console.warn(`[drainQueue] entry ${entry.id} exceeded ${MAX_DRAIN_ATTEMPTS} failures, skipping`);
      import('../utils/notifications').then(({ notifyError }) => {
        notifyError(`排队消息连续失败 ${MAX_DRAIN_ATTEMPTS} 次，已跳过（可手动重试）`, '队列暂停');
      });
      return;
    }

    isSendingRef.current = true;

    if (!storage.isReady()) {
      console.warn('[drainQueue] Storage not ready, waiting...');
      await storage.init();
    }

    // 🔴 附件附着（对齐 Hermes entry 级归属：drain 时 attachImage → 立即 submit）
    const dataURLs = takeAttachmentData(entry.id);
    if (entry.attachments.length > 0 && dataURLs && dataURLs.length > 0) {
      try {
        const ws = getWsClient();
        for (const dataURL of dataURLs) {
          // 从 data URL 提取 base64（对齐 utils/file.ts base64FromDataURL）
          const base64 = dataURL.includes(',') ? dataURL.split(',')[1]! : dataURL;
          await ws.imageAttachBytes(base64, undefined, sess.sessionId ?? undefined);
        }
      } catch (e) {
        console.warn('[drainQueue] attachment re-attach failed, sending text-only:', e);
        import('../utils/notifications').then(({ notifyWarning }) => {
          notifyWarning('附件重新附着失败，已降级为纯文本发送', '附件失效');
        });
      }
    } else if (entry.attachments.length > 0 && !dataURLs) {
      // 刷新后内存丢失 → 诚实降级（对齐方案：降纯文本 + toast）
      console.warn('[drainQueue] attachment data lost (page refresh?), sending text-only');
      import('../utils/notifications').then(({ notifyWarning }) => {
        notifyWarning('页面刷新后附件数据已失效，已降级为纯文本发送', '附件失效');
      });
    }

    const modelOpts = entry.modelOpts ?? (currentModel ? { model: currentModel, provider: currentProvider } : undefined);

    if (sess.sessionId && !sess.titles[sess.sessionId]) {
      sess.setTitle(sess.sessionId, entry.text.slice(0, 30));
    }

    setConnectionStatus('connected');
    setDebugInfo((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: entry.text.slice(0, 40) }));
    addDebugEvent('text', `user: ${entry.text.slice(0, 60)}`);
    try {
      await send(entry.text, sess.sessionId as null | undefined, modelOpts);
      clearDrainFailures(entry.id); // 成功重置
    } catch {
      incrementDrainFailures(entry.id);
      isSendingRef.current = false;
    }
  }, [sess, send, addDebugEvent, setConnectionStatus, setDebugInfo, currentModel, currentProvider, currentProfile]);

  drainQueueRef.current = drainQueue;

  // ── sendQueueNow（对齐 Hermes sendQueuedNow）──
  const sendQueueNow = useCallback((id: string) => {
    if (isSendingRef.current) {
      // busy：置首 + abort → 轮末 auto-drain 发出（对齐 Hermes promote + onCancel）
      promoteEntry(currentProfile, id);
      clearDrainFailures(id); // 手动发送清除失败计数
      abort?.();
      return;
    }
    // idle：立即发送（对齐 Hermes runDrain byId）
    clearDrainFailures(id);
    const queue = getQueueLength(currentProfile);
    if (queue === 0) return;
    // 找到目标条目并移除，然后发送
    const entries = getQueue(currentProfile);
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    removeEntry(currentProfile, id);
    // 走 drain 路径发送（复用附件附着 + 锁管理）
    isSendingRef.current = true;
    const modelOpts = entry.modelOpts ?? (currentModel ? { model: currentModel, provider: currentProvider } : undefined);

    // 附件附着
    const dataURLs = takeAttachmentData(entry.id);
    const attachAndSend = async () => {
      if (entry.attachments.length > 0 && dataURLs?.length) {
        try {
          const ws = getWsClient();
          for (const dataURL of dataURLs) {
            const base64 = dataURL.includes(',') ? dataURL.split(',')[1]! : dataURL;
            await ws.imageAttachBytes(base64, undefined, sess.sessionId ?? undefined);
          }
        } catch { /* 降级纯文本 */ }
      }
      setConnectionStatus('connected');
      addDebugEvent('text', `user (queue-now): ${entry.text.slice(0, 60)}`);
      try {
        await send(entry.text, sess.sessionId as null | undefined, modelOpts);
      } catch {
        isSendingRef.current = false;
      }
    };
    void attachAndSend();
  }, [currentProfile, currentModel, currentProvider, abort, send, sess, setConnectionStatus, addDebugEvent]);

  // ── deleteQueueEntry ──
  const deleteQueueEntry = useCallback((id: string) => {
    removeEntry(currentProfile, id);
    clearDrainFailures(id);
  }, [currentProfile]);

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
  const handleSend = useCallback(async (text: string, attachments?: QueuedAttachment[], attachmentDataURLs?: string[]) => {
    if (!text.trim()) return;

    if (!storage.isReady()) {
      console.warn('[handleSend] Storage not ready, waiting...');
      await storage.init();
    }

    // 拦截 / 命令
    if (text.trimStart().startsWith('/')) {
      const cmdPart = text.trimStart().replace(/^\//, '').split(/\s/)[0].toLowerCase();
      const args = text.trimStart().replace(/^\/\S+\s*/, '').trim();
      if (cmdPart === 'new' || cmdPart === 'reset') {
        handleNewSession(args || undefined);
        return;
      }
      handleCommand(cmdPart, args);
      return;
    }

    // 🔴 流式期间 → 排队（对齐 Hermes enqueueQueuedPrompt + 附件暂存）
    if (isSendingRef.current) {
      const modelOpts = currentModel ? { model: currentModel, provider: currentProvider } : undefined;
      const entry = enqueue(currentProfile, { text, modelOpts, attachments });
      // 附件 base64 暂存内存（drain 时取出附着后端）
      if (attachmentDataURLs?.length) {
        stashAttachmentData(entry.id, attachmentDataURLs);
      }
      // 乐观上屏（对齐 Hermes：排队时已显示用户消息）
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], timestamp: Date.now() } as ChatMessage]);
      return;
    }

    // 直接发送
    isSendingRef.current = true;
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], timestamp: Date.now() } as ChatMessage]);

    const wsClient = getWsClient();
    await wsClient.ensureConnected(10000);

    const sessionId = sess.sessionId;
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

    const modelOpts: { model?: string; provider?: string; title?: string } = {};
    if (currentModel) {
      modelOpts.model = currentModel;
      modelOpts.provider = currentProvider;
    }
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

    if (sess.pendingTitle) {
      sess.setPendingTitle(null);
    }
    if (sess.freshDraftReady) {
      sess.setFreshDraftReady(false);
    }
  }, [sess, genId, send, addDebugEvent, handleCommand, handleNewSession, setConnectionStatus, setDebugInfo, currentModel, currentProvider, currentProfile]);

  // ── abort ──
  const handleAbort = useCallback(() => {
    abort?.();
  }, [abort]);

  // ── 重置发送锁 ──
  const resetSendingLock = useCallback(() => {
    isSendingRef.current = false;
    resetAllDrainFailures();
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
    sendQueueNow,
    deleteQueueEntry,
  };
}
