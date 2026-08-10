import { useRef, useCallback, type MutableRefObject } from 'react';
import * as storage from '../utils/storage';
import { persistSessionPointer } from '../utils/session';
import { setMessages as storeSetMessages, getMessages, getIsStreaming } from '../store/messages';
import { useSessionStatus } from '../store/session-status';
import { setMonitor } from '../store/debug';
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
  addDebugEvent,
  setSessionListVersion,
  send,
  abort,
  handleNewSession,
  currentProfile,
  onSlashConfirm,
  getNewSessionCwd,
}: {
  sess: SessionManagerHandle
  genId: () => string
  setConnectionStatus: React.Dispatch<React.SetStateAction<string>>
  addDebugEvent: (type: string, detail: string) => void
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  send: (text: string, sessionId?: string | null, modelOpts?: { model?: string; provider?: string; title?: string; queued?: boolean }) => Promise<void>
  abort?: () => Promise<void>
  handleNewSession: (title?: string) => Promise<void>
  // 🔴 M-1/M-2 修复：发送链不再携带全局 model/provider ——
  // 模型由后端 per-profile 权威管理（config.model_ref 热更新 + provider.switch override），
  // 前端传全局 model 会串台（宫格共用/跨 profile 残留）。
  currentProfile: string
  onSlashConfirm?: (data: { confirmId: string; command: string; description: string }) => void
  /** 🔴 2026-08-09 新会话 cwd（对齐 Hermes createBackendSessionForSend 的
   *  workspaceTarget/currentCwd 链）：无会话发送首条消息时决定新建会话的工作目录——
   *  项目 scope（进入项目后新聊天落项目）→ remote 记忆；null/空 → 不传 cwd */
  getNewSessionCwd?: () => string | null
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
  // 压缩中状态（对齐 Hermes composer compacting：压缩中 busy 输入排队不打断，
  // canSteer=false → busyAction=queue）。store/session-status 是既有权威源，
  // 不新建平行状态。
  const compacting = useSessionStatus(sess.sessionId ?? '').compacting;

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

    const modelOpts = entry.modelOpts; // M-1/M-2: 不再注入全局 model

    if (sess.sessionId && !sess.titles[sess.sessionId]) {
      sess.setTitle(sess.sessionId, entry.text.slice(0, 30));
    }

    setConnectionStatus('connected');
    setMonitor((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: entry.text.slice(0, 40) }));
    addDebugEvent('text', `user: ${entry.text.slice(0, 60)}`);
    try {
      // 🔴 Phase 2: drain 续发带 queued:true（红线 3 — Hermes server.py:7258：
      // drain 消息强制 queue，绝不劫持/打断 live turn）
      await send(entry.text, sess.sessionId as null | undefined, { ...modelOpts, queued: true });
      clearDrainFailures(entry.id); // 成功重置
    } catch {
      incrementDrainFailures(entry.id);
      isSendingRef.current = false;
    }
  }, [sess, send, addDebugEvent, setConnectionStatus, currentProfile]);

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
    const modelOpts = entry.modelOpts; // M-1/M-2: 不再注入全局 model

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
        // 🔴 Phase 2: 排队条目立即发送同样带 queued:true（红线 3）
        await send(entry.text, sess.sessionId as null | undefined, { ...modelOpts, queued: true });
      } catch {
        isSendingRef.current = false;
      }
    };
    void attachAndSend();
  }, [currentProfile, abort, send, sess, setConnectionStatus, addDebugEvent]);

  // ── deleteQueueEntry ──
  const deleteQueueEntry = useCallback((id: string) => {
    removeEntry(currentProfile, id);
    clearDrainFailures(id);
  }, [currentProfile]);

  // ── slash command handler ──
  // 🔴 对齐 Hermes slashStatusText：system 消息用 `slash:/cmd\noutput` 格式，
  // SystemMessage 组件据此渲染 mono 命令 + 输出（单行居中/多行左对齐）
  const slashStatusText = (command: string, output: string) =>
    [`slash:/${command.replace(/^\//, '')}`, output.trim()].filter(Boolean).join('\n');

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
            storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(slashStatusText(cmdName, action.output!))] } as ChatMessage]);
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
          setMonitor((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));
          storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(slashStatusText(cmdName, action.output))] } as ChatMessage]);
          if (setSessionListVersion) setSessionListVersion(v => v + 1);
          return;
        case 'output':
          storeSetMessages((prev) => [...prev, { id: genId(), role: 'system', parts: [textPart(slashStatusText(cmdName, action.output))] } as ChatMessage]);
          return;
      }
    } catch (err) {
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'assistant', parts: [textPart(`${(err as Error).message}`)], error: `${(err as Error).message}`, timestamp: Date.now() } as ChatMessage]);
    }
  }, [sess, genId, setSessionListVersion, onSlashConfirm, send, isSendingRef]);

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

    // 🔴 Phase 2: busy 分支不再是前端截流 —— 带附件才走前端队列（附件 base64 仅存
    // 本地内存，物理上必须先上传后端）；纯文本直发后端 prompt.submit，由
    // route_busy_submit 决定 steer/interrupt/queue（对齐宫格 useGridChat sendTo
    // wasBusy 语义 + Hermes use-composer-submit busy 决策树）
    // 🔴 判定含 store 快照：后端 drain turn（run.started → isStreaming=true）无发送锁，
    // 仅看 isSendingRef 会让附件消息漏走队列（对齐宫格 wasBusy 的 status 判定）
    const wasBusy = isSendingRef.current || getIsStreaming();
    if (wasBusy && attachments?.length) {
      // 🔴 M-1/M-2 修复：排队消息不带 model（drain 时后端用该 profile session 当前 client）
      const modelOpts = undefined;
      const entry = enqueue(currentProfile, { text, modelOpts, attachments });
      // 附件 base64 暂存内存（drain 时取出附着后端）
      if (attachmentDataURLs?.length) {
        stashAttachmentData(entry.id, attachmentDataURLs);
      }
      // 乐观上屏（对齐 Hermes：排队时已显示用户消息；图片附件以 data URL 形式
      // 挂 attachmentRefs，MessageRow 渲染缩略图）
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], attachmentRefs: attachmentDataURLs?.length ? attachmentDataURLs : undefined, timestamp: Date.now() } as ChatMessage]);
      return;
    }
    // 压缩中 busy 纯文本也排队（对齐 Hermes use-composer-submit：busy && compacting
    // → queue，不 steer/interrupt 打断压缩）；非压缩中 busy 纯文本直发后端由
    // route_busy_submit 三模式决策
    if (wasBusy && compacting) {
      // 🔴 M-1/M-2 修复：排队消息不带 model（后端用该 profile session 当前 client）
      const modelOpts = undefined;
      const entry = enqueue(currentProfile, { text, modelOpts });
      if (attachmentDataURLs?.length) {
        stashAttachmentData(entry.id, attachmentDataURLs);
      }
      storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], timestamp: Date.now() } as ChatMessage]);
      return;
    }
    // busy 纯文本 → fall through 直发（乐观上屏由下方统一路径负责）

    // 直接发送（idle 直发 / busy 直发共用；wasBusy 不加锁——锁归属 live turn，
    // 对齐宫格 sendTo：早释放会打开双提交窗口，早持有会让旧 turn 的 complete 误 drain）
    if (!wasBusy) isSendingRef.current = true;
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], attachmentRefs: attachmentDataURLs?.length ? attachmentDataURLs : undefined, timestamp: Date.now() } as ChatMessage]);

    const wsClient = getWsClient();
    await wsClient.ensureConnected(10000);

    let sessionId = sess.sessionId;
    const submitLockKey = sessionId || '__pending_new__';
    if (_submitInFlight.has(submitLockKey)) {
      console.warn('[handleSend] submitInFlight guard: already submitting for', submitLockKey);
      if (!wasBusy) isSendingRef.current = false;
      return;
    }
    _submitInFlight.add(submitLockKey);

    // 🔴 2026-08-09 对齐 Hermes createBackendSessionForSend：无会话发送首条消息前
    // 先 session.create（带 cwd），再 submit——后端 prompt.submit 自动创建的会话
    // 不收 cwd 参数，纯文本首条消息会落后端 resolve 链（DB 无烙印 → 启动目录）=
    // 进入项目后主区新聊天落点错误（跳 home 同族）。cwd 链（Hermes 同款）：
    //   项目 scope（进入项目钻取时设置）→ remote 记忆 → 不传（后端链）
    if (!sessionId) {
      const cwd = getNewSessionCwd?.()?.trim() || '';
      const ws = getWsClient();
      try {
        const created = await ws.sessionCreate({
          profile: currentProfile,
          ...(cwd ? { cwd } : {}),
        });
        sess.setSessionId(created.session_id);
        // 🔴 2026-08-11 修复：sessionCreate 分支缺 persistSessionPointer →
        // 指针永远不落盘（onSessionCreated 因 id 相等不触发）→ 重启/HMR 后
        // sessionId 恢复 null → 每轮新建会话 + 调试面板会话 ID 显示 —
        persistSessionPointer(created.session_id);
        ws.switchSession(created.session_id);
        sessionId = created.session_id;
      } catch (err) {
        // 对齐 Hermes: 建会话失败 → 中止发送
        console.error('[handleSend] sessionCreate failed, aborting send:', err);
        _submitInFlight.delete(submitLockKey);
        if (!wasBusy) isSendingRef.current = false;
        return;
      }
    }

    if (sessionId && !sess.titles[sessionId]) {
      sess.setTitle(sessionId, text.slice(0, 30));
    }

    const modelOpts: { model?: string; provider?: string; title?: string; queued?: boolean } = {};
    // 🔴 M-1/M-2 修复：不再注入 currentModel —— 发送不带 model，
    // 后端用该 profile session 当前 client（config 热更新 + provider.switch override 已就位）
    if (sess.pendingTitle) {
      modelOpts.title = sess.pendingTitle;
    }
    // 🔴 注意：busy 直发【不带 queued】——queued=true 仅属于 drain 续发消息（红线 3），
    // 新消息必须走 route_busy_submit 三模式路由，带 queued 会把 steer/interrupt 强制降级

    setConnectionStatus('connected');
    setMonitor((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0, lastSent: text.slice(0, 40) }));
    addDebugEvent('text', `user: ${text.slice(0, 60)}`);

    try {
      await send(text, sessionId, modelOpts);
    } finally {
      _submitInFlight.delete(submitLockKey);
    }

    if (sess.pendingTitle) {
      sess.setPendingTitle(null);
    }
    if (sess.freshDraftReady) {
      sess.setFreshDraftReady(false);
    }
  }, [sess, genId, send, addDebugEvent, handleCommand, handleNewSession, setConnectionStatus, currentProfile, getNewSessionCwd]);

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
