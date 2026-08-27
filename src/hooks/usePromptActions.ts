import { useRef, useCallback, type MutableRefObject } from 'react';
import * as storage from '../utils/storage';
import { persistSessionPointer } from '../utils/session';
import { setMessages as storeSetMessages, getMessages, getIsStreaming } from '../store/messages';
import { useSessionStatus } from '../store/session-status';
import { setMonitor } from '../store/debug';
import { textPart } from '@/lib/chat-messages'
import { getWsClient } from '../services/ws-client';
import { interpretSlashResult, type SlashExecResult } from '@/lib/slash-result';

import type { ChatMessage } from '@/types'
import type { SessionManagerHandle } from './useMessageStream';

// 对齐 Hermes: Hard guard — at most one prompt.submit in flight per session
const _submitInFlight = new Set<string>()
// 🔴 2026-08-17 会话隔离修复（F3）：_submitInFlight 守卫的挂起看门狗——
// prompt.submit RPC 挂起（ws-client 默认 30min 超时）期间，同一会话的后续
// 消息会被守卫静默吞掉（乐观上屏但从未发送 = "说话没反应"的锁滞留变体）。
// 30s 后自动清除 in-flight 标记，后续发送不再被吞（重复发送由后端 busy
// 路由 queue/steer 去重，不产生双轮）。
const _submitInFlightTimers = new Map<string, ReturnType<typeof setTimeout>>()
const SUBMIT_IN_FLIGHT_WATCHDOG_MS = 30_000

function markSubmitInFlight(key: string) {
  _submitInFlight.add(key)
  const t = setTimeout(() => {
    console.warn('[handleSend] submitInFlight watchdog: clearing stale in-flight marker for', key)
    _submitInFlight.delete(key)
    _submitInFlightTimers.delete(key)
  }, SUBMIT_IN_FLIGHT_WATCHDOG_MS)
  _submitInFlightTimers.set(key, t)
}

function clearSubmitInFlight(key: string) {
  _submitInFlight.delete(key)
  const t = _submitInFlightTimers.get(key)
  if (t) {
    clearTimeout(t)
    _submitInFlightTimers.delete(key)
  }
}

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
  /** 🔴 2026-08-13 对齐修复：turn 结束通知（含 abort/失败）——App 消费 busy 期间
   *  点项目记录的 pending 烙印（turn 完成后自动 session.cwd.set 到项目根） */
}): {
  handleSend: (text: string, attachmentDataURLs?: string[]) => void
  handleAbort: () => void
  handleCommand: (cmdName: string, args?: string) => Promise<void>
  isSendingRef: MutableRefObject<boolean>
  drainQueue: () => void
  drainQueueRef: MutableRefObject<(() => void) | null>
  resetSendingLock: () => void
} {
  const isSendingRef = useRef(false);
  const drainQueueRef = useRef<(() => void) | null>(null);
  // 压缩中状态（对齐 Hermes composer compacting：压缩中 busy 输入排队不打断，
  // canSteer=false → busyAction=queue）。store/session-status 是既有权威源，
  // 不新建平行状态。
  const compacting = useSessionStatus(sess.sessionId ?? '').compacting;

  // ── 释放发送锁回调（原 drainQueue，2026-08-16 方案A：localStorage 前端队列退役，
  // 队列显示/续轮由后端 queue.* RPC 权威驱动，前端只剩"轮末释放发送锁"职责；
  // useMessageStream 三处调用点语义不变）──
  const drainQueue = useCallback(() => {
    isSendingRef.current = false;
  }, []);

  drainQueueRef.current = drainQueue;

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
  const handleSend = useCallback(async (text: string, attachmentDataURLs?: string[]) => {
    // 🔴 2026-08-20：纯图片（无文字）放行——attachmentDataURLs 非空即有图
    //（对齐 Hermes 图片独立提交；后端 prompt.submit 对空文本+attached_images 已放行）。
    // 此前 `if (!text.trim()) return` 直接丢弃纯图片消息 → 消息区不显示 + agent 不回复。
    if (!text.trim() && !(attachmentDataURLs && attachmentDataURLs.length > 0)) return;

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

    // 🔴 Phase 2: busy 分支不再是前端截流 —— 附件/纯文本统一直发后端 prompt.submit，
    // 由 route_busy_submit 决定 steer/interrupt/queue（对齐 DSH route_busy_submit
    // 三模式决策树 + use-composer-submit busy 语义）。附件 base64 已由
    // useImageAttachments.addImage 即时 imageAttachBytes 上传后端 session，
    // busy 直发时后端对 media 非空自动 Queue（attached_images 快照接管进 InboxItem）。
    // 🔴 2026-08-16 方案A：localStorage 前端队列退役——排队显示改后端权威
    // Inbox.followup 投影（queue.status 轮询），此处不再 enqueue。
    // 🔴 判定含 store 快照：后端 drain turn（run.started → isStreaming=true）无发送锁，
    // 仅看 isSendingRef 会让附件消息漏走队列（对齐宫格 wasBusy 的 status 判定）
    const wasBusy = isSendingRef.current || getIsStreaming();
    // 直接发送（idle 直发 / busy 直发共用；wasBusy 不加锁——锁归属 live turn，
    // 对齐宫格 sendTo：早释放会打开双提交窗口，早持有会让旧 turn 的 complete 误 drain）
    if (!wasBusy) isSendingRef.current = true;
    storeSetMessages((prev) => [...prev, { id: genId(), role: 'user', parts: [textPart(text)], attachmentRefs: attachmentDataURLs?.length ? attachmentDataURLs : undefined, timestamp: Date.now() } as ChatMessage]);

    const wsClient = getWsClient();
    await wsClient.ensureConnected(10000);

    // 🔴 2026-08-27 同步读（ref 双写）：App 层 sessionCreate 后同事件循环内
    // React state 未刷新，stale null 会导致二次懒创建 → 纯图挂错会话
    // （图片挂 sid1、submit 发 sid2 → attached_images 空 → text is required）
    let sessionId = sess.getSessionId();
    const submitLockKey = sessionId || '__pending_new__';
    if (_submitInFlight.has(submitLockKey)) {
      console.warn('[handleSend] submitInFlight guard: already submitting for', submitLockKey);
      if (!wasBusy) isSendingRef.current = false;
      return;
    }
    markSubmitInFlight(submitLockKey);

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
        clearSubmitInFlight(submitLockKey);
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
    setMonitor((prev) => ({ ...prev, tokensIn: 0, tokensOut: 0 }));
    addDebugEvent('text', `user: ${text.slice(0, 60)}`);

    try {
      await send(text, sessionId, modelOpts);
      // 🔴 2026-08-12 树自动刷新：消息发送后 bump → 项目树静默重拉（预览会话标题/时间/计数回显）
      setSessionListVersion?.((v) => v + 1);
    } finally {
      clearSubmitInFlight(submitLockKey);
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
    // 🔴 2026-08-16 方案A：localStorage 队列退役——不再清前端队列（无条目），
    // 后端 queue.* RPC 是队列唯一权威，轮询自动刷新
  }, []);

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
