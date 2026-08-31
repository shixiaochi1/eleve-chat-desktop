/**
 * store-factory — 模块级原子 store 工厂（🔴 2026-09-01 收敛，审查：手写样板 ×14）
 *
 * 背景：项目内 `Set + emit + subscribe + useSyncExternalStore` 的模块级单例
 * store 样板被手抄了 14 份、3 种变体（Set/Array/带参 listener）。本工厂把
 * 该模式收敛为单一实现，消灭复制粘贴；消费方 API（导出的 getter/setter/hook
 * 签名）保持不变，逐步迁移。
 *
 * 迁移边界（2026-09-01）：
 * - ✅ 已迁移（标准无参变体）：store/tool-view、lib/terminal-injection、
 *   lib/preview-edit、lib/workspace-events、store/display-settings、store/debug
 * - ❌ 保留手写（特殊结构，迁移无净收益）：
 *   - store/messages（双监听集 + MessageChannel flush 工程，教科书级实现勿动）
 *   - store/session-status（轮询状态机）、store/terminals（Array listeners 变体）
 *   - utils/notifications（slice 语义）、components/kanban/boardStore（带参 listener）
 *   - store/preview-console（已有本地工厂封装）
 * 其余新 store 一律用本工厂，禁止再手抄样板。
 */

import { useSyncExternalStore } from 'react';

export interface AtomStore<T> {
  /** 读取当前值（同步，模块级单例语义） */
  get(): T;
  /**
   * 更新值并通知订阅者。
   * @returns 是否实际发生变更（next !== prev 且未被 skip 短路）——
   *   供调用方决定是否执行副作用（如持久化），避免"值没变也写盘"。
   */
  set(updater: T | ((prev: T) => T)): boolean;
  /** 原生订阅（非 React 消费方 / useSyncExternalStore 手工接线用）。返回注销函数 */
  subscribe(listener: () => void): () => void;
  /** React 全值订阅（snapshot = 值本身；调用方保证值语义未变时不 set） */
  useAtom(): T;
  /**
   * React 选择订阅（ primitive / 稳定引用选择器）。
   * ⚠️ selector 必须返回 primitive 或缓存过的稳定引用——返回每次新建的对象
   * 会破坏 useSyncExternalStore 的 snapshot 稳定性 → 无限重渲染。
   */
  useSelector<S>(selector: (value: T) => S): S;
}

/**
 * 创建模块级原子 store。
 * @param initial 初始值
 * @param options.skip 可选短路谓词：返回 true 时本次 set 被忽略（值语义未变）。
 *   典型场景：结构化值的部分字段不变即视为未变（primitive 值由内置 next !== prev 覆盖）。
 */
export function createAtomStore<T>(
  initial: T,
  options?: { skip?: (next: T, prev: T) => boolean },
): AtomStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const skip = options?.skip;

  const get = (): T => value;

  const set = (updater: T | ((prev: T) => T)): boolean => {
    const next = typeof updater === 'function' ? (updater as (prev: T) => T)(value) : updater;
    if (next === value) return false;
    if (skip?.(next, value)) return false;
    value = next;
    listeners.forEach((l) => l());
    return true;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // 闭包风格实现（无 this 依赖）：subscribe/get 可安全作为引用传给
  // useSyncExternalStore，不必担心方法解绑。
  const useAtom = (): T => useSyncExternalStore(subscribe, get, get);

  const useSelector = <S>(selector: (value: T) => S): S =>
    useSyncExternalStore(
      subscribe,
      () => selector(get()),
      () => selector(get()),
    );

  return { get, set, subscribe, useAtom, useSelector };
}
