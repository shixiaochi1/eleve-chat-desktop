/**
 * Preview 脏标记 store — 移植 Hermes preview-edit.ts
 *
 * 文件预览内嵌编辑的未保存状态，按 target.url 键控：右栏 tab 渲染
 * VS Code 风格"已修改"圆点，无需把编辑状态穿透到 tab 条。
 * 唯一写入方 = PreviewFilePane（编辑态 + dirty）；唯一读取方 = PreviewTabBar。
 *
 * 存储模式对齐 ELEVE store/preview-console.ts：useSyncExternalStore +
 * 事件订阅，零新机制。
 */

import { useSyncExternalStore } from 'react';

let dirtyUrls: Record<string, boolean> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function setPreviewDirty(url: string, dirty: boolean): void {
  if (!url) return;
  if (dirty === Boolean(dirtyUrls[url])) return;
  if (dirty) {
    dirtyUrls = { ...dirtyUrls, [url]: true };
  } else {
    const next = { ...dirtyUrls };
    delete next[url];
    dirtyUrls = next;
  }
  emit();
}

export function isPreviewDirty(url: string): boolean {
  return Boolean(dirtyUrls[url]);
}

/** React 订阅（tab 条渲染圆点用） */
export function usePreviewDirty(url: string): boolean {
  return useSyncExternalStore(subscribe, () => isPreviewDirty(url));
}
