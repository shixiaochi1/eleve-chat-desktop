/**
 * 🔴 2026-10-25：远端成员轮的待决审批（Desktop courier 的 UI 状态）。
 *
 * 链路：target `bot.rooms.peer.status` 的 running 帧带 `pending_approval`
 * （target 成员会话的 `approval_async` 真实队列）→ `services/bot-relay.ts`
 * 的轮询循环写入本 store → `PeerApprovalModal` 展示 → 用户选择 →
 * Desktop 骑 authority 的 grant 调 **target** `bot.rooms.peer.approve`。
 *
 * 为什么在 Desktop 而不是 authority 房间卡：审批只存在于 target 进程，
 * authority 没有直连 target 的通道；Desktop 是唯一同时持有两端的 courier。
 * 逐卡 once/deny，不写目标会话白名单。
 */
import { useSyncExternalStore } from 'react';

export interface PeerApprovalRequest {
  /** target dispatch 行 id（同一 dispatch 只保留一张卡） */
  dispatchId: string;
  /** target 连接 id（Desktop 的 route） */
  targetConnId: string;
  /** 房间 authority 连接 id（房间卡裁决的 RPC 目的地） */
  authorityConnId: string;
  /** authority 签给 target 的 grant（approve RPC 的验签凭据） */
  grantToken: string;
  /** dispatch 身份集（approve 的 grant 校验需要逐字段一致） */
  dispatch: Record<string, unknown>;
  prompt: string;
  requestId: string;
  command: string;
  description: string;
  memberId: string;
  memberProfile: string;
  roomId: string;
  /** 房间卡裁决坐标（authority `bot.rooms.approve` 的 task/代次校验） */
  taskId: string;
  executionGeneration: number;
}

let items: PeerApprovalRequest[] = [];
const listeners = new Set<() => void>();
const EMPTY: PeerApprovalRequest[] = [];

function emit() {
  for (const fn of listeners) fn();
}

function keyOf(dispatchId: string, requestId: string): string {
  return `${dispatchId}:${requestId}`;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 登记/更新一条待决审批（同 key 幂等；内容变化才 emit）。 */
export function notePeerApproval(req: PeerApprovalRequest): void {
  if (!req.dispatchId || !req.requestId) return;
  const idx = items.findIndex(
    (i) => keyOf(i.dispatchId, i.requestId) === keyOf(req.dispatchId, req.requestId),
  );
  if (idx >= 0) {
    const cur = items[idx];
    if (
      cur.command === req.command &&
      cur.description === req.description &&
      cur.targetConnId === req.targetConnId
    ) {
      return;
    }
    const next = [...items];
    next[idx] = req;
    items = next;
    emit();
    return;
  }
  items = [...items, req];
  emit();
}

/** 清掉某 dispatch 的全部审批卡（轮收口/取消/错误）。 */
export function clearPeerApproval(dispatchId: string): void {
  if (!items.some((i) => i.dispatchId === dispatchId)) return;
  items = items.filter((i) => i.dispatchId !== dispatchId);
  emit();
}

/** 清掉某一张（裁决成功）。 */
export function clearPeerApprovalRequest(dispatchId: string, requestId: string): void {
  const next = items.filter(
    (i) => keyOf(i.dispatchId, i.requestId) !== keyOf(dispatchId, requestId),
  );
  if (next.length === items.length) return;
  items = next;
  emit();
}

/** 当前快照（非 hook；单测/诊断用）。 */
export function getPeerApprovals(): PeerApprovalRequest[] {
  return items;
}

/** 订阅全部待决审批（App 级 Modal 用）。 */
export function usePeerApprovals(): PeerApprovalRequest[] {
  return useSyncExternalStore(subscribe, () => items, () => EMPTY);
}
