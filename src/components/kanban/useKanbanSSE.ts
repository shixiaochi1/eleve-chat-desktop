/**
 * useKanbanSSE — Kanban 实时事件订阅
 *
 * 从 KanbanPanel.tsx 拆分（Tier 3 · 6-2）。
 * - SSE 主通道（EventSource /api/kanban/events，手动注入 /p/ 前缀）
 * - pollKanbanEvents 降级轮询（SSE 断连时每 5s）
 * - 事件应用逻辑收敛到 helpers.applyKanbanEvent（消除原 SSE/轮询双份重复）
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getApiBase, pollKanbanEvents } from '@/utils/api';
import { getWsActiveProfile } from '@/services/ws-client';
import type { KanbanTask, KanbanEvent } from './types';
import { KANBAN_PATCH_KINDS } from './constants';
import { applyKanbanEvent } from './helpers';

export function useKanbanSSE(
  currentBoard: string,
  setApiTasks: Dispatch<SetStateAction<KanbanTask[]>>,
  loadBoard: () => void,
  onEvents?: (events: KanbanEvent[]) => void,
) {
  // 🔴 修复（CPU/内存爆炸根因）：onEvents 若为内联箭头函数，每次渲染都是新
  //   引用 → 本 effect deps 每次渲染都变化 → SSE 反复重连 → 重连收到事件 →
  //   setState → 重渲染 → 再重连……无限循环。用 ref 存最新回调，effect 只
  //   依赖稳定值（currentBoard/setApiTasks/loadBoard），杜绝重连风暴。
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let cursor = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let sseAlive = false;
    // 🔴 事件去重防御：后端 cursor 异常/重连竞态可能重复推送同批事件——按事件
    //   id 单调递增跳过已处理项，杜绝重复事件触发的 loadBoard/tick 风暴
    let lastSeenId = 0;

    // 处理事件（SSE 与轮询共用；结构性事件触发整板刷新）
    // 🔴 修复：原实现在 setApiTasks(prev => …) 更新器内部调用
    //   setTimeout(loadBoard) —— 更新器必须保持纯函数（React 可能双调用），
    //   副作用外提到更新器之后；刷新判定也简化为一刀切：patch 类事件本地
    //   应用（快路径），其余事件（status/assigned/specified/created…）一律
    //   触发整板重载自愈（loadBoard 幂等且廉价，消除原「default 删卡 +
    //   非 refresh 事件不重载 → 卡片消失到 60s 轮询」的窗口）。
    const handleEvents = (events: KanbanEvent[]) => {
      if (!events?.length) return;
      const fresh = events.filter(evt => {
        const id = typeof evt.id === 'number' ? evt.id : 0;
        if (id > 0 && id <= lastSeenId) return false;
        if (id > 0) lastSeenId = id;
        return true;
      });
      if (!fresh.length) return;
      const needsReload = fresh.some(evt => !KANBAN_PATCH_KINDS.includes(evt.kind));
      setApiTasks(prev => fresh.reduce((acc, evt) => applyKanbanEvent(acc, evt), prev));
      if (needsReload) setTimeout(() => loadBoard(), 100);
      // 🔴 对齐 Hermes socket 事件帧精确失效（drawer.tsx L556-561）：把事件透传
      //   给打开中的详情抽屉——评论/回收/状态变更秒级反映，不等 30s 轮询
      onEventsRef.current?.(fresh);
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
    // 🔴 onEvents 已走 ref（见函数顶部），从 deps 移除——否则内联回调导致
    //   每次渲染重连 SSE 的死循环（CPU 爆炸/内存增长）
  }, [currentBoard, setApiTasks, loadBoard]);
}
