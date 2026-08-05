/**
 * pty-manager — 交互式 PTY 前端生命周期管理
 * （对齐 Hermes terminalApi + PersistentTerminal "shell 存活于面板隐藏" 语义）
 *
 * 架构：PTY 生命周期与组件挂载解耦——
 * - live 映射（tabId → ptyId）为模块级单一权威源
 * - 全局监听 pty-output/pty-exited 一次，按 tabId 路由到挂载中的 xterm writer
 * - 视图挂载 = attach（接输出流）；卸载 = detach（shell 继续跑）
 * - 重挂载时由 reviveBuffer（xterm 序列化快照）恢复屏幕，live 输出接续
 *
 * 与 agent-terminal-stream 同构（writer 注册表模式），零新机制。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type Writer = (data: string) => void;

interface LivePty {
  ptyId: string;
  shell: string;
}

/** tabId → 存活 PTY */
const live = new Map<string, LivePty>();
/** ptyId → tabId（事件路由反查） */
const ptyToTab = new Map<string, string>();
/** tabId → 挂载中的 xterm writer */
const writers = new Map<string, Writer>();
/** tabId → shell 退出回调集合 */
const exitListeners = new Map<string, Set<(code: number | null) => void>>();

let listenerPromise: Promise<void> | null = null;

function ensureGlobalListeners(): Promise<void> {
  if (!listenerPromise) {
    listenerPromise = (async () => {
      await listen<{ id: string; data: string }>('pty-output', (e) => {
        const tabId = ptyToTab.get(e.payload.id);
        if (tabId) writers.get(tabId)?.(e.payload.data);
      });
      await listen<{ id: string; code: number | null }>('pty-exited', (e) => {
        const tabId = ptyToTab.get(e.payload.id);
        if (!tabId) return;
        live.delete(tabId);
        ptyToTab.delete(e.payload.id);
        exitListeners.get(tabId)?.forEach((cb) => cb(e.payload.code));
      });
    })();
  }
  return listenerPromise;
}

/** 确保 tab 有存活 PTY（无则启动）。返回是否新建 + shell 名 */
export async function ensurePtyForTab(
  tabId: string,
  cwd: string,
): Promise<{ created: boolean; shell: string }> {
  await ensureGlobalListeners();
  const existing = live.get(tabId);
  if (existing) return { created: false, shell: existing.shell };

  const res = await invoke<{ id: string; shell: string }>('pty_start', {
    cols: 80,
    rows: 24,
    cwd: cwd || null,
  });
  live.set(tabId, { ptyId: res.id, shell: res.shell });
  ptyToTab.set(res.id, tabId);
  return { created: true, shell: res.shell };
}

/** 视图挂载：接输出流；返回 detach（卸载时调用，shell 不杀） */
export function attachPtyWriter(tabId: string, writer: Writer): () => void {
  writers.set(tabId, writer);
  return () => {
    if (writers.get(tabId) === writer) writers.delete(tabId);
  };
}

/** 发送输入到 PTY（xterm onData） */
export async function writePtyInput(tabId: string, data: string): Promise<void> {
  const entry = live.get(tabId);
  if (!entry) return;
  try {
    await invoke('pty_write', { id: entry.ptyId, data });
  } catch {
    /* PTY 已退出 — exited 事件会驱动 tab 关闭 */
  }
}

/** 尺寸同步（xterm fit 后调用；去重由调用方 lastSize 负责） */
export async function resizePty(tabId: string, cols: number, rows: number): Promise<void> {
  const entry = live.get(tabId);
  if (!entry || cols <= 0 || rows <= 0) return;
  try {
    await invoke('pty_resize', { id: entry.ptyId, cols, rows });
  } catch { /* 忽略瞬时竞态 */ }
}

/** 销毁 tab 的 PTY（关闭 tab / 会话清理时） */
export async function disposePtyForTab(tabId: string): Promise<void> {
  const entry = live.get(tabId);
  live.delete(tabId);
  writers.delete(tabId);
  exitListeners.delete(tabId);
  if (entry) {
    ptyToTab.delete(entry.ptyId);
    try {
      await invoke('pty_dispose', { id: entry.ptyId });
    } catch { /* 可能已退出 */ }
  }
}

/** 订阅 shell 退出（对齐 Hermes onExit → drop the tab） */
export function onPtyExit(tabId: string, cb: (code: number | null) => void): () => void {
  let set = exitListeners.get(tabId);
  if (!set) {
    set = new Set();
    exitListeners.set(tabId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/** tab 是否有存活 PTY */
export function hasLivePty(tabId: string): boolean {
  return live.has(tabId);
}
