/**
 * PrivateChatRow — Agent 面板「③群聊 + 私聊区」中**私聊分组的行**。
 *
 * 🔴 round-116 P2：本组件与 `components/BotsView.tsx` 的 `BotRosterRow` 是
 * **同一个实现**（单份），此处只做两件事：
 *   1. 给"私聊分组"一个稳定、语义清晰的导入路径；
 *   2. 把"行点击 = 打开该 Agent 的常驻私聊"这一语义在命名上显式化。
 *
 * 为什么不在这里复制一份渲染：
 *   跨连接同名行的定位、未读键（`unreadKey`）、attention 键、活跃三路信号、
 *   卡死红点——这些一旦出现第二份实现，迟早与旧面板分叉（本仓铁律）。
 *
 * P5 处置：旧 `BotsPane` 退役时，`BotRosterRow` 的**定义**搬进本文件，
 * 调用点（BotsPane / BotsView）随之删除或改指向 —— 届时本文件从 alias
 * 变成实体，**外部导入路径不变**。
 */
export { BotRosterRow as PrivateChatRow } from '../BotsView';
