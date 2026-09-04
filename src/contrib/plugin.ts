/**
 * 鎻掍欢浣滆€呭绾︼紙瀵归綈 Hermes contrib/plugin.ts 鐨?ELEVE 绮剧畝鐗堬級銆? *
 * 鎻掍欢 default-export 涓€涓?ElevePlugin锛?*浠庝笉鐩存帴纰?registry**鈥斺€? * 瀹冩帴鏀?scoped PluginContext锛歝tx.register 鑷姩鎵?provenance
 * (source: plugin:<id>) 骞舵妸 contribution id 鍛藉悕绌洪棿鍖栦负
 * <pluginId>:<localId>鈥斺€旀彃浠堕棿鍐茬獊鍦ㄦ満鍒朵笂涓嶅彲鑳姐€? *
 * PluginStorage锛歟leve.plugin.<id>. 鍓嶇紑 JSON 鎸佷箙鍖栵紙鍛藉悕绌洪棿浜掍笉璇诲啓锛夈€? *
 * bundled 闃舵璇存槑锛氭彃浠朵笌涓诲３鍚?bundle锛岀洿鎺?import 涓诲３鍐呴儴妯″潡鎶€鏈笂
 * 鍙浣嗙牬鍧忓绾︹€斺€旈€氫俊璧?ctx锛坮pc/notify锛夈€俽untime ESM 鎻掍欢鍔犺浇鍣? * 锛堝鏍?Hermes runtime-loader锛変负涓嬩竴闃舵锛屾鍗虫帴缂濄€? */

import type { ReactNode } from 'react';
import { registry } from './registry';

/** 鎻掍欢鍙敤鐨勫懡鍚嶇┖闂村寲鎸佷箙瀛樺偍銆?*/
export interface PluginStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

/** 鎻掍欢浣滆€呭啓璐＄尞鏃剁殑褰㈢姸鈥斺€攕ource 涓?id 鍓嶇紑鐢卞涓绘墦涓婏紝浣滆€呬笉濉€?*/
export interface PluginContributionInput {
  id: string;
  title?: string;
  data?: unknown;
  render?: () => unknown;
}

/** 浜ょ粰鎻掍欢 register() 鐨勪綔鐢ㄥ煙涓婁笅鏂囥€?*/
export interface PluginContext {
  readonly pluginId: string;
  register(area: string, contribution: PluginContributionInput): void;
  registerMany(area: string, contributions: PluginContributionInput[]): void;
  storage: PluginStorage;
  rpc: (cmd: string, params?: Record<string, unknown>) => Promise<unknown>;
  notify: {
    info: (message: string, title?: string) => void;
    error: (err: unknown, title?: string) => void;
  };
  onDispose(fn: () => void): void;
}

/** 鎻掍欢瀹氫箟锛坉efault export 褰㈢姸锛夈€?*/
export interface ElevePlugin {
  id: string;
  name: string;
  description?: string;
  defaultEnabled?: boolean;
  register(ctx: PluginContext): void;
}

/** 鎻掍欢 id 鈫?dispose 鍥炶皟锛堝紩鎿庣鐢?閲嶈浇鏃舵墽琛岋級銆?*/
export const disposalsMap = new Map<string, Array<() => void>>();

function createPluginStorage(pluginId: string): PluginStorage {
  const prefix = 'eleve.plugin.' + pluginId + '.';
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = localStorage.getItem(prefix + key);
        if (raw === null) return fallback;
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown): void {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch {
        /* 閰嶉婊?闅愮妯″紡锛氶潤榛橀檷绾э紙鍐呭瓨鎬佷粛鍦級 */
      }
    },
    remove(key: string): void {
      localStorage.removeItem(prefix + key);
    },
  };
}

/** 瀹夸富鏋勯€犱綔鐢ㄥ煙涓婁笅鏂囷紙plugins.ts 寮曟搸涓撶敤锛涙彃浠朵綔鑰呬笉鐩存帴璋冿級銆?*/
export function createPluginContext(plugin: ElevePlugin): PluginContext {
  const source = 'plugin:' + plugin.id;
  const disposals: Array<() => void> = [];
  disposalsMap.set(plugin.id, disposals);

  const scope = (localId: string) => plugin.id + ':' + localId;

  return {
    pluginId: plugin.id,
    register(area: string, contribution: PluginContributionInput): void {
      registry.register(area, {
        source,
        id: scope(contribution.id),
        title: contribution.title,
        data: contribution.data,
        render: contribution.render as (() => ReactNode) | undefined,
      });
    },
    registerMany(area: string, contributions: PluginContributionInput[]): void {
      for (const c of contributions) this.register(area, c);
    },
    storage: createPluginStorage(plugin.id),
    rpc: (cmd, params) => {
      // lazy import: bridge not touched in plain-browser mode
      return import('../utils/bridge').then(m => m.call(cmd, params ?? {}) as Promise<unknown>);
    },
    notify: {
      info: (message, title) => {
        void import('../utils/notifications').then(m => m.notifyInfo(message, title));
      },
      error: (err, title) => {
        void import('../utils/notifications').then(m => m.notifyError(err, title ?? 'Plugin error'));
      },
    },
    onDispose(fn: () => void): void {
      disposals.push(fn);
    },
  };
}

/** 绉婚櫎鎻掍欢鍏ㄩ儴璐＄尞骞舵墽琛?dispose锛坧lugins.ts 绂佺敤/鍗歌浇鏃惰皟鐢級銆?*/
export function disposePlugin(pluginId: string): void {
  registry.removeBySource('plugin:' + pluginId);
  const disposals = disposalsMap.get(pluginId);
  if (disposals) {
    for (const fn of [...disposals].reverse()) fn();
    disposalsMap.delete(pluginId);
  }
}
