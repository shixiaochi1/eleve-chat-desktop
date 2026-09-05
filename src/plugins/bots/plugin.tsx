/**
 * Bot Mode bundled plugin（stage-4——Bot Mode 前端从主代码迁 bundled 插件）。
 *
 * 🔴 2026-09-05 round-42：布局 1:1 对齐 Hermes Desktop hermes-bots（取证
 * roster-pane.tsx / canonical-chat.ts）——
 * - Bots 不是主区 tab，而是**左栏 pane**（Hermes: placement 'left' 260px，
 *   dock 进 sessions pane 的 zone → "SESSIONS | BOTS tab strip"；点击后
 *   主区不换内容）。ELEVE 映射 = SidePanel 的 'bots' panel（activePanel
 *   互斥切换为 tab strip 等价语义）
 * - 点 bot 行 → 主区打开 canonical Bot Chat（openSession in-place）
 * - 点群聊行 → 主区打开房间视图（mainView 'bots' 贡献）
 * 贡献面：
 * - sidePanel.pane：BotsPane（左栏花名册/群聊列表）
 * - mainView（viewId='bots'）：BotsRoomMainView（主区房间容器）
 * - iconBar.action：左栏入口（activate → setPanel('bots')）
 * - relay 两循环生命周期归插件（禁用插件 = relay 停）
 */
import { MessagesSquare } from 'lucide-react';

import BotsRoomMainView from '../../components/BotsView';
import BotsPane from '../../components/BotsPane';
import { getPluginHost } from '../../contrib/host';
import type { ElevePlugin, PluginContext } from '../../contrib/plugin';
import { startBotRelay, stopBotRelay } from '../../services/bot-relay';

/** 左栏 pane 桥接：host 门能力 → BotsPane 回调 props（插件不碰 App 内部模块）。 */
function BotsPaneShim() {
  return (
    <BotsPane
      onOpenBotChat={(id) => getPluginHost()?.openSession(id)}
      onOpenBotRoom={() => getPluginHost()?.openView('bots')}
      onEditAgent={(profile) => getPluginHost()?.openAgentEditor(profile)}
    />
  );
}

const botsPlugin: ElevePlugin = {
  id: 'bots',
  name: 'Bot Mode',
  description: 'Bots 左栏面板（花名册/群聊）+ 主区群聊房间视图 + 跨网关 DM relay 循环',
  register(ctx: PluginContext) {
    // 左栏 pane 贡献（SidePanel 按 activePanel='bots' 消费渲染）。
    // localId='bots'——registry 命名空间化后全 id='bots:bots'，
    // PluginPaneSlot 以 endsWith(':bots') 匹配 activePanel。
    ctx.register('sidePanel.pane', {
      id: 'bots',
      title: 'Bots',
      data: { component: BotsPaneShim },
    });

    // 主区视图贡献（点群聊行后承载房间视图）
    ctx.register('mainView', {
      id: 'bots-view',
      title: 'Bots',
      data: { viewId: 'bots', label: 'Bots', component: BotsRoomMainView },
    });

    // IconBar 入口：打开左栏 Bots 面板（主区不动——对齐 Hermes tab strip 语义）。
    // 🔴 round-53：图标定稿 MessagesSquare（多路消息气泡——群聊=多成员多路
    // 对话；UsersRound 与 AgentIcon(Users) 撞型，用户指示更换）
    ctx.register('iconBar.action', {
      id: 'open-bots',
      title: '群聊',
      data: {
        icon: MessagesSquare,
        label: '群聊',
        order: 25,
        activate: () => getPluginHost()?.setPanel('bots'),
      },
    });

    // relay 两循环生命周期归插件（禁用 = 停；重载 = 重启）
    startBotRelay();
    ctx.onDispose(stopBotRelay);
  },
};

export default botsPlugin;
