/**
 * remoteChatState — 🔴 阶段3 统一（frontend-chat-unification-2026-09-09）：
 * ④ Bot 私聊消息状态迁出组件 useState（对齐阶段 3"组件外 atom"方向，为 2b
 * 事件路由器合并铺路——组件外状态是共享订阅器的前提形态）。
 *
 * 单实例：一次只挂载一个远端 chat 视图（BotsView 主区选中态）。原 useState
 * 的隔离是实例级的（卸载后 setState no-op）；换模块级 atom 后必须显式补偿：
 * **owner 键（connId:sessionId）守卫一切写入**——防旧视图的 async load 响应
 * /迟到事件污染新视图。挂载即认领（claim = reset + 换 owner）。
 *
 * 走 createAtomStore 工厂（新 store 禁手抄样板——store-factory 纪律）。
 * 流式 delta 逐条通知（与原 useState 语义相同）：④消息量小、渲染轻，批量
 * flush（store/messages 的 MessageChannel 工程）对它是过度设计，不引入。
 */
import { createAtomStore } from '@/lib/store-factory';
import type { RemoteChatMessage } from '@/utils/api';

export interface RemoteChatState {
  /** 当前认领视图的 connId:sessionId；null = 无人认领 */
  owner: string | null;
  messages: RemoteChatMessage[];
  /** 流式中的 assistant 文本（message.delta 累积；message.complete 清空并 load） */
  streamingText: string | null;
  error: string | null;
}

const store = createAtomStore<RemoteChatState>({
  owner: null,
  messages: [],
  streamingText: null,
  error: null,
});

export function remoteChatOwner(connId: string, sessionId: string): string {
  return `${connId}:${sessionId}`;
}

/** 视图挂载/切换 chat：认领 owner + 清旧状态（旧 chat 的消息/流式/错误不残留） */
export function claimRemoteChatState(owner: string): void {
  store.set({ owner, messages: [], streamingText: null, error: null });
}

/** owner 不匹配的写入一律丢弃（迟到 async load / 迟到事件防污染） */
function write(owner: string, updater: (cur: RemoteChatState) => RemoteChatState): void {
  const cur = store.get();
  if (cur.owner !== owner) return;
  store.set(updater(cur));
}

export function setRemoteChatMessages(owner: string, messages: RemoteChatMessage[]): void {
  write(owner, (cur) => ({ ...cur, messages }));
}

/** 乐观追加（函数式——与 async load 完成并发时不丢 load 结果，原 useState
 *  函数式更新语义在 atom 下的等价物） */
export function appendRemoteChatMessage(owner: string, msg: RemoteChatMessage): void {
  write(owner, (cur) => ({ ...cur, messages: [...cur.messages, msg] }));
}

export function setRemoteChatError(owner: string, error: string | null): void {
  write(owner, (cur) => ({ ...cur, error }));
}

export function appendRemoteChatDelta(owner: string, delta: string): void {
  write(owner, (cur) => ({ ...cur, streamingText: (cur.streamingText ?? '') + delta }));
}

export function clearRemoteChatStreaming(owner: string): void {
  write(owner, (cur) => ({ ...cur, streamingText: null }));
}

export function useRemoteChatState(): RemoteChatState {
  return store.useAtom();
}
