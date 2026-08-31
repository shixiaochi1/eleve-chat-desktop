/**
 * useArtifactsGallery — 跨会话产物库数据 Hook（对齐 Hermes app/artifacts 数据链）
 *
 * 状态单一来源：artifacts（跨会话扫描结果）+ query（搜索词）+ refreshing（刷新中）。
 * 搜索框/刷新按钮可渲染在外部容器（右栏产物 tab 的「产物库」栏），
 * 本 hook 只负责数据，UI 由消费方（ArtifactPanel）与 ArtifactsGallery 拆分承载。
 *
 * 数据链路：session.list(30) → 每会话 session.history 全量 → collectArtifactsForSession 纯函数提取。
 *
 * 🔴 2026-09-01 分层归位：lib/ → hooks/（hook 文件归位 hooks 层，纯移动）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '@/utils/bridge';
import { notifyWarning } from '@/utils/notifications';
import { collectArtifactsForSession, type GalleryArtifact } from '@/lib/artifacts-gallery';

export interface ArtifactsGalleryState {
  /** null = 加载中 */
  artifacts: GalleryArtifact[] | null;
  query: string;
  setQuery: (q: string) => void;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useArtifactsGallery(profile?: string | null): ArtifactsGalleryState {
  const [artifacts, setArtifacts] = useState<GalleryArtifact[] | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  // 🔴 2026-08-29 对齐 Hermes useRefreshHotkey 防重入（app/artifacts/index.tsx
  // refreshInFlightRef）：连点刷新/快速切视图时丢弃后续触发，避免乱序覆盖
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      // 🔴 2026-08-22 修复：传 profile——产物库按当前 Agent 过滤（对齐 Hermes
      // app/artifacts per-profile 语义）。此前不传 → session.list 返回全 profile
      // 会话 → 切 Agent/项目时产物库不跟随。
      const data = (await call('list_sessions', { limit: 30, profile: profile ?? undefined })) as { sessions?: Array<{
        id: string; title?: string | null; preview?: string | null;
        started_at?: unknown; last_active?: unknown;
      }> };
      const sessions = data.sessions ?? [];
      // 🔴 2026-08-29 对齐 Hermes collectAllArtifacts（artifact-utils.ts:439-449
      // 明确注释）：逐会话【串行】拉取——并发全量 fetch 会同时驻留 30 份消息
      // 全量 JSON，内存易爆；单会话失败跳过不中断整轮。
      const next: GalleryArtifact[] = [];
      let failedCount = 0;
      for (const session of sessions) {
        try {
          const hist = (await call('get_session_messages', { session_id: session.id })) as { messages?: unknown[] };
          next.push(...collectArtifactsForSession(
            session,
            (hist.messages ?? []) as Parameters<typeof collectArtifactsForSession>[1],
          ));
        } catch (err) {
          failedCount += 1;
          console.warn(`[artifacts-gallery] session ${session.id} load failed:`, err);
        }
      }
      if (failedCount > 0) {
        // 🔴 2026-08-29 对齐 Hermes partial-load 通知（app/artifacts/index.tsx:161-167：
        // "Skipped N of M recent sessions while indexing artifacts"）——静默跳过
        // 会让用户以为产物全量展示，实际少了失败会话的产物
        notifyWarning(`索引产物时跳过 ${failedCount} / ${sessions.length} 个会话（加载失败）`, '产物库部分加载');
      }
      // 🔴 2026-08-22 修复：跨会话按 value 去重——同一图片/文件被多个会话引用时
      // 产物库只显示一份（对齐 Hermes artifacts 聚合）。会话内去重已由
      // collectArtifactsForSession 的 sessionId:value key 保证，此处补跨会话层。
      const byValue = new Map<string, GalleryArtifact>();
      for (const a of next) {
        const k = a.value;
        const existing = byValue.get(k);
        if (!existing || (a.timestamp ?? 0) > (existing.timestamp ?? 0)) byValue.set(k, a);
      }
      setArtifacts(Array.from(byValue.values()).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)));
    } catch (err) {
      console.error('[artifacts-gallery] load failed:', err);
      setArtifacts([]);
    } finally {
      refreshInFlightRef.current = false;
      setRefreshing(false);
    }
    // 🔴 2026-08-22：profile 变化 → 重新加载（切 Agent/项目时产物库跟随）
  }, [profile]);

  // 首次进入产物库视图时加载一次（组件挂载）
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { artifacts, query, setQuery, refreshing, refresh };
}
