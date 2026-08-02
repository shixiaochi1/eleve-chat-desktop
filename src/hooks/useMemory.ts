/**
 * useMemory — 记忆数据 Hook（profile 作用域，对齐 Hermes per-agent 记忆）
 *
 * 后端 RPC（全部经 sendRpc 自动盖章 params.profile，None → default）：
 *   memory.list   → { memory_entries, user_entries, limits: {memory,user}, active }
 *   memory.delete → { target, old_text }  模糊匹配删除单条
 *   memory.reset  → { target: all|memory|user }  清空 MEMORY.md/USER.md（对齐 Hermes reset_memory）
 *
 * 作用域说明：记忆是 per-agent（per-profile）的 MEMORY.md/USER.md 文件，与会话无关。
 * 后端经 ephemeral_memory_manager 读磁盘最新状态，无会话也能查询（对齐 Hermes 短生命周期语义）。
 */
import { useState, useEffect, useCallback } from 'react';
import { call } from '../utils/bridge';

export interface MemoryEntry {
  id: string;           // 前端生成：`${target}-${index}`
  target: string;       // "memory" | "user"
  content: string;
  char_count?: number;
  target_name?: string;
}

interface EntryItem {
  content: string;
  char_count?: number;
}

interface MemoryListResponse {
  memory_entries?: EntryItem[];
  user_entries?: EntryItem[];
  /** 字符上限（对齐 Hermes：MEMORY.md 2200 / USER.md 1375） */
  limits?: { memory?: number; user?: number };
  /** 活跃外部 provider（ELEVE 当前仅 builtin → 空串） */
  active?: string;
}

export interface MemoryLimits {
  memory: number;
  user: number;
}

const TARGET_LABELS: Record<string, string> = {
  memory: '系统记忆',
  user: '用户偏好',
};

const DEFAULT_LIMITS: MemoryLimits = { memory: 2200, user: 1375 };

export default function useMemory(profile?: string) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [limits, setLimits] = useState<MemoryLimits>(DEFAULT_LIMITS);
  const [active, setActive] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 显式传 profile（绑定当前 Agent，不依赖全局 activeProfile 时序——防宫格焦点冒泡串台）
      const data: MemoryListResponse = await call('list_memories', profile ? { profile } : {});
      const entries: MemoryEntry[] = [];

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
      setLimits({
        memory: data.limits?.memory ?? DEFAULT_LIMITS.memory,
        user: data.limits?.user ?? DEFAULT_LIMITS.user,
      });
      setActive(data.active ?? '');
    } catch (err: unknown) {
      setError((err as Error).message || '获取记忆失败');
      setMemories([]);
    }
    setLoading(false);
  }, []);

  const deleteEntry = useCallback(async (entry: MemoryEntry): Promise<boolean> => {
    try {
      await call('delete_memory', { target: entry.target, old_text: entry.content, ...(profile ? { profile } : {}) });
      setMemories((prev) => prev.filter((m) => m.id !== entry.id));
      return true;
    } catch (err: unknown) {
      setError((err as Error).message || '删除记忆失败');
      return false;
    }
  }, [profile]);

  /** 重置目标（对齐 Hermes reset_memory）：all=清空全部 / memory=MEMORY.md / user=USER.md */
  const resetTarget = useCallback(async (target: 'all' | 'memory' | 'user'): Promise<boolean> => {
    try {
      await call('reset_memory', { target, ...(profile ? { profile } : {}) });
      await refresh();
      return true;
    } catch (err: unknown) {
      setError((err as Error).message || '重置记忆失败');
      return false;
    }
  }, [refresh, profile]);

  // profile 变化 → 重拉（RPC profile 由 sendRpc 盖章，此处仅作刷新触发器）
  useEffect(() => { refresh(); }, [refresh, profile]);

  return { memories, limits, active, loading, error, refresh, deleteEntry, resetTarget };
}
