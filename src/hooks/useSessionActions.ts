import { useCallback, type MutableRefObject } from 'react';
import { activateSession } from '../utils/api';
import { setMessages as storeSetMessages } from '../store/messages';
import * as storage from '../utils/storage';
import { getWsClient } from '../services/ws-client';
import { clearSessionPointer, profileFromSessionId } from '../utils/session';
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
  resetSendingLock,
  resetStream,
  currentSessionIdRef,
}: {
  sess: SessionManagerHandle
  genId: () => string
  setDebugInfo: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  resetSendingLock?: () => void
  resetStream?: (nextSessionId?: string | null) => void
  /** 🔴 当前显示 session 的同步权威 ref（resetStream 锁定）——loadHistory 过期响应守卫必须比它 */
  currentSessionIdRef: MutableRefObject<string | null>
}): {
  handleSwitchSession: (id: string) => Promise<void>
  handleDeleteSession: (id: string) => Promise<void>
  handleNewSession: (title?: string) => Promise<void>
} {
  // ── session switch handler ──
  // 🔴 后端是消息唯一权威源，始终 loadHistory，缓存仅秒显占位
  const handleSwitchSession = useCallback(async (id: string) => {
    if (id === sess.sessionId) return;
    resetSendingLock?.();
    // 🔴 串台根因修复：同步锁定过滤 ref 到目标 session
    resetStream?.(id);
    sess.switchTo(id);
    sess.refresh();
    setDebugInfo((prev) => ({ ...prev, sessionId: id, tokensIn: 0, tokensOut: 0, sessionStartedAt: Date.now() }));

    try {
      const status = await activateSession(id) as { status?: string; info?: { is_reset?: boolean; reset_reason?: string } };
      if (status.info?.is_reset) {
        sess.saveCache((cache) => { const c = { ...cache }; delete c[id]; return c; });
        storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(`会话已重置 (${shortId(id)})，新消息将从空白上下文开始`)] }]);
        return;
      }
    } catch {
      // 后端不可达（离线），fallback 到缓存
    }

    // 缓存秒显（防白屏），始终被后端覆盖
    const cached = sess.msgCache[id];
    storeSetMessages(cached?.length ? (cached as ChatMessage[]) : []);
    // 🔴 始终从后端加载完整历史
    sess.loadHistory(id).then((msgs) => {
      if (currentSessionIdRef.current !== id) return; // 🔴 过期响应守卫：同步权威 ref（resetStream 已锁定）
      if (msgs?.length) {
        storeSetMessages(msgs as ChatMessage[]);
        sess.saveCache((cache) => ({ ...cache, [id]: msgs }));
      } else if (!cached?.length) {
        storeSetMessages([{ id: genId(), role: 'system', parts: [textPart(`会话已切换 (${shortId(id)})`)] }]);
      }
    });
  }, [sess, genId, setDebugInfo, resetSendingLock, resetStream, currentSessionIdRef]);

  // ── session delete handler ──
  const handleDeleteSession = useCallback(async (id: string) => {
    sess.remove(id);
    // 🔴 P1-5: 删除会话同步清 profile_session_map，防僵尸指针复活
    const owner = profileFromSessionId(id);
    if (owner) {
      const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
      if (map[owner] === id) {
        delete map[owner];
        storage.save('profile_session_map', map);
      }
    }
    if (sess.sessionId === id) {
      storeSetMessages([]);
      // 🔴 P1-2.4: 删当前会话时释放锁 + 清 WS client session（对齐 handleNewSession）
      resetSendingLock?.();
      // 🔴 串台根因修复：删当前会话 → 无会话，同步锁定过滤 ref 为 null
      resetStream?.(null);
      getWsClient().switchSession('');
    }
    if (setSessionListVersion) setSessionListVersion(v => v + 1);
  }, [sess, setSessionListVersion, resetSendingLock, resetStream]);

  // ── new session — 对齐 Eleve startFreshSessionDraft()
  // 纯前端重置：清消息 + 释放锁 + 设 freshDraftReady
  // 后端 session 懒创建 — 首条消息发送时通过 createSession() 创建
  const handleNewSession = useCallback(async (title?: string) => {
    resetSendingLock?.();
    // 🔴 串台根因修复：新建会话 → 无会话，同步锁定过滤 ref 为 null
    resetStream?.(null);
    // 清空前端状态（不触发后端请求）
    storeSetMessages([]);
    // 🔴 P1-6: 先捕获 profile 再清 sessionId（否则 profileFromSessionId 拿到 null）
    const prevProfile = profileFromSessionId(sess.sessionId) || undefined;
    sess.setSessionId(null);
    clearSessionPointer(prevProfile);
    // 🔴 Fix BUG#1: 同步清除 WS client 内部 session ID，防止 promptSubmit fallback 到旧 ID
    // 不清除 → 首条消息发到旧 session → agent 带旧上下文回复 → "新建会话"名存实亡
    getWsClient().switchSession('');
    sess.setFreshDraftReady(true);
    // 对齐 Eleve: /new <title> 时暂存标题，懒创建后设置
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
