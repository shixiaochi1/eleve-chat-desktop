/**
 * useKanbanSSE — Kanban 实时事件订阅
 *
 * 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）。
 * - SSE 主通道（EventSource /api/kanban/events，手动注入 /p/ 前缀）
 * - pollKanbanEvents 降级轮询（SSE 断连时每 5s）
 * - 事件应用逻辑收敛到 helpers.applyKanbanEvent（消除原 SSE/轮询双份重复）
 */
import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getApiBase, pollKanbanEvents } from '@/utils/api';
import { getWsActiveProfile } from '@/services/ws-client';
import type { KanbanTask, KanbanEvent } from './types';
import { KANBAN_PATCH_KINDS, KANBAN_REFRESH_KINDS } from './constants';
import { applyKanbanEvent } from './helpers';

export function useKanbanSSE(
  currentBoard: string,
  setApiTasks: Dispatch<SetStateAction<KanbanTask[]>>,
  loadBoard: () => void,
) {
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let cursor = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let sseAlive = false;

    // 处理事件（SSE 与轮询共用；结构性事件触发整板刷新）
    const handleEvents = (events: KanbanEvent[]) => {
      if (!events?.length) return;
      for (const evt of events) {
        setApiTasks(prev => {
          const updated = applyKanbanEvent(prev, evt);
          if (prev.some(t => t.id === evt.task_id) && !KANBAN_PATCH_KINDS.includes(evt.kind)) setTimeout(() => loadBoard(), 100);
          return updated;
        });
        if (KANBAN_REFRESH_KINDS.includes(evt.kind)) setTimeout(() => loadBoard(), 100);
      }
    };

    // 降级轮询：SSE 断连时每 5s 用 pollKanbanEvents 拉取
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        if (sseAlive) { clearInterval(pollTimer as any); pollTimer = null; return; }
        pollKanbanEvents(String(cursor), currentBoard).then(data => {
          const events = (data?.events || data || []) as KanbanEvent[];
          if (events.length) { handleEvents(events); if (data?.cursor) cursor = data.cursor; }
        }).catch(() => {});
      }, 5000);
    };

    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    const connectSSE = () => {
      if (eventSource) { eventSource.close(); eventSource = null; }
      const baseUrl = getApiBase();
      // 🔴 P0-5: SSE EventSource 绕过 bridge 链路，必须手动注入 /p/ 前缀（对齐 kanbanHttpFallback）
      const sseProfile = getWsActiveProfile();
      const profilePrefix = sseProfile ? `/p/${sseProfile}` : '';
      eventSource = new EventSource(`${baseUrl}${profilePrefix}/api/kanban/events?since=${cursor}&board=${encodeURIComponent(currentBoard)}`);
      eventSource.addEventListener('kanban', (e) => {
        try { handleEvents([JSON.parse(e.data)]); } catch {}
      });
      eventSource.addEventListener('kanban_cursor', (e) => { try { cursor = JSON.parse(e.data).cursor; } catch {} });
      eventSource.onopen = () => { sseAlive = true; stopPolling(); };
      eventSource.onerror = () => {
        sseAlive = false;
        eventSource?.close();
        startPolling();
        reconnectTimer = setTimeout(connectSSE, 3000);
      };
    };
    connectSSE();
    return () => { eventSource?.close(); if (reconnectTimer) clearTimeout(reconnectTimer); stopPolling(); };
  }, [currentBoard, setApiTasks, loadBoard]);
}
