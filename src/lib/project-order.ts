/**
 * 项目手动拖拽排序（对齐 Hermes $sidebarProjectOrderIds persistentAtom +
 * orderProjectsByIds）。
 *
 * 🔴 2026-08-14 老大决策：项目卡片顺序**完全手动**（拖动固定）——
 *   点击激活/活跃状态**永不改变顺序**；新项目（未在 order 中）按确定性
 *   排序追加底部（不自动置顶）。项目内的消息列表（previewSessions）
 *   保持自动排序（后端按 session_time）。
 *
 * 行为：
 * - 空 order = 确定性默认排序（显式→有会话→活跃→名称，**不含激活置顶**）
 * - 用户拖拽后 order 生效（localStorage 持久化）
 * - 新项目（未在 order）→ 确定性排序追加底部
 * - Home 桶恒首
 */

const KEY = 'eleve.sidebarProjectOrderIds.v1';

export function getProjectOrderIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setProjectOrderIds(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 存储不可用 → 静默降级
  }
}

interface OrderableProject {
  id: string;
  isAuto: boolean;
  isNoProject?: boolean;
  sessionCount: number;
  lastActive: number;
  label: string;
}

/** Home 桶恒首（对齐 Hermes homeFirst：fixture 不是项目，总在最前） */
function homeFirst<T extends OrderableProject>(projects: T[]): T[] {
  const home = projects.filter(p => p.isNoProject);
  if (!home.length) return projects;
  return [...home, ...projects.filter(p => !p.isNoProject)];
}

/** 确定性排序（显式→有会话→活跃→名称）—— 🔴 2026-08-14 去掉激活置顶权重：
 *  点击项目（set_active）不再改变项目顺序（老大：顺序完全手动） */
export function sortProjectsForOverview<T extends OrderableProject>(
  projects: T[],
): T[] {
  const sorted = [...projects].sort((a, b) => {
    if (!a.isAuto !== !b.isAuto) return a.isAuto ? 1 : -1;
    const aHasSessions = a.sessionCount > 0;
    const bHasSessions = b.sessionCount > 0;
    if (aHasSessions !== bHasSessions) return aHasSessions ? -1 : 1;
    const recency = (b.lastActive || 0) - (a.lastActive || 0);
    if (recency !== 0) return recency;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
  return homeFirst(sorted);
}

/** 手排 order 覆盖在确定性排序之上（对齐 Hermes orderProjectsByIds）。
 * 🔴 2026-08-20 老大决策：**Home 桶参与手排**（去掉 homeFirst 强制置顶）——
 * 拖动 Home 卡片即可改变其位置（此前 Home 恒首，拖了松手被拉回第一）。
 * 默认排序（order 为空）仍 Home 首（首次固化的初始状态）；用户拖走后按新 order。 */
export function orderProjectsByIds<T extends OrderableProject>(
  projects: T[],
  orderIds: string[],
): T[] {
  if (!orderIds.length) {
    return sortProjectsForOverview(projects);
  }

  const byId = new Map(projects.map(p => [p.id, p]));
  const ordered = orderIds.map(id => byId.get(id)).filter((p): p is T => Boolean(p));
  const seen = new Set(ordered.map(p => p.id));
  const fresh = projects.filter(p => !seen.has(p.id));

  if (!fresh.length) {
    return ordered;
  }

  // 🔴 2026-08-14：新项目确定性排序**追加底部**（不按会话数自动置顶——老大：顺序手动）
  return [
    ...ordered,
    ...sortProjectsForOverview(fresh),
  ];
}
