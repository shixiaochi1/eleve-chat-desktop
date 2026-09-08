/**
 * workspace-domain.ts — 视图/会话域判定纯函数单源。
 *
 * 🔴 2026-09-08 round-79 架构审查（阶段 1：不变量单点守卫）。病根：借道渲染
 * 把"视图模式"与"会话域"两个正交维度压扁进三值 viewMode——Bot Chat 借道
 * single 主区容器（round-51 设计），域身份只能靠 `botChatSids.has(sessionId)`
 * 谓词事后识别，而该谓词此前散落 4 处手写、恢复臂门条件散落 3 处手写。
 * 组合式谓词必然漏——round-42/53/68/76/79 五轮"域退出漏分支"修复全是该
 * 模型下的必然事件（对齐结论：Hermes 用 WorkspaceMode='sessions'|'bots'
 * 一等建模 + setWorkspaceScope 单写点 + openSession 单门，入口零域检查）。
 *
 * 本文件是谓词层收敛（阶段 2 域一等化 store/workspace.ts 的前置）。规则：
 * 任何"当前主视图是否在 bot 域"的判定必须经 isBorrowedBotChat；任何
 * "回 Agent 主视图要不要恢复会话"的判定必须经 shouldRestoreAgentView。
 */

/** Bot Chat 借道态：主视图当前会话属于 bot 域（round-51 借道设计的唯一判定式） */
export function isBorrowedBotChat(
  botChatSids: ReadonlySet<string>,
  sessionId: string | null,
): boolean {
  return sessionId !== null && botChatSids.has(sessionId);
}

/**
 * AGENT 恢复臂门（round-68 语义"完整进入 Agent 会话界面" + round-79 借道判定）：
 * viewMode 不在 single（宫格/群聊主区）**或**主视图会话是借道的 bot 会话时，
 * 点 AGENT 必须走 restoreProfileSession 恢复 map 权威指针。
 * 返回 false = 已是干净的 agent 单视图（幂等，无扰动）。
 */
export function shouldRestoreAgentView(
  viewMode: string,
  botChatSids: ReadonlySet<string>,
  sessionId: string | null,
): boolean {
  return viewMode !== 'single' || isBorrowedBotChat(botChatSids, sessionId);
}
