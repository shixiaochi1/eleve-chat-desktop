/**
 * 贡献注册表 —— 插件底座的核心原语（对齐 Hermes contrib/registry.ts）。
 *
 * 递归 area 场景图：area id 用命名空间点号串（'iconBar.action'、'mainView'、
 * 'chatEmpty'……），宿主与插件都只跟 registry 打交道，互相零 import。
 *
 * 🔴 area 级失效：mutate 一个 area 只清该 area 的快照、只通知该 area 的
 * 订阅者——注册一个 iconBar 按钮绝不会重渲染 mainView。全局通道仅供
 * 引擎类消费者（当前无）使用。
 *
 * 快照按 area 缓存、仅 mutation 时失效——useSyncExternalStore 的
 * getSnapshot 引用稳定，无渲染循环。
 */

import type { ReactNode } from 'react';

/** 一条贡献。source/id 由 PluginContext 宿主写入（插件作者不可见），
 *  core 内置贡献直接以 source='core'、id=语义 id 注册。 */
export interface Contribution<TData = unknown> {
  /** 贡献来源：'core' 或 'plugin:<pluginId>' */
  source: string;
  /** core = 语义 id；插件 = '<pluginId>:<localId>' */
  id: string;
  title?: string;
  /** area 特定载荷（各 area 的 data 接口见 areas.ts） */
  data?: TData;
  /** area 支持 render 型贡献时的渲染函数（iconBar.action 用 data 而非 render） */
  render?: () => ReactNode;
}

type Listener = () => void;

class ContributionRegistry {
  private byArea = new Map<string, Contribution[]>();
  private snapshot = new Map<string, readonly Contribution[]>();
  private areaListeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();

  /** 注册一条贡献（重复 id 覆盖——重装载语义：同 id 先 dispose 后重注册）。 */
  register<T>(area: string, contribution: Contribution<T>): void {
    const list = this.byArea.get(area) ?? [];
    const idx = list.findIndex(c => c.id === contribution.id);
    if (idx >= 0) list[idx] = contribution;
    else list.push(contribution);
    this.byArea.set(area, list);
    this.invalidate(area);
  }

  registerMany<T>(area: string, contributions: Contribution<T>[]): void {
    for (const c of contributions) this.register(area, c);
  }

  /** 移除某来源的全部贡献（插件禁用/卸载；area 级失效逐 area 触发）。 */
  removeBySource(source: string): void {
    for (const area of [...this.byArea.keys()]) {
      const list = this.byArea.get(area)!;
      const next = list.filter(c => c.source !== source);
      if (next.length !== list.length) {
        if (next.length === 0) this.byArea.delete(area);
        else this.byArea.set(area, next);
        this.invalidate(area);
      }
    }
  }

  /** 某 area 的贡献快照（引用稳定；未注册 area 返回空冻结数组）。 */
  getArea<T = unknown>(area: string): readonly Contribution<T>[] {
    let snap = this.snapshot.get(area);
    if (!snap) {
      snap = Object.freeze([...(this.byArea.get(area) ?? [])]);
      this.snapshot.set(area, snap);
    }
    return snap as readonly Contribution<T>[];
  }

  /** area 级订阅（useContributions 用）。 */
  subscribeArea(area: string, listener: Listener): () => void {
    let set = this.areaListeners.get(area);
    if (!set) {
      set = new Set();
      this.areaListeners.set(area, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.areaListeners.delete(area);
    };
  }

  /** 全局订阅（引擎类消费者；每次 mutation 都触发）。 */
  subscribe(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private invalidate(area: string): void {
    this.snapshot.delete(area);
    this.areaListeners.get(area)?.forEach(fn => fn());
    this.globalListeners.forEach(fn => fn());
  }
}

/** 全局唯一注册表。core 内置贡献与插件贡献同表——自洽性保证：
 *  IconBar 等宿主消费点不区分来源。 */
export const registry = new ContributionRegistry();

// 鈹€鈹€ React 缁戝畾 鈹€鈹€

import { useSyncExternalStore } from 'react';

/** 璁㈤槄鏌?area 鐨勮础鐚紙area 绾ч噸娓叉煋锛涘揩鐓у紩鐢ㄧǔ瀹氾級銆?*/
export function useContributions<T = unknown>(area: string): readonly Contribution<T>[] {
  return useSyncExternalStore(
    l => registry.subscribeArea(area, l),
    () => registry.getArea<T>(area),
    () => registry.getArea<T>(area),
  );
}
