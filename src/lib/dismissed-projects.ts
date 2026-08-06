/**
 * 自动项目「从侧边栏移除」（dismiss）—— 对齐 Hermes $dismissedAutoProjectIds
 * (store/layout.ts persistentAtom)。
 *
 * 语义：自动项目由磁盘扫描派生（include_discovered），无 projects.db 记录；
 * dismiss 只是本地隐藏（不删后端、不删文件），对齐 Hermes dismissAutoProject。
 * 显式项目不使用本模块（用 projects.delete 删记录）。
 */

const KEY = 'eleve.dismissedAutoProjects.v1';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 存储不可用（隐私模式等）→ 静默降级（本次会话内仍生效于内存态）
  }
}

/** 已 dismiss 的自动项目 id 集合（同步读，渲染过滤用） */
export function getDismissedAutoProjectIds(): Set<string> {
  return new Set(read());
}

/** dismiss 一个自动项目（幂等；从侧边栏隐藏，不删文件/记录） */
export function dismissAutoProject(id: string): void {
  const ids = read();
  if (!ids.includes(id)) {
    write([...ids, id]);
  }
}
