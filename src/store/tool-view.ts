/**
 * Tool view mode store — 对齐 Hermes store/tool-view.ts
 *
 * product（产品）: 隐藏原始工具数据，显示易读的工具活动与简洁摘要
 * technical（技术）: 显示完整原始输入/输出及底层细节
 *
 * 持久化键 'display.tool_view_mode'（沿用旧 AppearanceSettings 的键，
 * 存量用户选择不丢失）。useSyncExternalStore 模式与 store/terminals.ts 一致。
 */
import { useSyncExternalStore } from 'react';
import * as storage from '../utils/storage';

export type ToolViewMode = 'product' | 'technical';

const STORAGE_KEY = 'display.tool_view_mode';

function loadInitial(): ToolViewMode {
  // 默认技术模式（老大 2026-08-11：默认展示完整工具输入/输出）
  return storage.load(STORAGE_KEY, 'technical') === 'technical' ? 'technical' : 'product';
}

let mode: ToolViewMode = typeof window === 'undefined' ? 'technical' : loadInitial();
const listeners = new Set<() => void>();

export function getToolViewMode(): ToolViewMode {
  return mode;
}

export function setToolViewMode(next: ToolViewMode): void {
  if (mode === next) return;
  mode = next;
  storage.save(STORAGE_KEY, next);
  listeners.forEach(l => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useToolViewMode(): ToolViewMode {
  return useSyncExternalStore(subscribe, getToolViewMode, getToolViewMode);
}
