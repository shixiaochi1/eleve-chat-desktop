/**
 * bundled 鎻掍欢鍙戠幇涓庤杞藉紩鎿庯紙瀵归綈 Hermes discoverBundledPlugins 绮剧畝鐗堬級銆? *
 * 鎻掍欢浣滆€咃細鍦?src/plugins/<name>/plugin.tsx 鍐?default-export ElevePlugin锛? * 鐒跺悗鎶?import 鍔犺繘涓嬫柟 BUNDLED 鏁扮粍鈥斺€斾粎姝や竴姝ワ紝鏃?registry 缂栬緫銆? *
 * 瑁呰浇娴佺▼锛歟nabled(榛戝悕鍗曞弽鎺? 鈫?createPluginContext 鈫?plugin.register(ctx)
 * 鈫?publishPlugin 鐧昏銆傜鐢ㄥ垏鎹細disposePlugin锛堣础鐚Щ闄?+ dispose 鍥炶皟锛? * 鎴栭噸瑁呰浇锛堝厛鍗歌浇鍐?register锛夈€? */

import type { ElevePlugin } from './plugin';
import { createPluginContext, disposePlugin } from './plugin';
import { isPluginEnabled, publishPlugin, setPluginReloadHandler } from './plugins-store';

import canvasPlugin from '../plugins/canvas/plugin';
import helloPlugin from '../plugins/hello/plugin';

/** bundled 鎻掍欢娓呭崟锛堟柊澧炴彃浠讹細import + 鏁扮粍杩藉姞锛?*/
const BUNDLED: ElevePlugin[] = [canvasPlugin, helloPlugin];

function loadOne(plugin: ElevePlugin): void {
  const ctx = createPluginContext(plugin);
  plugin.register(ctx);
  publishPlugin({
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
  });
}

function unloadOne(pluginId: string): void {
  disposePlugin(pluginId);
}

/** 搴旂敤鍚姩鏃惰皟鐢ㄤ竴娆★紙main.tsx锛汻eact 娓叉煋鍓嶅悓姝ユ敞鍐岃础鐚級銆?*/
export function initializePlugins(): void {
  setPluginReloadHandler((id, enabled) => {
    const plugin = BUNDLED.find(p => p.id === id);
    if (!plugin) return;
    if (enabled) loadOne(plugin);
    else unloadOne(id);
  });

  for (const plugin of BUNDLED) {
    if (isPluginEnabled(plugin.id)) {
      loadOne(plugin);
    } else {
      // disabled plugins are registered too (visible in settings)
      publishPlugin({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
      });
    }
  }
}
