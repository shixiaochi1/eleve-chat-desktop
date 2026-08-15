/**
 * useKanbanActiveCount — 看板在飞任务计数（running + ready）
 *
 * 🔴 2026-08-16（平台受限项 d1 P0-5 闭合）：对齐 Hermes KanbanCount
 *   （plugin.tsx:41-78）——状态栏 running+ready 活计数药丸，点击跳转看板，
 *   无在飞任务时隐藏。ELEVE 宿主无状态栏贡献区，映射为 IconBar kanban
 *   图标右上角计数角标。
 *
 * 数据源：getKanbanStats（后端 board_stats 纯 COUNT 查询，比拉全板轻）；
 *   跟随 boardStore 共享板选择（对齐 Hermes $boardSlug 全局原子）——
 *   用户切板后计数立即跟随。
 * 刷新：60s 心跳（对齐 Hermes refetchInterval 60_000）+ 窗口聚焦/可见时
 *   立即刷新（桌面应用切回前台看到最新计数）；gateway 离线不轮询。
 */
import { useEffect, useState } from 'react';
import { getKanbanStats } from '../utils/api';
import { getSharedBoard, subscribeSharedBoard } from '../components/kanban/boardStore';

export interface KanbanActiveCount {
  running: number;
  ready: number;
  active: number;
}

const ZERO: KanbanActiveCount = { running: 0, ready: 0, active: 0 };

export function useKanbanActiveCount(enabled: boolean): KanbanActiveCount {
  const [counts, setCounts] = useState<KanbanActiveCount>(ZERO);

  useEffect(() => {
    if (!enabled) {
      setCounts(ZERO);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetch = async () => {
      try {
        const data = await getKanbanStats(getSharedBoard());
        const byStatus = (data?.stats?.by_status || data?.by_status || {}) as Record<string, number>;
        if (cancelled) return;
        const running = byStatus.running ?? 0;
        const ready = byStatus.ready ?? 0;
        setCounts({ running, ready, active: running + ready });
      } catch {
        /* 网关/后端暂不可达：静默保留上次计数（角标自动隐藏靠 active===0） */
      }
    };

    void fetch();
    timer = setInterval(() => void fetch(), 60_000);
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetch();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    // 共享板切换（主面板/侧边栏任一实例 setSharedBoard）→ 立即重拉
    const unsubBoard = subscribeSharedBoard(() => void fetch());
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      unsubBoard();
    };
  }, [enabled]);

  return counts;
}
