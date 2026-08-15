/**
 * useBackendQueue — 会话排队队列（后端权威投影，DSH QueueDock 对齐）
 *
 * 🔴 2026-08-16 方案A：队列显示从「前端 localStorage 自治」切换为
 * 「后端权威 Inbox.followup 投影」——busy 纯文本直发后端后由
 * route_busy_submit 收编进 actor Inbox，此处轮询 queue.status 把排队
 * 条目投射到 UI（busy 排队立即可见）。
 *
 * 条目带后端索引 index（Inbox 无 id，DSH remove-by-id 的 ELEVE 等价按
 * 索引寻址）；操作直接走 queue.remove / queue.edit / queue.steer RPC。
 * 轮询节奏与 GoalBar/TodoPanel 统一（3s）。
 */
import { useCallback, useEffect, useState } from 'react';
import { call } from '../utils/bridge';

export interface QueueEntry {
  index: number;
  text: string;
  source: string;
  media_count: number;
}

const POLL_MS = 3000;

export function useBackendQueue(sessionId?: string | null) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  // DSH QueueDock queueMutable 语义：subagent 运行时队列不可操作（前端禁用按钮）
  const [subagentActive, setSubagentActive] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await call('queue_status', { session_id: sessionId });
      setQueue(res?.queue ?? []);
      setSubagentActive(res?.subagent_active === true);
    } catch {
      // 静默（会话未就绪等）
    }
  }, [sessionId]);

  // 轮询 + 切会话即时刷新
  useEffect(() => {
    setQueue([]);
    if (!sessionId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [sessionId, refresh]);

  const remove = useCallback(
    async (index: number) => {
      if (!sessionId) return false;
      try {
        const res = await call('queue_remove', { session_id: sessionId, index });
        await refresh();
        return res?.ok === true;
      } catch {
        return false;
      }
    },
    [sessionId, refresh],
  );

  const edit = useCallback(
    async (index: number, text: string) => {
      if (!sessionId) return false;
      try {
        const res = await call('queue_edit', { session_id: sessionId, index, text });
        await refresh();
        return res?.ok === true;
      } catch {
        return false;
      }
    },
    [sessionId, refresh],
  );

  const steer = useCallback(
    async (index: number) => {
      if (!sessionId) return false;
      try {
        const res = await call('queue_steer', { session_id: sessionId, index });
        await refresh();
        return res?.ok === true;
      } catch {
        return false;
      }
    },
    [sessionId, refresh],
  );

  return { queue, subagentActive, refresh, remove, edit, steer };
}