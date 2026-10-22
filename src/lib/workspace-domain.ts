/**
 * workspace-domain.ts — 视图/会话域判定纯函数单源。
 *
 * 🔴 2026-09-08 round-79b 架构审查（阶段 ②）。病根：借道渲染把"视图模式"
 * 与"会话域"两个正交维度压扁进三值 viewMode——Bot Chat 借道 single 主区
 * 容器（round-51 设计），域身份只能靠谓词事后识别，而该谓词此前散落 4 处
 * 手写、恢复臂门条件散落 3 处手写。组合式谓词必然漏——round-42/53/68/76/79
 * 五轮"域退出漏分支"修复全是该模型下的必然事件。
 *
 * 阶段 ② 后判定的事实源收敛到 store/workspace.ts（isBotChatSession），
 * 本文件只保留语义命名层（借道态/恢复臂门）供 App 入口调用。规则：
 * 任何"当前主视图是否在 bot 域"的判定必须经 isBorrowedBotChat；任何
 * "回 Agent 主视图要不要恢复会话"的判定必须经 shouldRestoreAgentView。
 */
import { isBotChatSession } from '../store/workspace';
import { isBotPlatformSessionId } from '../utils/session';

/** Bot Chat 借道态：主视图当前会话属于 bot 域（round-51 借道设计的唯一判定式） */
export function isBorrowedBotChat(sessionId: string | null): boolean {
  return isBotChatSession(sessionId);
}

/**
 * AGENT 恢复臂门（round-68 语义"完整进入 Agent 会话界面" + round-79 借道判定）：
 * viewMode 不在 single（宫格/群聊主区）**或**主视图会话是借道的 bot 会话时，
 * 点 AGENT 必须走 restoreProfileSession 恢复 map 权威指针。
 * 返回 false = 已是干净的 agent 单视图（幂等，无扰动）。
 */
export function shouldRestoreAgentView(viewMode: string, sessionId: string | null): boolean {
  return viewMode !== 'single' || isBorrowedBotChat(sessionId);
}

/**
 * 右栏（文件 / 终端 / 预览）的**唯一根来源**。
 *
 * 背景：此前右栏根由 App 里一个三目表达式就地决定（`bots` → ''、bot chat →
 * `sessionCwd`、其余 → `panelRoot`），而终端与预览又各自取值，导致"一个抽屉三种根"、
 * 且没有任何地方能回答"我现在看的目录属于谁"。
 *
 * 语义：
 * - `project`：单视图普通会话域 → 根 = 项目绑定物理路径（调用方须先按 Agent 归属
 *   校验，不属于当前 Agent 的残留根一律传 null）
 * - `session`：Bot Chat 借道域 → 根 = 该会话的工作目录（远端会话不接本地 fs → null）
 * - `room`：群聊主区 → **无单一目录**（多成员多工作区），右栏禁用并解释
 */
export type WorkspaceDomain =
  | { kind: 'project'; root: string | null; sessionId: string | null }
  | { kind: 'session'; root: string | null; sessionId: string }
  | { kind: 'room'; root: null; sessionId: null };

/** 域选择器（纯函数，可单测） */
export function selectWorkspaceDomain(params: {
  viewMode: string;
  sessionId: string | null;
  sessionCwd: string | null;
  /** 已按 Agent 归属校验的项目根；不属于当前 Agent 时必须传 null */
  projectRoot: string | null;
}): WorkspaceDomain {
  const { viewMode, sessionId, sessionCwd, projectRoot } = params;
  if (viewMode === 'bots') {
    return { kind: 'room', root: null, sessionId: null };
  }
  // 判定用「已登记集合 ∪ sid 平台段」：注册表只覆盖本进程打开过的 bot chat，
  // 冷启动/远端会话可能尚未登记，但 `agent:<p>:bot:` 平台段是权威信号。
  if (sessionId && (isBorrowedBotChat(sessionId) || isBotPlatformSessionId(sessionId))) {
    // 远端 Bot Chat 不走本地 fs 管线 → sessionCwd 为 null 时自然降级为空态
    return { kind: 'session', root: sessionCwd ?? null, sessionId };
  }
  return { kind: 'project', root: projectRoot ?? null, sessionId };
}

/** 域徽标文案（右栏头部显示"当前根属于谁"） */
export function workspaceDomainLabel(domain: WorkspaceDomain): string {
  switch (domain.kind) {
    case 'project':
      return '项目';
    case 'session':
      return '会话';
    case 'room':
      return '群聊';
  }
}
