/**
 * useMemory — 记忆数据 Hook
 *
 * 对齐后端 API：
 *   GET  /api/memory?target=       → 条目查询（Eleve扩展）
 *   DELETE /api/memory              → body: { target, old_text }
 *
 * 后端响应格式（条目查询模式）：
 *   { memory_entries: [{content, char_count}], user_entries: [{content, char_count}] }
 */
import { useState, useEffect, useCallback } from 'react';
import { call } from '../utils/bridge';

export interface MemoryEntry {
  id: string;           // 前端生成：`${target}-${index}`
  target: string;       // "memory" | "user"
  content: string;
  char_count?: number;
  target_name?: string;
  created_at?: string;
}

interface EntryItem {
  content: string;
  char_count?: number;
}

interface MemoryEntriesResponse {
  memory_entries?: EntryItem[];
  user_entries?: EntryItem[];
}

const TARGET_LABELS: Record<string, string> = {
  memory: '系统记忆',
  user: '用户偏好',
};

export default function useMemory(sessionId?: string | null) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 不传 target → 后端返回 memory_entries + user_entries
      // 🔴 2026-08-02 断线修复：显式传 session_id（后端 params 优先 → 连接级回退）
      const data: MemoryEntriesResponse = await call('list_memories', sessionId ? { session_id: sessionId } : {});
      const entries: MemoryEntry[] = [];

      // memory 条目
      if (Array.isArray(data.memory_entries)) {
        data.memory_entries.forEach((item, i) => {
          entries.push({
            id: `memory-${i}`,
            target: 'memory',
            target_name: TARGET_LABELS['memory'],
            content: item.content || '',
            char_count: item.char_count,
          });
        });
      }

      // user 条目
      if (Array.isArray(data.user_entries)) {
        data.user_entries.forEach((item, i) => {
          entries.push({
            id: `user-${i}`,
            target: 'user',
            target_name: TARGET_LABELS['user'],
            content: item.content || '',
            char_count: item.char_count,
          });
        });
      }

      setMemories(entries);
    } catch (err: unknown) {
      setError((err as Error).message || '获取记忆失败');
      setMemories([]);
    }
    setLoading(false);
  }, []);

  const deleteEntry = useCallback(async (entry: MemoryEntry): Promise<boolean> => {
    try {
      // 后端 DELETE /api/memory 接收 { target, old_text }，模糊匹配删除
      // 🔴 2026-08-02 断线修复：显式传 session_id（后端 params 优先 → 连接级回退）
      await call('delete_memory', {
        target: entry.target,
        old_text: entry.content,
        ...(sessionId ? { session_id: sessionId } : {}),
      });
      setMemories((prev) => prev.filter((m) => m.id !== entry.id));
      return true;
    } catch (err: unknown) {
      setError((err as Error).message || '删除记忆失败');
      return false;
    }
  }, [sessionId]);

  useEffect(() => { refresh(); }, [refresh, sessionId]);

  return { memories, loading, error, refresh, deleteEntry };
}
