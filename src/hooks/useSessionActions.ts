import { useCallback, type MutableRefObject } from 'react';
import { activateSession } from '../utils/api';
import { setMessages as storeSetMessages, getMessages } from '../store/messages';
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
  send,
  setDebugInfo,
  setSessionListVersion,
  lastTimeRef,
  resetSendingLock,
}: {
  sess: SessionManagerHandle
  genId: () => string
  send: (message: string) => void
  setDebugInfo: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  lastTimeRef?: MutableRefObject<string>
  resetSendingLock?: () => void
}): {
  handleSwitchSession: (id: string) => Promise<void>
  handleDeleteSession: (id: string) => Promise<void>
  handleNewSession: () => Promise<void>
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

  // ── new session — 统一走 /new 命令路径（与用户输入 /new 完全一致）
  // 对齐 Hermes：按钮和 /new 走同一后端入口，SSE session_reset 事件触发 UI 更新
  const handleNewSession = useCallback(async () => {
    resetSendingLock?.();
    if (sess.sessionId) {
      sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: getMessages() }));
    }
    // 发送 /new 命令走 chat_stream，后端完整清理 + reset_session + SSE 事件
    // 不再走独立的 api.resetSession() 路径
    send('/new');
  }, [sess, send, resetSendingLock]);

  return {
    handleSwitchSession,
    handleDeleteSession,
    handleNewSession,
  };
}
