/**
 * workspace.ts — Bot 域焦点实体 + Bot Chat 会话元数据 store。
 *
 * 🔴 2026-09-08 round-79b 架构审查（阶段 ②：域一等化）。对齐 Hermes
 * workspace-scope.ts 的纪律：域状态一等建模 + 单写点（batch 原子发布，
 * 幂等短路），消费端 ADAPT to it。此前"当前 bot 域实体"散落在 App.tsx
 * 的 botChatSids useState（只增不减的 Set）与若干入口的手工 setXxx 中。
 *
 * 两个正交概念：
 * - `botChatSessions`：会话元数据（哪些会话是 forever-chat 的 canonical
 *   Bot Chat，round-51 设计）——判定的唯一事实源（isBotChatSession）。
 *   持久化 localStorage（round-79c，重启恢复判定）。
 * - `workspaceOwner`：当前 Bot 域焦点实体（canonical Bot Chat 的 sid）——
 *   Agent 域动作（restoreProfileSession/clearSessionView/loadSessionIntoView）
 *   统一清空 + settleWorkspaceOwnerForSession 全写点结算。"离开 bot 域 =
 *   owner 复位"不变量单点维持。
 *
 * 🔴 round-79e 终审裁定：**不设 'room' kind（群聊域焦点由插件域 store 承载）**。
 * 群聊焦点实体 = plugins/bots/state.ts 的 selectedRoomId（key=room_id，稳定
 * 身份，localStorage eleve.bots.selectedRoomId 持久化）——rooms 数据归插件域
 * 单一权威（round-75 裁定），'room' 置位等于给同一事实开第二写点。且 bots
 * 主区三分（房间/远端私聊/空态）单一 'room' kind 无法表达：远端私聊的 fs 在
 * 远端网关（round-76 有意不接本地 workspace 管线，右抽屉空态是该模型下的
 * 正确结果）；置位需要 ≥8 个 viewMode↔owner 同步点（round-53/79 同型漂移
 * 温床）而全仓 owner 值零读取（判定走 botChatSessions/viewMode）。与 Hermes
 * 的差异是有理由的偏离：Hermes 的 workspace scope 是右栏 cwd 权威源，ELEVE
 * 的 files 面板是"项目映射视图、不跟随会话"（2026-08-13 四条定稿）——owner
 * 在 ELEVE 只承担不变量账本，该不变量不需要 room。未来若真出现 room 域消费
 * 点（如群聊级文件区），连同 host 门+写点+消费点整体立项，key 一律用 room_id。
 *
 * 订阅模式复用 store/session-status.ts（useSyncExternalStore，不造轮子）。
 */
import { useSyncExternalStore } from 'react';

export type WorkspaceOwnerKind = 'none' | 'bot-chat';

export interface WorkspaceOwner {
  kind: WorkspaceOwnerKind;
  /** bot-chat = canonical Bot Chat 的 session id；none = null */
  key: string | null;
}

const IDLE_OWNER: WorkspaceOwner = { kind: 'none', key: null };

// 🔴 round-79c 终审补：botChatSessions 持久化（对齐 Hermes plugin storage——
// 内存态重启即丢，恢复的 bot 会话 isBotChat 判定失效）。storage key 与读写
// helper 必须先于 botChatSessions 初始化（模块顶层求值顺序）。
const BOT_CHAT_STORAGE_KEY = 'eleve.bot_chat_sessions';

function loadPersistedBotChats(): Set<string> {
  try {
    const raw = localStorage.getItem(BOT_CHAT_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistBotChats(): void {
  try {
    localStorage.setItem(BOT_CHAT_STORAGE_KEY, JSON.stringify([...botChatSessions]));
  } catch { /* 存储满/禁用：内存态兜底（与未持久化时代同行为） */ }
}

let owner: WorkspaceOwner = IDLE_OWNER;
const botChatSessions = new Set<string>(loadPersistedBotChats());
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getWorkspaceOwner(): WorkspaceOwner {
  return owner;
}

/** 订阅域状态（App 顶层订阅一次 → 任何域变化触发联动区重渲染） */
export function useWorkspaceOwner(): WorkspaceOwner {
  return useSyncExternalStore(subscribe, getWorkspaceOwner, getWorkspaceOwner);
}

/**
 * 域焦点单写点（对齐 Hermes setWorkspaceScope："Publish one coherent
 * surface without an intermediate mixed frame"）——幂等短路，同值不 emit。
 */
export function setWorkspaceOwner(next: WorkspaceOwner): void {
  if (owner.kind === next.kind && owner.key === next.key) return;
  owner = next;
  emit();
}

/** Bot Chat 会话登记（唯一注册点 = App.handleOpenBotChat，round-51 语义） */
export function registerBotChatSession(sessionId: string): void {
  if (botChatSessions.has(sessionId)) return;
  botChatSessions.add(sessionId);
  persistBotChats();
  emit();
}

/** 会话删除时注销（round-79c 终审：handleDeleteSession 闭环，防 Set 只增不减泄漏） */
export function unregisterBotChatSession(sessionId: string): void {
  if (!botChatSessions.has(sessionId)) return;
  botChatSessions.delete(sessionId);
  persistBotChats();
  emit();
}

/** Bot Chat 会话判定（借道态谓词的唯一事实源，替代散落的 Set.has） */
export function isBotChatSession(sessionId: string | null): boolean {
  return sessionId !== null && botChatSessions.has(sessionId);
}

/**
 * 🔴 round-79c 终审（owner 复位缺口收敛）：会话装进主指针时的域焦点结算——
 * 目标是已登记的 Bot Chat → 置 bot-chat；否则复位 none。所有"切会话"写点
 * （会话行/ArtifactPanel/CommandCenter/slash 换会话/懒创建）统一经此，
 * "离开 bot 域 = owner 复位"不变量从 3 个装载入口扩展到全部写点。
 * handleOpenBotChat 无需改：settle 对已登记 sid 置位与显式置位等价。
 */
export function settleWorkspaceOwnerForSession(sessionId: string | null): void {
  setWorkspaceOwner(
    isBotChatSession(sessionId)
      ? { kind: 'bot-chat', key: sessionId }
      : { kind: 'none', key: null },
  );
}
