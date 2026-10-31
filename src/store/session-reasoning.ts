/**
 * 会话级思考状态 — 对齐 Hermes `SessionView.$reasoningEffort / $fast`
 *
 * Hermes 的思考档位是**挂在会话上**的（`config.set {key:'reasoning', session_id}`），
 * 模型胶囊标签也直接读会话态（`Model · Med`）。ELEVE 此前把档位存在
 * ThinkingButton 的局部 state 里、写全局 config，导致：
 *   ① 模型胶囊无法显示当前档位；
 *   ② 切会话后按钮显示的是上一会话（或全局）的值。
 *
 * 本 store 是前端唯一真相源：
 * - `sessionId`：`sessionEffort` 归属的会话（'' = 无会话）
 * - `sessionEffort`：该会话的档位覆盖（'' = 继承，'none' = 思考关闭）
 * - `globalEffort`：全局默认（草稿会话的写入目标 / 空会话的继承值）
 * - `fast`：快速模式（Hermes session.fast 的投影；ELEVE 写全局 service_tier）
 *
 * 🔴 归属校验：读档位必须带当前 sessionId —— 新建会话/切到尚未 attach 的会话时
 *   旧会话的值不会被误显示（历史 bug：新建会话后仍显示上个会话的档位）。
 *
 * 写入方：useMessageStream（session.info 权威快照，带 session_id）、
 *         ThinkingButton / ModelPill（乐观更新）
 */
import { useSyncExternalStore } from 'react';
import { DEFAULT_REASONING_EFFORT } from '@/lib/reasoning-efforts';

export interface SessionReasoningState {
  sessionId: string;
  sessionEffort: string;
  globalEffort: string;
  fast: boolean;
}

let state: SessionReasoningState = {
  sessionId: '',
  sessionEffort: '',
  globalEffort: '',
  fast: false,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(next: Partial<SessionReasoningState>): void {
  const merged = { ...state, ...next };
  if (
    merged.sessionId === state.sessionId &&
    merged.sessionEffort === state.sessionEffort &&
    merged.globalEffort === state.globalEffort &&
    merged.fast === state.fast
  ) {
    return;
  }
  state = merged;
  emit();
}

export const getSessionReasoningState = (): SessionReasoningState => state;

/** 档位归一（后端配置可能手写大写/空白；比较与展示都依赖小写） */
const normEffort = (effort: string | null | undefined): string =>
  (effort || '').trim().toLowerCase();

const normSid = (sessionId: string | null | undefined): string => (sessionId || '').trim();

/** 会话级档位（session.info 权威值；'' = 继承全局）。归属随 sessionId 一起更新。 */
export const setSessionReasoning = (
  sessionId: string | null | undefined,
  effort: string,
): void => patch({ sessionId: normSid(sessionId), sessionEffort: normEffort(effort) });

/** 全局默认档位（agent.reasoning_effort） */
export const setGlobalReasoning = (effort: string): void =>
  patch({ globalEffort: normEffort(effort) });

/** 快速模式（agent.service_tier 投影；进程级，不随会话） */
export const setFastMode = (fast: boolean): void => patch({ fast });

export function subscribeSessionReasoning(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionReasoning(): SessionReasoningState {
  return useSyncExternalStore(subscribeSessionReasoning, getSessionReasoningState, getSessionReasoningState);
}

/** 该会话自己的档位覆盖（归属不匹配 → ''，视为继承） */
export function sessionEffortFor(
  value: SessionReasoningState,
  sessionId: string | null | undefined,
): string {
  return value.sessionId === normSid(sessionId) ? value.sessionEffort : '';
}

/** 生效档位：会话覆盖 > 全局默认 > medium（对齐 Hermes resolveReasoningEffort 的继承链） */
export function effectiveReasoningEffort(
  value: SessionReasoningState = getSessionReasoningState(),
  sessionId: string | null | undefined = value.sessionId,
): string {
  return sessionEffortFor(value, sessionId) || value.globalEffort || DEFAULT_REASONING_EFFORT;
}
