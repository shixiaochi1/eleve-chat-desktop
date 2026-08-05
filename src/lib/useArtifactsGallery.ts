/**
 * useArtifactsGallery — 跨会话产物库数据 Hook（对齐 Hermes app/artifacts 数据链）
 *
 * 状态单一来源：artifacts（跨会话扫描结果）+ query（搜索词）+ refreshing（刷新中）。
 * 搜索框/刷新按钮可渲染在外部容器（右栏产物 tab 的「产物库」栏），
 * 本 hook 只负责数据，UI 由消费方（ArtifactPanel）与 ArtifactsGallery 拆分承载。
 *
 * 数据链路：session.list(30) → 每会话 session.history 全量 → collectArtifactsForSession 纯函数提取。
 */
import { useCallback, useEffect, useState } from 'react';
import { call } from '@/utils/bridge';
import { collectArtifactsForSession, type GalleryArtifact } from '@/lib/artifacts-gallery';

export interface ArtifactsGalleryState {
  /** null = 加载中 */
  artifacts: GalleryArtifact[] | null;
  query: string;
  setQuery: (q: string) => void;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useArtifactsGallery(): ArtifactsGalleryState {
  const [artifacts, setArtifacts] = useState<GalleryArtifact[] | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = (await call('list_sessions', { limit: 30 })) as { sessions?: Array<{
        id: string; title?: string | null; preview?: string | null;
        started_at?: unknown; last_active?: unknown;
      }> };
      const sessions = data.sessions ?? [];
      const results = await Promise.allSettled(
        sessions.map(async (session) => {
          const hist = (await call('get_session_messages', { session_id: session.id })) as { messages?: unknown[] };
          return collectArtifactsForSession(session, (hist.messages ?? []) as Parameters<typeof collectArtifactsForSession>[1]);
        }),
      );
      const next: GalleryArtifact[] = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') next.push(...result.value);
      });
      setArtifacts(next.sort((a, b) => b.timestamp - a.timestamp));
    } catch (err) {
      console.error('[artifacts-gallery] load failed:', err);
      setArtifacts([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 首次进入产物库视图时加载一次（组件挂载）
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { artifacts, query, setQuery, refreshing, refresh };
}
