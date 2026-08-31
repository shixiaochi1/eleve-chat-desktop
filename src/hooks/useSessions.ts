import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, Session } from '@/types';
import * as api from '../utils/api';
import { call } from '../utils/bridge';
import * as storage from '../utils/storage';
import { persistSessionPointer, clearSessionPointer, profileFromSessionId } from '../utils/session';
import { toChatMessages, type SessionMessage } from '@/lib/chat-messages';
import { getWsClient } from '../services/ws-client';
import {
  pruneMsgCache,
  touchAndPruneMsgCache,
  dropMsgCacheEntry,
  findTouchedKey,
} from '@/lib/msg-cache';

export function useSessions(): {
  sessionId: string | null
  /** 🔴 同步读 sessionId（ref 双写）——发送路径专用，规避 React state 异步 stale */
  getSessionId: () => string | null
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>
  sessions: Session[]
  msgCache: Record<string, ChatMessage[]>
  titles: Record<string, string>
  freshDraftReady: boolean
  setFreshDraftReady: React.Dispatch<React.SetStateAction<boolean>>
  sessionReady: boolean
  setSessionReady: React.Dispatch<React.SetStateAction<boolean>>
  pendingTitle: string | null
  setPendingTitle: React.Dispatch<React.SetStateAction<string | null>>
  refresh: () => Promise<void>
  create: (options?: { model?: string; provider?: string; profile?: string; cwd?: string }) => Promise<string | null>
  reset: () => Promise<void>
  remove: (id: string) => Promise<void>
  switchTo: (id: string) => void
  setTitle: (id: string, text: string) => void
  getTitle: (s: Session) => string
  saveCache: (updater: ((cache: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) | Record<string, ChatMessage[]>) => void
  saveTitles: (updater: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) => void
  loadHistory: (id: string) => Promise<ChatMessage[] | null>
} {
  const [sessionId, setSessionIdState] = useState<string | null>(() => (storage.load('session_id', null) as string | null));
  const [sessions, setSessions] = useState<Session[]>(() => (storage.load('sessions', null) as Session[]) || []);
  const [msgCache, setMsgCache] = useState<Record<string, ChatMessage[]>>(() => {
    const loaded = (storage.load('msg_cache', null) as Record<string, ChatMessage[]> | null) || {};
    // 🔴 2026-09-01 内存修复（审查 P0-1）：启动恢复旧全量数据 → 立即裁剪并
    // 回写落盘。存量用户磁盘上的 msg_cache 可能已是几十 MB（历史上限），
    // 不裁剪则首次重启前内存照旧。淘汰安全（msgCache 非权威源，见 lib/msg-cache.ts）。
    const pruned = pruneMsgCache(loaded);
    if (pruned !== loaded) storage.save('msg_cache', pruned);
    return pruned;
  });
  const [titles, setTitles] = useState<Record<string, string>>(() => (storage.load('titles', null) as Record<string, string>) || {});
  // ── freshDraftReady — 对齐 Eleve startFreshSessionDraft 懒创建标记
  // true = 用户点了"新建会话"但还没发首条消息，后端 session 尚未创建
  const [freshDraftReady, setFreshDraftReady] = useState<boolean>(false);
  // 🔴 2026-08-22 架构修复：会话就绪门禁（对齐 Hermes ensure_session 语义）。
  // sessionId 被设置 ≠ 后端已就绪——dev 重启/切换后 loadHistory 完成才 ready。
  // ready 前 UI（发送/附件）必须等待，否则 attach/submit 打未就绪会话 =
  // "session not found"（架构缺陷的根，此前一直在失败后补救）。
  const [sessionReady, setSessionReady] = useState<boolean>(false);
  // ── pendingTitle — 对齐 Eleve /new <title> 暂存标题，懒创建后 set_session_title
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);

  // 🔴 2026-08-27 同步指针修复（纯图消息挂错会话的根因）：sessionIdRef 双写。
  // 纯图链路 App.handleSend 在同一次事件循环里 sessionCreate → setSessionId(sid1)
  // → uploadUnuploaded(sid1)（图片挂 sid1）→ rawHandleSend 内读 sess.sessionId——
  // React state 尚未重渲染，读到 stale null → 二次懒创建 sid2 → submit 发给 sid2
  // → attached_images 空 → 后端 "text is required"。getSessionId() 走 ref 同步读，
  // 关键发送路径一律用同步值；setSessionId 包装为 ref+state 双写（对外 API 不变）。
  const sessionIdRef = useRef<string | null>(null);
  const setSessionIdSync = useCallback<React.Dispatch<React.SetStateAction<string | null>>>((value) => {
    sessionIdRef.current = typeof value === 'function'
      ? (value as (prev: string | null) => string | null)(sessionIdRef.current)
      : value;
    setSessionIdState(sessionIdRef.current);
  }, []);
  const getSessionId = useCallback((): string | null => sessionIdRef.current ?? sessionId, [sessionId]);

  // ── persistence ──
  const saveCache = useCallback((updater: ((cache: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) | Record<string, ChatMessage[]>): void => {
    setMsgCache((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // 🔴 2026-09-01 内存修复（审查 P0-1）：LRU 容量治理——只留最近
      // MSG_CACHE_MAX_SESSIONS(10) 个会话。此前缓存所有打开过的会话全量消息
      // （含工具 args/result 大字符串）且每 turn 全量回写，无界增长。
      // touch 目标 = 本次写入的会话（写点恒为 { ...cache, [sid]: msgs }
      // 引用新建形态，引用 diff 识别，调用方零改动）。淘汰安全：msgCache
      // 非权威源，读取点仅"秒显"且恒被 loadHistory 后端数据覆盖。
      const touchedKey = findTouchedKey(prev, next);
      const pruned = touchedKey
        ? touchAndPruneMsgCache(next, touchedKey)
        : pruneMsgCache(next);
      storage.save('msg_cache', pruned);
      return pruned;
    });
  }, []);

  const saveTitles = useCallback((updater: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>): void => {
    setTitles((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      storage.save('titles', next);
      return next;
    });
  }, []);

  // ── fetch sessions from API ──
  const refresh = useCallback(async (): Promise<void> => {
    try { setSessions(await api.fetchSessions()); } catch { /* offline */ }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── CRUD ──
  // 🔴 2026-08-11 激活：对齐 Hermes openNewSessionTile（宫格 tile 新建 = 立即 session.create）—
  // 原为无 UI 调用方的死链；现在宫格"新建会话"（App gridAwareNewSession）调用。
  // 补全防断线：创建后同步 WS client 内部 session id（Fix BUG#1 同款，防 promptSubmit
  // fallback 旧 id）+ 非懒创建标记 + 返回 newId 供调用方切换。
  const create = useCallback(async (options?: { model?: string; provider?: string; profile?: string; cwd?: string }): Promise<string | null> => {
    try {
      const data = await api.createSession(options) as { session_id?: string; id?: string };
      if (data?.session_id || data?.id) {
        const newId = data.session_id || data.id!;
        setSessionIdSync(newId);
        persistSessionPointer(newId);
        getWsClient().switchSession(newId);
        setFreshDraftReady(false);
        await refresh();
        return newId;
      }
      return null;
    } catch {
      return null; // offline
    }
  }, [refresh]);

  /** 重置当前会话（对齐 Eleve reset_session：新 ID + 清消息 + 保留记忆） */
  const reset = useCallback(async (): Promise<void> => {
    if (!sessionId) { await create(); return; }
    try {
      const data = await api.resetSession(sessionId) as { session_id?: string; id?: string };
      if (data?.session_id || data?.id) {
        const newId = data.session_id || data.id!;
        setSessionIdSync(newId);
        persistSessionPointer(newId);
        // 🔴 2026-08-13 架构统一：reset 后同样订阅新会话（与 switchTo/create 对齐）
        getWsClient().switchSession(newId);
        await refresh();
      }
    } catch { /* offline */ }
  }, [sessionId, create, refresh]);

  const remove = useCallback(async (id: string): Promise<void> => {
    try { await api.deleteSession(id); } catch { /* ignore */ }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    saveCache((prev) => { const c = { ...prev }; delete c[id]; return c; });
    // 🔴 2026-09-01 内存修复：LRU 序号联动清理（防脏序号残留）
    dropMsgCacheEntry(id);
    if (sessionId === id) {
      setSessionIdSync(null);
      // 🔴 P1-4: 收敛到权威函数（禁止裸调 storage.remove，防僵尸指针）
      clearSessionPointer(profileFromSessionId(id) ?? undefined);
    }
  }, [sessionId, saveCache]);

  const switchTo = useCallback((id: string): void => {
    if (id === sessionId) return;
    setSessionIdSync(id);
    persistSessionPointer(id);
    // 🔴 2026-08-13 架构统一：切换当前会话 → 同步订阅（attach → 后端推 session.info
    // 含 pending_prompts/cwd——单视图 handleSwitchSession 路径此前不 attach，
    // 切到的会话审批/交互不恢复；与 loadSessionIntoView 的 switchSession 对齐）
    getWsClient().switchSession(id);
  }, [sessionId]);

  // ── titles ──
  const setTitle = useCallback((id: string, text: string): void => {
    saveTitles((prev) => ({ ...prev, [id]: text }));
  }, [saveTitles]);

  const getTitle = useCallback((s: Session): string => {
    return titles[s.id] || s.title || s.id?.slice(0, 8) || '新会话';
  }, [titles]);

  // ── load history from API ──
  const loadHistory = useCallback(async (id: string): Promise<ChatMessage[] | null> => {
    try {
      const data = await api.getSessionHistory(id) as { messages?: unknown[] };
      if (data?.messages?.length) {
        // 1:1 with Eleve: backend SessionMessage[] → toChatMessages() → ChatMessage[]
        return toChatMessages(data.messages as SessionMessage[]);
      }
    } catch (e) {
      console.warn('[loadHistory] Failed to load history for session', id, e);
    }
    return null;
  }, []);

  return {
    sessionId, setSessionId: setSessionIdSync, getSessionId, sessions, msgCache, titles,
    freshDraftReady, setFreshDraftReady,
    sessionReady, setSessionReady,
    pendingTitle, setPendingTitle,
    refresh, create, reset, remove, switchTo,
    setTitle, getTitle, saveCache, saveTitles, loadHistory,
  };
}

/**
 * 会话管理器句柄 — 单一权威源（🔴 2026-09-01 收敛，审查：接口重复定义）。
 * 此前 useMessageStream.ts 存在一份几乎逐字重复的平行定义（已漂移：create
 * 签名缺 cwd、缺 sessionReady 门禁）。消费方（useSessionActions/usePromptActions）
 * 统一 import 本类型；ReturnType 推导零手抄，杜绝再次漂移。
 */
export type SessionManagerHandle = ReturnType<typeof useSessions>;
