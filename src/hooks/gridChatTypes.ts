/**
 * gridChatTypes — 宫格聊天类型/常量/纯工具（useGridChat 的静态定义部分）
 *
 * 🔴 2026-08-13 Phase 2 拆分（施工方案_文件事件下沉与前端减负）：
 *   从 useGridChat.ts 纯移动抽取（diff 无逻辑变更）。只拆组织，不动状态归属——
 *   状态与回调仍单一权威源在 useGridChat hook 内。
 */
import type { ChatMessagePart, ChatMessage } from '@/types';

export const WINDOW_MAX = 100;   // 每 Agent 内存最多保留消息数（超出 evict 头部）
export const PAGE_SIZE = 20;     // 每次加载条数
export const FLUSH_MS = 33;      // ~30fps 流式 flush

export type AgentStatus = 'idle' | 'streaming' | 'waiting';

export interface AgentChatState {
  sessionId: string | null;
  messages: ChatMessage[];
  hasMore: boolean;
  oldestId: number | null;   // 上翻游标
  isLoadingMore: boolean;
  status: AgentStatus;
  /** 🔴 Phase 1: 流式 in-flight parts（到达序 segment，累加器 acc.parts 的 30fps flush 镜像）。
   *  完成后经 finalizeAccumulator 并入 messages、清空。与单视图 live parts 同构（同一套 segment 规则）。 */
  streamParts: ChatMessagePart[];
  pendingApproval: unknown | null;
  pendingClarify: unknown | null;
  pendingSudo: unknown | null;
  pendingSecret: unknown | null;
  /** 破坏性 slash 命令二次确认（对齐单视图 SlashConfirmCard） */
  pendingSlashConfirm: { confirmId: string; command: string; description: string } | null;
  /** 瞬态活动提示（thinking / tool.progress / delegate.progress，message.complete 清空） */
  activityHint: string;
  /** 后端推送的会话标题（session.title 事件） */
  sessionTitle: string | null;
  /** 当前模型名（model.name 事件） */
  modelName: string | null;
  /** 最近一轮 token 用量（message.complete usage） */
  lastUsage: { input: number; output: number; reasoning?: number; total?: number } | null;
  lastActivity: number;
}

export function emptyState(): AgentChatState {
  return {
    sessionId: null, messages: [], hasMore: false, oldestId: null,
    isLoadingMore: false, status: 'idle', streamParts: [],
    pendingApproval: null, pendingClarify: null, pendingSudo: null, pendingSecret: null,
    pendingSlashConfirm: null, activityHint: '', sessionTitle: null, modelName: null, lastUsage: null,
    lastActivity: 0,
  };
}

let gridMsgSeq = 0;
export const gridMsgId = () => `grid-${Date.now()}-${++gridMsgSeq}`;
