/**
 * useMemory — 记忆数据 Hook
 *
 * 通过 bridge.call('list_memories') 从后端获取数据，
 * API 不可用时优雅降级为空数据，不提供 mock 数据。
 */
import { useState, useEffect, useCallback } from 'react';
import { call } from '../utils/bridge';

interface MemoryEntry {
  id: string;
  content?: string;
}

interface MemoryResponse {
  memories?: MemoryEntry[];
}

export default function useMemory() {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data: MemoryResponse = await call('list_memories', {});
      setMemories(Array.isArray((data as any)?.memories) ? (data as any).memories : Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      // API 不可用时优雅降级为空数据，不抛错误提示
      setMemories([]);
    }
    setLoading(false);
  }, []);

  const deleteEntry = useCallback(async (memoryId: string): Promise<boolean> => {
    try {
      await call('delete_memory', { memory_id: memoryId });
      setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      return true;
    } catch (err: unknown) {
      setError((err as Error).message || '删除记忆失败');
      return false;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { memories, loading, error, refresh, deleteEntry };
}
