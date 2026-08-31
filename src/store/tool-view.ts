/**
 * Tool view mode store — 对齐 Hermes store/tool-view.ts
 *
 * product（产品）: 隐藏原始工具数据，显示易读的工具活动与简洁摘要
 * technical（技术）: 显示完整原始输入/输出及底层细节
 *
 * 持久化键 'display.tool_view_mode'（沿用旧 AppearanceSettings 的键，
 * 存量用户选择不丢失）。
 *
 * 🔴 2026-09-01 收敛：手写 listeners/emit/subscribe 样板 → lib/store-factory
 * createAtomStore（导出 API 签名不变，消费方零改动）。
 */
import { createAtomStore } from '../lib/store-factory';
import * as storage from '../utils/storage';

export type ToolViewMode = 'product' | 'technical';

const STORAGE_KEY = 'display.tool_view_mode';

function loadInitial(): ToolViewMode {
  // 默认技术模式（老大 2026-08-11：默认展示完整工具输入/输出）
  return storage.load(STORAGE_KEY, 'technical') === 'technical' ? 'technical' : 'product';
}

const store = createAtomStore<ToolViewMode>(typeof window === 'undefined' ? 'technical' : loadInitial());

export function getToolViewMode(): ToolViewMode {
  return store.get();
}

export function setToolViewMode(next: ToolViewMode): void {
  // set 返回"是否实际变更"——值没变不重复落盘
  if (store.set(next)) {
    storage.save(STORAGE_KEY, next);
  }
}

export function useToolViewMode(): ToolViewMode {
  return store.useAtom();
}
