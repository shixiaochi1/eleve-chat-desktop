/**
 * useProjectTree — `projects.tree`（总览，hydrate=false）的共享数据源。
 *
 * 为什么抽出来（P2-8 接线前置）：
 * 这份数据此前被 `ProjectTreePanel` 独占在组件内部。会话列表按项目分组需要**同一份**
 * 项目集合与刷新时机（`sessionListVersion`），若各自再拉一次会出现"面板里的项目和
 * 列表里的分组不是同一帧"的经典错位。
 *
 * 语义要点（与 ProjectTreePanel 保持一致）：
 * - 显式传 `profile`（per-profile projects.db 路由），切 Agent 自动重拉；
 * - **过期响应守卫**：快速切 Agent 时旧响应丢弃（否则旧 Agent 的项目会短暂写进新面板）；
 * - `preview_limit: 3` 对齐 Hermes 总览的 PROJECT_PREVIEW_COUNT。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { call } from '../utils/bridge';
import type { ProjectGroupProject } from '../lib/session-groups';

export interface ProjectTreeNode extends ProjectGroupProject {
  /** 项目绑定物理路径（后端字段名是 path） */
  path?: string | null;
  isAuto?: boolean;
}

export interface ProjectTreeSnapshot {
  projects?: ProjectTreeNode[];
  active_id?: string | null;
}

export function useProjectTree(currentProfile?: string, version?: number) {
  const [snapshot, setSnapshot] = useState<ProjectTreeSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileRef = useRef(currentProfile);
  profileRef.current = currentProfile;

  const reload = useCallback(async (silent = true) => {
    const reqProfile = profileRef.current;
    try {
      if (!silent) setLoading(true);
      setError(null);
      const result = (await call('projects_tree', {
        preview_limit: 3,
        include_discovered: true,
        profile: reqProfile,
      })) as ProjectTreeSnapshot | null;
      // 🔴 过期响应守卫：期间切了 Agent 就丢弃（同 ProjectTreePanel 的 profileSwitch 保护）
      if (profileRef.current !== reqProfile) return;
      setSnapshot(result ?? null);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(true);
  }, [currentProfile, version, reload]);

  const projects: ProjectGroupProject[] = (snapshot?.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    primary_path: p.path ?? p.primary_path ?? null,
    updated_at: p.updated_at ?? null,
  }));

  return { projects, snapshot, loading, error, reload };
}
