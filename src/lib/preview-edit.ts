/**
 * Preview 脏标记 store — 移植 Hermes preview-edit.ts
 *
 * 文件预览内嵌编辑的未保存状态，按 target.url 键控：右栏 tab 渲染
 * VS Code 风格"已修改"圆点，无需把编辑状态穿透到 tab 条。
 * 唯一写入方 = PreviewFilePane（编辑态 + dirty）；唯一读取方 = PreviewTabBar。
 *
 * 🔴 2026-09-01 收敛：手写 listeners/emit/subscribe 样板 → lib/store-factory
 * createAtomStore（导出 API 签名不变，消费方零改动）。
 */

import { createAtomStore } from './store-factory';

const store = createAtomStore<Record<string, boolean>>({});

export function setPreviewDirty(url: string, dirty: boolean): void {
  if (!url) return;
  if (dirty === Boolean(store.get()[url])) return;
  store.set((prev) => {
    const next = { ...prev };
    if (dirty) {
      next[url] = true;
    } else {
      delete next[url];
    }
    return next;
  });
}

export function isPreviewDirty(url: string): boolean {
  return Boolean(store.get()[url]);
}

/** React 订阅（tab 条渲染圆点用） */
export function usePreviewDirty(url: string): boolean {
  return store.useSelector((dirtyUrls) => Boolean(dirtyUrls[url]));
}
