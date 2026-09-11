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
/**
 * 🔴 round-112：Agent 编辑面板的目标（对齐 Hermes `EditProfileDialog bot={RosterRow}`
 * ——那边**收整行**，因为整条编辑链要按 `requestForBot(bot, …)` 骑 owner 连接）。
 *
 * - `connectionId` 非空 = **远端 Agent**：编辑链全程路由到该连接；为空/缺省 =
 *   本机 profile（走主连接）。
 * - `displayName` / `color` / `avatarKey` = 该行的展示读数**种子**。宿主的
 *   `displayNames` / `agentColors` / `agentAvatarKeys` 三个映射只覆盖**本机**
 *   profile——远端行同名时若不传种子，面板会显示本机同名 profile 的昵称/颜色
 *   （round-111 那个"同名串台"的另一副面孔）。
 */
export interface AgentEditTarget {
  profile: string;
  connectionId?: string | null;
  displayName?: string | null;
  color?: string | null;
  avatarKey?: string | null;
}

export interface PluginHostCapabilities {
  /** 打开会话到主聊天区（对齐 Hermes host.openSession：宫格/Bots 视图先退
   *  + forceProfile 切换——实现由宿主注入） */
  openSession(sessionId: string): void;
  /** 主区导航（'single' | 'grid' | 'bots'…；插件贡献的 mainView viewId） */
  openView(viewId: string): void;
  /** 打开 Agent 编辑浮层（对齐 Hermes roster 右键 Edit Profile）。
   *  收 `AgentEditTarget`；传裸 profile 名 = 本机 Agent（兼容 ProfilePanel 路径）。 */
  openAgentEditor(target: AgentEditTarget | string): void;
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
