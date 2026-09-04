/**
 * 鎻掍欢搴曞骇缁熶竴鍑哄彛銆備富澹虫秷璐?useContributions/areas锛涙彃浠朵綔鑰?import
 * { ElevePlugin, PluginContext } 瀹氫箟鎻掍欢锛堟湭鏉?runtime 鍔犺浇鍣ㄥ鐢ㄥ悓濂戠害锛夈€? */
export { registry, useContributions, type Contribution } from './registry';
export { AREA_CHAT_EMPTY, AREA_ICON_BAR_ACTION, AREA_MAIN_VIEW, type IconBarActionData, type MainViewData } from './areas';
export { createPluginContext, disposePlugin, type ElevePlugin, type PluginContext, type PluginContributionInput, type PluginStorage } from './plugin';
export { publishPlugin, setPluginEnabled, setPluginReloadHandler, usePluginRecords, type PluginRecord } from './plugins-store';
export { initializePlugins } from './plugins';
