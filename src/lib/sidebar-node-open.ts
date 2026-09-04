/**
 * 侧边栏节点展开/折叠持久化（对齐 Hermes $sidebarWorkspaceNodeOpen persistentAtom）
 *
 * 语义：存用户显式选择后的 RESOLVED boolean（id → true/false）；
 * absent → 跟随调用方 defaultOpen。不存 XOR（Hermes 踩过坑：默认值翻转时
 * XOR 会反转用户意图——如空 worktree lane 默认折叠、有会话后默认展开）。
 */
import { useCallback, useState, useSyncExternalStore } from 'react';

const KEY = 'eleve.sidebarWorkspaceNodeOpen.v1';

let store: Record<string, boolean> = read();
const listeners = new Set<() => void>();

function read(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return Object.fromEntries(
      Object.entries(obj).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'),
    );
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 存储不可用 → 静默降级（本次会话内存态仍生效）
  }
}

function set(id: string, open: boolean): void {
  if (store[id] === open) return;
  store = { ...store, [id]: open };
  persist();
  listeners.forEach(l => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function getSnapshot(): Record<string, boolean> {
  return store;
}

/** 节点解析后的展开状态（absent → defaultOpen） */
export function workspaceNodeOpen(id: string, defaultOpen = true): boolean {
  return store[id] ?? defaultOpen;
}

/** 强制开/关（稳定跨默认翻转） */
export function setWorkspaceNodeOpen(id: string, open: boolean): void {
  set(id, open);
}

/** 切换（相对当前解析态） */
export function toggleWorkspaceNodeOpen(id: string, defaultOpen = true): void {
  set(id, !workspaceNodeOpen(id, defaultOpen));
}

/** React hook：订阅展开状态变化 */
export function useWorkspaceNodeOpen(id: string, defaultOpen = true): [boolean, () => void] {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const toggle = useCallback(() => toggleWorkspaceNodeOpen(id, defaultOpen), [id, defaultOpen]);
  return [state[id] ?? defaultOpen, toggle];
}

/** React hook：整表订阅（动态 id 列表场景——Review 文件树的目录展开态；
 *  解析语义同 workspaceNodeOpen：absent → defaultOpen 由消费方处理） */
export function useWorkspaceNodeOpenMap(): Record<string, boolean> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
