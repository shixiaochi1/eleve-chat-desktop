/**
 * 🔴 2026-09-04 插件宿主门（stage-4，对齐 Hermes plugin SDK 的 host.* 方法组
 * 的 ELEVE 精简版）。插件经此访问主壳能力——**永不 import App 内部模块**。
 *
 * 晚绑定：宿主（App.tsx）mount 时 setPluginHost() 注入能力，卸载时置 null；
 * 插件侧 getPluginHost() 为 null = 宿主未就绪，操作静默降级（插件不得假设
 * 宿主存在——canvas 先例：plain-browser 模式下 bridge 都不触碰）。
 *
 * 面当前仅 4 能力（bots 插件所需）；后续插件需要新能力时在此扩接口，
 * 载荷类型收敛到各 area 定义（contrib/areas.ts）。
 */
export interface PluginHostCapabilities {
  /** 打开会话到主聊天区（对齐 Hermes host.openSession：宫格/Bots 视图先退
   *  + forceProfile 切换——实现由宿主注入） */
  openSession(sessionId: string): void;
  /** 主区导航（'single' | 'grid' | 'bots'…；插件贡献的 mainView viewId） */
  openView(viewId: string): void;
  /** 打开 Agent 编辑浮层（对齐 Hermes roster 右键 Edit Profile） */
  openAgentEditor(profile: string): void;
  /** 侧栏面板切换（Bots 视图"Agent 不足"引导跳转 Agent 页） */
  setPanel(panel: string | null): void;
}

let host: PluginHostCapabilities | null = null;

export function setPluginHost(capabilities: PluginHostCapabilities | null): void {
  host = capabilities;
}

export function getPluginHost(): PluginHostCapabilities | null {
  return host;
}
