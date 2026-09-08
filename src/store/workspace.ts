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
 *   运行时内存态，与原 App useState 同生命周期（重启后由唯一注册点
 *   handleOpenBotChat 重新登记，行为等价）。
 * - `workspaceOwner`：当前 Bot 域焦点实体（bot-chat 的 sid / 群聊房间的
 *   名字）——Agent 域动作（restoreProfileSession/clearSessionView/
 *   loadSessionIntoView）统一清空。AGENT 会话装载三入口的清空点保证
 *   "离开 bot 域 = owner 复位"不变量单点维持。
 *
 * 订阅模式复用 store/session-status.ts（useSyncExternalStore，不造轮子）。
 */
import { useSyncExternalStore } from 'react';

export type WorkspaceOwnerKind = 'none' | 'bot-chat' | 'room';

export interface WorkspaceOwner {
  kind: WorkspaceOwnerKind;
  /** bot-chat = canonical Bot Chat 的 session id；room = 房间名；none = null */
  key: string | null;
}

const IDLE_OWNER: WorkspaceOwner = { kind: 'none', key: null };

let owner: WorkspaceOwner = IDLE_OWNER;
const botChatSessions = new Set<string>();
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
  emit();
}

/** Bot Chat 会话判定（借道态谓词的唯一事实源，替代散落的 Set.has） */
export function isBotChatSession(sessionId: string | null): boolean {
  return sessionId !== null && botChatSessions.has(sessionId);
}
