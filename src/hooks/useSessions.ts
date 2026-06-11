import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage, Session } from '@/types';
import * as api from '../utils/api';
import { call } from '../utils/bridge';
import * as storage from '../utils/storage';
import { toChatMessages, type SessionMessage } from '@/lib/chat-messages';

export function useSessions(): {
  sessionId: string | null
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>
  sessions: Session[]
  msgCache: Record<string, ChatMessage[]>
  titles: Record<string, string>
  refresh: () => Promise<void>
  create: () => Promise<void>
  reset: () => Promise<void>
  remove: (id: string) => Promise<void>
  switchTo: (id: string) => void
  setTitle: (id: string, text: string) => void
  getTitle: (s: Session) => string
  saveCache: (updater: ((cache: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) | Record<string, ChatMessage[]>) => void
  saveTitles: (updater: ((prev: Record<string, string>) => Record<string, string>) | Record<string, string>) => void
  loadHistory: (id: string) => Promise<ChatMessage[] | null>
} {
  const [sessionId, setSessionId] = useState<string | null>(() => (storage.load('session_id', null) as string | null));
  const [sessions, setSessions] = useState<Session[]>(() => (storage.load('sessions', null) as Session[]) || []);
  const [msgCache, setMsgCache] = useState<Record<string, ChatMessage[]>>(() => (storage.load('msg_cache', null) as Record<string, ChatMessage[]>) || {});
  const [titles, setTitles] = useState<Record<string, string>>(() => (storage.load('titles', null) as Record<string, string>) || {});

  // ── persistence ──
  const saveCache = useCallback((updater: ((cache: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>) | Record<string, ChatMessage[]>): void => {
    setMsgCache((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      storage.save('msg_cache', next);
      return next;
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
  const create = useCallback(async (): Promise<void> => {
    try {
      const data = await api.createSession() as { session_id?: string; id?: string };
      if (data?.session_id || data?.id) {
        const newId = data.session_id || data.id!;
        setSessionId(newId);
        storage.save('session_id', newId);
        await refresh();
      }
    } catch { /* offline */ }
  }, [refresh]);

  /** 重置当前会话（对齐 Hermes reset_session：新 ID + 清消息 + 保留记忆） */
  const reset = useCallback(async (): Promise<void> => {
    if (!sessionId) { await create(); return; }
    try {
      const data = await api.resetSession(sessionId) as { session_id?: string; id?: string };
      if (data?.session_id || data?.id) {
        const newId = data.session_id || data.id!;
        setSessionId(newId);
        storage.save('session_id', newId);
        await refresh();
      }
    } catch { /* offline */ }
  }, [sessionId, create, refresh]);

  const remove = useCallback(async (id: string): Promise<void> => {
    try { await api.deleteSession(id); } catch { /* ignore */ }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    saveCache((prev) => { const c = { ...prev }; delete c[id]; return c; });
    if (sessionId === id) {
      setSessionId(null);
      storage.remove('session_id');
    }
  }, [sessionId, saveCache]);

  const switchTo = useCallback((id: string): void => {
    if (id === sessionId) return;
    setSessionId(id);
    storage.save('session_id', id);
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
        // 1:1 with Hermes: backend SessionMessage[] → toChatMessages() → ChatMessage[]
        return toChatMessages(data.messages as SessionMessage[]);
      }
    } catch (e) {
      console.warn('[loadHistory] Failed to load history for session', id, e);
    }
    return null;
  }, []);

  return {
    sessionId, setSessionId, sessions, msgCache, titles,
    refresh, create, reset, remove, switchTo,
    setTitle, getTitle, saveCache, saveTitles, loadHistory,
  };
}
