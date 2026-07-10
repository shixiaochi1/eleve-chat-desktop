/**
 * Terminals store — 多 tab 终端状态管理
 *
 * 对齐 Hermes apps/desktop/src/app/right-sidebar/terminal/terminals.ts
 * Hermes 用 nanostores atom，Eleve 用 React useSyncExternalStore 模式。
 *
 * TerminalEntry.kind:
 *   - 'user': 交互式 PTY shell（用户手动创建）
 *   - 'agent': 只读镜像（terminal(background=true) 的进程输出）
 *
 * terminal.close 事件 → closeAgentTerminalByProc(processId) 关闭对应 agent tab
 */

// ── Types ──

export interface TerminalEntry {
  id: string;
  /** Display label */
  title: string;
  /** If true, title auto-adopts shell name until user renames */
  auto: boolean;
  /** Working directory (user tabs only) */
  cwd: string;
  /** 'user' = interactive shell, 'agent' = read-only process mirror */
  kind: 'user' | 'agent';
  /** Agent process id (agent tabs only) */
  procId?: string;
}

// ── State ──

let terminals: TerminalEntry[] = [];
let activeTerminalId: string | null = null;
let listeners: Array<() => void> = [];

function emitChange() {
  for (const l of listeners) l();
}

// ── Subscribe / GetSnapshot (for useSyncExternalStore) ──

export function subscribeTerminals(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => { listeners = listeners.filter(l => l !== listener); };
}

export function getTerminalsSnapshot(): readonly TerminalEntry[] {
  return terminals;
}

export function getActiveTerminalIdSnapshot(): string | null {
  return activeTerminalId;
}

// ── Helpers ──

function newId(): string {
  return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ── Actions ──

/** Create a new user terminal tab and focus it */
export function createTerminal(cwd: string = ''): string {
  const id = newId();
  terminals = [...terminals, { id, title: 'Terminal', auto: true, cwd, kind: 'user' }];
  activeTerminalId = id;
  emitChange();
  return id;
}

// Procs we've already surfaced a tab for — closing an agent tab shouldn't
// resurrect it on the next poll while the process is still running.
const surfacedProcs = new Set<string>();

/** Auto-surface an agent background process as a read-only tab — once.
 *  Returns the tab id, or null if already surfaced and user closed it. */
export function ensureAgentTerminal(procId: string, title: string): string | null {
  const existing = terminals.find(t => t.procId === procId);
  if (existing) return existing.id;
  if (surfacedProcs.has(procId)) return null;

  surfacedProcs.add(procId);
  const id = newId();
  terminals = [...terminals, { id, title: title || 'agent', auto: false, cwd: '', kind: 'agent', procId }];
  activeTerminalId = id;
  emitChange();
  return id;
}

/** Open + focus an agent process's tab, recreating if user had closed it */
export function openAgentTerminal(procId: string, title: string): void {
  surfacedProcs.add(procId);
  let id = terminals.find(t => t.procId === procId)?.id;
  if (!id) {
    id = newId();
    terminals = [...terminals, { id, title: title || 'agent', auto: false, cwd: '', kind: 'agent', procId }];
  }
  activeTerminalId = id;
  emitChange();
}

/** Guarantee at least one tab exists */
export function ensureTerminal(): void {
  if (terminals.length === 0) createTerminal();
}

/** Select a terminal tab */
export function selectTerminal(id: string): void {
  if (terminals.some(t => t.id === id)) {
    activeTerminalId = id;
    emitChange();
  }
}

/** Cycle active tab by direction (+1 next / -1 prev) */
export function cycleTerminal(direction: 1 | -1): void {
  if (terminals.length < 2) return;
  const current = Math.max(0, terminals.findIndex(t => t.id === activeTerminalId));
  activeTerminalId = terminals[(current + direction + terminals.length) % terminals.length].id;
  emitChange();
}

/** Drop a terminal tab. Focus slides to neighbor; closing last closes pane. */
export function closeTerminal(id: string): void {
  const index = terminals.findIndex(t => t.id === id);
  if (index < 0) return;
  const next = terminals.filter(t => t.id !== id);
  terminals = next;
  if (activeTerminalId === id) {
    activeTerminalId = (next[index] ?? next[index - 1])?.id ?? null;
  }
  emitChange();
}

/** Close the agent tab mirroring a background process.
 *  Called by terminal.close event handler.
 *  对齐 Hermes closeAgentTerminalByProc — process is NOT killed. */
export function closeAgentTerminalByProc(procId: string): boolean {
  const term = terminals.find(t => t.kind === 'agent' && t.procId === procId);
  if (!term) return false;
  closeTerminal(term.id);
  return true;
}

/** Close the active terminal tab */
export function closeActiveTerminal(): void {
  if (activeTerminalId) closeTerminal(activeTerminalId);
}

/** Rename a terminal tab */
export function renameTerminal(id: string, title: string): void {
  const trimmed = title.trim();
  terminals = terminals.map(t => t.id === id ? { ...t, title: trimmed || t.title, auto: false } : t);
  emitChange();
}

/** Report shell name — adopt as label only while auto=true */
export function reportTerminalShell(id: string, shell: string): void {
  const name = shell.trim();
  if (!name) return;
  terminals = terminals.map(t => t.id === id && t.auto ? { ...t, title: name } : t);
  emitChange();
}
