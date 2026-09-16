/**
 * Bot Mode bundled plugin。
 *
 * 🔴 2026-09-17 round-116 P5（Agent 面板整合收尾）：**群聊 + 私聊已并入 Agent 侧边页**
 * （`components/AgentsPanel.tsx` 第③段），故左侧工具栏的「群聊」入口与左栏 Bots pane
 * **一并退役**——旧面板（`components/BotsPane.tsx`）已删除。
 *
 * 本插件现存贡献面（仅此两项）：
 * - **mainView（viewId='bots'）**：主区房间视图容器（点群聊行后承载）+ 远端私聊视图
 * - **relay 两循环生命周期**：bot 间私信投递/回信收割（禁用插件 = relay 停；重载 = 重启）
 *
 * 已移除：
 * - `sidePanel.pane`（旧左栏 Bots pane）—— 职责已由 Agent 面板第③段承担
 *   （群聊分组 = RoomListSection；私聊分组 = PrivateChatSection）
 * - `iconBar.action`（左侧工具栏「群聊」按钮）—— 老大 2026-09-16 定案取消；
 *   进房间视图的入口 = Agent 面板里的群聊行（选中房间 + openView('bots')）
 *
 * 对齐 Hermes 的形态差异（刻意）：Hermes 的 Bots 是左栏 tab strip 的一个 pane；
 * ELEVE 收敛为"Agent 面板一个面包含三段"（卡片 / 项目 / 群聊+私聊），
 * 因为 ELEVE 的 Agent 卡片本身就是 Hermes rail 的等价物（点卡片切身份），
 * 把 Bot Mode 的两个面并进同一个侧边页才不产生"两处 agent 列表"。
 */
import BotsRoomMainView from '../../components/BotsView';
import type { ElevePlugin, PluginContext } from '../../contrib/plugin';
import { startBotRelay, stopBotRelay } from '../../services/bot-relay';

const botsPlugin: ElevePlugin = {
  id: 'bots',
  name: 'Bot Mode',
  description: '主区群聊房间视图（Agent 面板的群聊行承载入口）+ 跨网关 DM relay 循环',
  register(ctx: PluginContext) {
    // 主区视图贡献（点群聊行后承载房间视图；远端私聊视图也挂在这个视图容器下）
    ctx.register('mainView', {
      id: 'bots-view',
      title: 'Bots',
      data: { viewId: 'bots', label: 'Bots', component: BotsRoomMainView },
    });

    // relay 两循环生命周期归插件（禁用 = 停；重载 = 重启）
    startBotRelay();
    ctx.onDispose(stopBotRelay);
  },
};

export default botsPlugin;
