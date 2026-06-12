import { useCallback, type MutableRefObject } from 'react';
import { activateSession } from '../utils/api';
import { setMessages as storeSetMessages, getMessages } from '../store/messages';
import * as storage from '../utils/storage';
import type { SessionManagerHandle } from './useMessageStream';
import { textPart } from '@/lib/chat-messages'
import type { ChatMessage } from '@/types';

/**
 * Helper: short ID display
 */
function shortId(id: string): string {
  return id ? id.slice(0, 8) : '—';
}

/**
 * useSessionActions — session switch/delete/new logic
 *
 * Extracted from App.jsx. Handles session switching (with cache save/restore
 * and backend status check), session deletion, and new session creation.
 *
 * Returns { handleSwitchSession, handleDeleteSession, handleNewSession }
 */
export function useSessionActions({
  sess,
  genId,
  setDebugInfo,
  setSessionListVersion,
  lastTimeRef,
  resetSendingLock,
}: {
  sess: SessionManagerHandle
  genId: () => string
  setDebugInfo: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  lastTimeRef?: MutableRefObject<string>
  resetSendingLock?: () => void
}): {
  handleSwitchSession: (id: string) => Promise<void>
  handleDeleteSession: (id: string) => Promise<void>
  handleNewSession: (title?: string) => Promise<void>
} {
  // ── session switch handler ──
  const handleSwitchSession = useCallback(async (id: string) => {
    if (id === sess.sessionId) return;
    resetSendingLock?.();
    if (sess.sessionId) {
      sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: getMessages() }));
    }
    sess.switchTo(id);
    sess.refresh();
    if (lastTimeRef) lastTimeRef.current = '';
    setDebugInfo((prev) => ({ ...prev, sessionId: id, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));

    try {
      const status = await activateSession(id) as { is_reset?: boolean };
      if (status.is_reset) {
        sess.saveCache((cache) => { const c = { ...cache }; delete c[id]; return c; });
        storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(`会话已重置 (${shortId(id)})，新消息将从空白上下文开始`)] }]);
        return;
      }
    } catch {
      // 后端不可达（离线），fallback 到原有逻辑
    }

    const cached = sess.msgCache[id];
    if (cached?.length) {
      storeSetMessages(cached as ChatMessage[]);
    } else {
      storeSetMessages([]);
      sess.loadHistory(id).then((msgs) => {
        if (msgs?.length) {
          storeSetMessages(msgs as ChatMessage[]);
          sess.saveCache((cache) => ({ ...cache, [id]: msgs }));
        } else {
          storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(`会话已切换 (${shortId(id)})`)] }]);
        }
      });
    }
  }, [sess, genId, setDebugInfo, lastTimeRef, resetSendingLock]);

  // ── session delete handler ──
  const handleDeleteSession = useCallback(async (id: string) => {
    sess.remove(id);
    if (sess.sessionId === id) storeSetMessages([]);
    if (setSessionListVersion) setSessionListVersion(v => v + 1);
  }, [sess, setSessionListVersion]);

  // ── new session — 对齐 Hermes startFreshSessionDraft()
  // 纯前端重置：清消息 + 释放锁 + 设 freshDraftReady
  // 后端 session 懒创建 — 首条消息发送时通过 createSession() 创建
  const handleNewSession = useCallback(async (title?: string) => {
    resetSendingLock?.();
    // 保存当前会话消息到缓存
    if (sess.sessionId) {
      sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: getMessages() }));
    }
    // 清空前端状态（不触发后端请求）
    storeSetMessages([]);
    // 清除 session ID，标记为 fresh draft
    sess.setSessionId(null);
    storage.save('session_id', null);
    sess.setFreshDraftReady(true);
    // 对齐 Hermes: /new <title> 时暂存标题，懒创建后设置
    if (title?.trim()) {
      sess.setPendingTitle(title.trim());
    } else {
      sess.setPendingTitle(null);
    }
    // 刷新会话列表（旧会话仍在列表中）
    sess.refresh();
    setDebugInfo((prev) => ({ ...prev, sessionId: null, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));
    if (setSessionListVersion) setSessionListVersion(v => v + 1);
  }, [sess, setDebugInfo, setSessionListVersion, resetSendingLock]);

  return {
    handleSwitchSession,
    handleDeleteSession,
    handleNewSession,
  };
}
