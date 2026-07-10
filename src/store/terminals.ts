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
 * 持久化：复用 src/utils/storage.ts（IPC 文件存储），对齐 Hermes readKey/writeKey
 * reviveBuffer: xterm scrollback 序列化，跨重启重放（对齐 Hermes MAX_REVIVE_BUFFER_CHARS=48000）
 *
 * terminal.close 事件 → closeAgentTerminalByProc(processId) 关闭对应 agent tab
 */

import * as storage from '../utils/storage';

// ── Types ──

export interface TerminalEntry {
  id: string;
  /** Display label */
  title: string;
  /** If true, title auto-adopts shell name until user renames */
  auto: boolean;
  /** Working directory (user tabs only) */
  cwd: string;
  /** Serialized xterm scrollback from last session, replayed on relaunch.
   *  对齐 Hermes: VS Code parity — processes NOT revived, fresh shell under restored buffer.
   *  Captured live for user tabs only; agent mirrors stay runtime-only. */
  reviveBuffer?: string;
  /** 'user' = interactive shell, 'agent' = read-only process mirror */
  kind: 'user' | 'agent';
  /** Agent process id (agent tabs only) */
  procId?: string;
}

// ── Persistence ──
// 对齐 Hermes: TERMINALS_STORAGE_KEY = 'hermes.desktop.terminals.v1'

const TERMINALS_STORAGE_KEY = 'eleve.desktop.terminals.v1';
const MAX_REVIVE_BUFFER_CHARS = 48_000; // 对齐 Hermes

interface PersistedTerminalEntry {
  auto: boolean;
  cwd: string;
  id: string;
  reviveBuffer?: string;
  title: string;
}

interface PersistedTerminalState {
  activeTerminalId: string | null;
  terminals: PersistedTerminalEntry[];
}

function sanitizePersistedTerminal(value: unknown): PersistedTerminalEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const cwd = typeof record.cwd === 'string' ? record.cwd : '';
  const reviveBuffer = typeof record.reviveBuffer === 'string' ? record.reviveBuffer : undefined;
  if (!id) return null;
  return {
    auto: typeof record.auto === 'boolean' ? record.auto : true,
    cwd,
    id,
    ...(reviveBuffer ? { reviveBuffer } : {}),
    title: title || 'Terminal',
  };
}

function loadPersistedTerminals(): PersistedTerminalState {
  const fallback: PersistedTerminalState = { activeTerminalId: null, terminals: [] };
  const raw = storage.load(TERMINALS_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = raw as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    const terminals = Array.isArray(parsed.terminals)
      ? (parsed.terminals as unknown[]).map(sanitizePersistedTerminal).filter((t): t is PersistedTerminalEntry => Boolean(t))
      : [];
    const active =
      typeof parsed.activeTerminalId === 'string' && terminals.some(t => t.id === parsed.activeTerminalId)
        ? parsed.activeTerminalId
        : (terminals[0]?.id ?? null);
    return { activeTerminalId: active, terminals };
  } catch {
    return fallback;
  }
}

/** Persist synchronously on every change (对齐 Hermes: app-wide convention).
 *  Only user tabs are persisted (agent tabs are runtime-only). */
function persistTerminals(list: readonly TerminalEntry[], activeId: string | null): void {
  const terminals = list
    .filter(t => t.kind === 'user')
    .map(t => ({
      auto: t.auto,
      cwd: t.cwd,
      id: t.id,
      ...(t.reviveBuffer ? { reviveBuffer: t.reviveBuffer } : {}),
      title: t.title,
    }));
  if (!terminals.length) {
    storage.remove(TERMINALS_STORAGE_KEY);
    return;
  }
  const active = terminals.some(t => t.id === activeId) ? activeId : (terminals[0]?.id ?? null);
  storage.save(TERMINALS_STORAGE_KEY, { activeTerminalId: active, terminals });
}

// ── State ──

const restored = loadPersistedTerminals();

let terminals: TerminalEntry[] = restored.terminals.map(t => ({ ...t, kind: 'user' as const }));
let activeTerminalId: string | null = restored.activeTerminalId;
let listeners: Array<() => void> = [];

function emitChange() {
  persistTerminals(terminals, activeTerminalId);
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

/** Record the latest serialized scrollback for a tab so it can be replayed on
 *  the next launch. Oversized buffers are tail-trimmed to stay under the storage
 *  budget; only user tabs ever carry one.
 *  对齐 Hermes updateTerminalReviveBuffer */
export function updateTerminalReviveBuffer(id: string, reviveBuffer: string): void {
  const capped = reviveBuffer.length > MAX_REVIVE_BUFFER_CHARS
    ? reviveBuffer.slice(-MAX_REVIVE_BUFFER_CHARS)
    : reviveBuffer;
  terminals = terminals.map(t => t.id === id && t.kind === 'user' ? { ...t, reviveBuffer: capped } : t);
  emitChange();
}
