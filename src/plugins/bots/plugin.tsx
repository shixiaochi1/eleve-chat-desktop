/**
 * Bot Mode bundled plugin（stage-4——Bot Mode 前端从主代码迁 bundled 插件）。
 *
 * 🔴 2026-09-04 对齐 Hermes bot-mode 架构形态（hermes-bots = bundled plugin，
 * "Ships with the app; disable here if unwanted"）：插件 = default-export
 * ElevePlugin，经 scoped ctx 贡献注册（自动 provenance + id 命名空间化），
 * 从不直接碰 registry/主壳状态——宿主能力走 contrib/host 门。
 *
 * 本插件贡献：
 * - mainView（viewId='bots'）：Bot 花名册 + 群聊主区视图（BotsView 组件
 *   本体仍在 components/，迁 runtime-loader 时随插件整体搬移）
 * - iconBar.action：主区入口（替代原 IconBar 内置 bots 按钮）
 * - 跨网关 relay 两循环生命周期归插件（禁用插件 = relay 停——Desktop-as-router
 *   的开关随插件开关，与 Hermes startBotRelay/stopBotRelay 插件驱动同构）
 */
import { Bot } from 'lucide-react';

import BotsView from '../../components/BotsView';
import { getPluginHost } from '../../contrib/host';
import type { ElevePlugin, PluginContext } from '../../contrib/plugin';
import { startBotRelay, stopBotRelay } from '../../services/bot-relay';

/** 桥接层：host 门能力 → BotsView 回调 props（插件不碰 App 内部模块）。 */
function BotsViewShim() {
  return (
    <BotsView
      onOpenBotChat={(id) => getPluginHost()?.openSession(id)}
      onEditAgent={(profile) => getPluginHost()?.openAgentEditor(profile)}
      onPanelChange={(panel) => getPluginHost()?.setPanel(panel)}
    />
  );
}

const botsPlugin: ElevePlugin = {
  id: 'bots',
  name: 'Bot Mode',
  description: 'Bot 花名册 / 群聊主区视图 + 跨网关 DM relay 循环',
  register(ctx: PluginContext) {
    // 主区视图贡献（App.tsx 按 viewId='bots' 消费渲染）
    ctx.register('mainView', {
      id: 'bots-view',
      title: 'Bots',
      data: { viewId: 'bots', label: 'Bots', component: BotsViewShim },
    });

    // IconBar 入口（order: 35 = 原 IconBar 内置 bots 按钮的图标区位置；
    // 内置项已随迁移删除——禁用本插件即无 Bot Mode 入口）
    ctx.register('iconBar.action', {
      id: 'open-bots',
      title: '群聊',
      data: {
        icon: Bot,
        label: '群聊',
        order: 35,
        activate: () => getPluginHost()?.openView('bots'),
      },
    });

    // relay 两循环生命周期归插件（禁用 = 停；重载 = 重启）
    startBotRelay();
    ctx.onDispose(stopBotRelay);
  },
};

export default botsPlugin;
