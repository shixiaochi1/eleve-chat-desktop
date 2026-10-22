/**
 * 会话按「项目」分组的纯函数（P2-8 的骨架）。
 *
 * 目标形态（对齐 Hermes）：项目 = 会话列表里的**分组头**，不是独立卡片区。
 * 点分组头只做"折叠/过滤"，不切消息区、不改 cwd；分组内的会话按最近活动降序。
 *
 * 为什么单拎成纯函数：
 * - 分组规则（路径归属判定、Home 兜底、排序）是本块最容易出错也最值得锁的部分；
 * - UI 层只负责渲染，避免把"哪个会话属于哪个项目"再算第二遍（历史上前端手写过
 *   一份前缀匹配，与后端 `projects` 域判定分叉过）。
 */

export interface ProjectGroupProject {
  id: string;
  name: string;
  /** 项目绑定物理路径（可能是 null = 仅逻辑项目） */
  primary_path?: string | null;
  updated_at?: number | null;
}

export interface ProjectGroupSession {
  id: string;
  /** 会话创建时冻结的工作目录 */
  cwd?: string | null;
  title?: string | null;
  /** 最近活动（epoch 秒 / 毫秒自适应） */
  last_active?: number | null;
}

export interface SessionGroup<S extends ProjectGroupSession> {
  /** 项目 id；Home 兜底组为 `__home__` */
  key: string;
  label: string;
  /** 该组对应的物理根（Home 为 null） */
  root: string | null;
  /** 组内会话，按最近活动降序 */
  sessions: S[];
  isHome: boolean;
}

const HOME_KEY = '__home__';

/** Windows/POSIX 归一：小写 + 反斜杠 + 去尾分隔符 */
export function normalizeGroupPath(p: string | null | undefined): string {
  if (!p) return '';
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** `child` 是否位于 `root` 之下（路径边界感知：`C:\projAB` 不属于 `C:\proj`） */
export function isPathWithin(child: string | null | undefined, root: string | null | undefined): boolean {
  const c = normalizeGroupPath(child);
  const r = normalizeGroupPath(root);
  if (!c || !r) return false;
  return c === r || c.startsWith(`${r}\\`);
}

function activityValue(v: number | null | undefined): number {
  if (!v || v <= 0) return 0;
  return v > 1e12 ? v : v * 1000; // 秒 / 毫秒自适应
}

/**
 * 按项目分组。
 *
 * - 归属判定：会话 `cwd` 落在项目 `primary_path` 之下（**最长前缀**优先，避免嵌套项目错配）；
 * - 无 `cwd` / 不属于任何项目 → `Home` 兜底组（恒存在，即使为空）；
 * - 组排序：有会话的项目按"组内最新活动"降序，空项目按 `updated_at` 降序，Home 恒在末尾；
 * - 组内排序：`last_active` 降序（会话行 = 聊天行，最近说话的在最上面）。
 */
export function groupSessionsByProject<S extends ProjectGroupSession>(
  sessions: S[],
  projects: ProjectGroupProject[],
  homeLabel = 'Home',
): SessionGroup<S>[] {
  const projectGroups = new Map<string, SessionGroup<S>>();
  for (const p of projects) {
    projectGroups.set(p.id, {
      key: p.id,
      label: p.name,
      root: p.primary_path ?? null,
      sessions: [],
      isHome: false,
    });
  }
  const home: SessionGroup<S> = { key: HOME_KEY, label: homeLabel, root: null, sessions: [], isHome: true };

  // 路径 → 项目（按 root 长度降序，保证最长前缀优先）
  const roots = projects
    .filter((p): p is ProjectGroupProject & { primary_path: string } => !!p.primary_path)
    .map((p) => ({ id: p.id, root: p.primary_path }))
    .sort((a, b) => normalizeGroupPath(b.root).length - normalizeGroupPath(a.root).length);

  for (const s of sessions) {
    const hit = roots.find((r) => isPathWithin(s.cwd, r.root));
    const group = hit ? projectGroups.get(hit.id) : undefined;
    (group ?? home).sessions.push(s);
  }

  const byActivity = (a: S, b: S) => activityValue(b.last_active) - activityValue(a.last_active);
  for (const g of projectGroups.values()) g.sessions.sort(byActivity);
  home.sessions.sort(byActivity);

  const projectUpdated = new Map(projects.map((p) => [p.id, activityValue(p.updated_at)]));
  const latestOf = (g: SessionGroup<S>) => (g.sessions.length ? activityValue(g.sessions[0].last_active) : 0);

  const ordered = [...projectGroups.values()].sort((a, b) => {
    const diff = latestOf(b) - latestOf(a);
    if (diff !== 0) return diff;
    // 空项目之间按项目自身更新时间降序
    return (projectUpdated.get(b.key) ?? 0) - (projectUpdated.get(a.key) ?? 0);
  });

  return [...ordered, home];
}

/** 总条目数（分组头 + 会话行）——用于"折叠后是否还值得渲染"这类判断 */
export function countGroupedSessions<S extends ProjectGroupSession>(groups: SessionGroup<S>[]): number {
  return groups.reduce((n, g) => n + g.sessions.length, 0);
}
