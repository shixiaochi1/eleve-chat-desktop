/**
 * orchestrationStore — 模块级共享编排配置/Profile 缓存
 *
 * 🔴 2026-08-16（第四轮审查 d2-3a/c）：主面板（独立窗口）与侧边栏面板双
 *   useKanban 实例此前各自持独立 useState——挂载时各拉一次、保存仅回填本
 *   实例，一侧编辑编排配置/Profile 描述后另一侧陈旧至重挂载（侧边栏消费
 *   profiles/resolvedDefaultAssignee 做默认负责人路由，陈旧会静默用旧
 *   负责人）。本 store 对齐 Hermes React Query 全局缓存语义
 *   （ORCHESTRATION_KEY useQuery + 保存后 invalidateQueries，
 *   orchestration.tsx:135-142——全 App 共享一份，跨组件一致）：
 *   - 内存共享 + subscribe：同窗口多实例即时跟随
 *   - localStorage 持久化 + storage 事件：跨窗口同步（对齐 boardStore
 *     的 $boardSlug 持久化模式；不同 BrowserWindow 是不同 JS 模块实例，
 *     只能经 storage 事件桥接）
 */

type ConfigListener = () => void;

interface SharedConfigState {
  orchestration: unknown;
  profiles: unknown[];
}

const STORAGE_KEY = 'eleve.kanban.orchestration';

let state: SharedConfigState = { orchestration: null, profiles: [] };

function loadFromStorage(): SharedConfigState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'orchestration' in parsed &&
      Array.isArray(parsed.profiles)
    ) {
      return parsed as SharedConfigState;
    }
    return null;
  } catch {
    return null;
  }
}

// 挂载即恢复持久化缓存（跨窗口新实例直接拿到另一窗口的编辑结果）
const persisted = loadFromStorage();
if (persisted) state = persisted;

const listeners = new Set<ConfigListener>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage 不可用时仅内存同步 */
  }
}

// 跨窗口：其他窗口的 localStorage 变更触发 storage 事件 → 刷新内存态并
// 广播给本窗口实例（本窗口自身写入不触发 storage 事件，无回环）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = loadFromStorage();
    if (next) {
      state = next;
      emit();
    }
  });
}

export function getSharedOrchestration(): unknown {
  return state.orchestration;
}

export function getSharedProfiles(): unknown[] {
  return state.profiles;
}

export function setSharedOrchestration(o: unknown): void {
  state = { ...state, orchestration: o };
  persist();
  emit();
}

export function setSharedProfiles(p: unknown[]): void {
  state = { ...state, profiles: p };
  persist();
  emit();
}

/** 订阅共享配置变化，返回取消订阅函数 */
export function subscribeSharedConfig(l: ConfigListener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
