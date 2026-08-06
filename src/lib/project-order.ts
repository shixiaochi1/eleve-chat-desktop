/**
 * 项目手动拖拽排序（对齐 Hermes $sidebarProjectOrderIds persistentAtom +
 * orderProjectsByIds）。空 order = 确定性默认排序（激活→显式→有会话→活跃）；
 * 用户拖拽后 order 生效，新项目（未在 order 中）按确定性位置插入：
 * 有会话的 fresh 置顶（用户刚起步的项目仍可见），零会话的沉底（磁盘扫描
 * 新发现不挤占手排列表）。
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

/** 确定性排序（激活→显式→有会话→活跃→名称）—— 与 ProjectTreePanel 的 sortProjectsForOverview 同规则 */
export function sortProjectsForOverview<T extends OrderableProject>(
  projects: T[],
  activeProjectId?: string | null,
): T[] {
  const sorted = [...projects].sort((a, b) => {
    const aActive = Boolean(activeProjectId && a.id === activeProjectId && !a.isAuto);
    const bActive = Boolean(activeProjectId && b.id === activeProjectId && !b.isAuto);
    if (aActive !== bActive) return aActive ? -1 : 1;
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

/** 手排 order 覆盖在确定性排序之上（对齐 Hermes orderProjectsByIds） */
export function orderProjectsByIds<T extends OrderableProject>(
  projects: T[],
  orderIds: string[],
  activeProjectId?: string | null,
): T[] {
  if (!orderIds.length) {
    return sortProjectsForOverview(projects, activeProjectId);
  }

  const byId = new Map(projects.map(p => [p.id, p]));
  const ordered = orderIds.map(id => byId.get(id)).filter((p): p is T => Boolean(p));
  const seen = new Set(ordered.map(p => p.id));
  const fresh = projects.filter(p => !seen.has(p.id));

  if (!fresh.length) {
    return homeFirst(ordered);
  }

  return homeFirst([
    // fresh 有会话的置顶（对齐 Hermes：用户刚起步的项目仍 surface）
    ...fresh.filter(p => p.sessionCount > 0),
    ...ordered,
    // fresh 零会话的沉底（磁盘扫描新发现不挤占手排列表）
    ...fresh.filter(p => p.sessionCount <= 0),
  ]);
}
