import { describe, expect, it } from 'vitest';
import {
  clearPeerApproval,
  clearPeerApprovalRequest,
  getPeerApprovals,
  notePeerApproval,
  type PeerApprovalRequest,
} from './peerApprovals';

function req(patch: Partial<PeerApprovalRequest> = {}): PeerApprovalRequest {
  return {
    dispatchId: 'dispatch-1',
    targetConnId: 'conn-1',
    authorityConnId: 'local',
    grantToken: 'grant',
    dispatch: { room_id: 'room-1' },
    prompt: 'hi',
    requestId: 'req-1',
    command: 'rm -rf /tmp/x',
    description: 'dangerous',
    memberId: 'm1',
    memberProfile: 'researcher',
    roomId: 'room-1',
    taskId: 't1',
    executionGeneration: 1,
    ...patch,
  };
}

describe('peerApprovals — 远端审批的 Desktop 状态', () => {
  it('同 key 幂等；内容变化才更新', () => {
    clearPeerApproval('dispatch-1');
    notePeerApproval(req());
    notePeerApproval(req()); // 重复帧不新增
    expect(getPeerApprovals()).toHaveLength(1);
    notePeerApproval(req({ command: 'changed' }));
    expect(getPeerApprovals()).toHaveLength(1);
    expect(getPeerApprovals()[0].command).toBe('changed');
    clearPeerApprovalRequest('dispatch-1', 'req-1');
    expect(getPeerApprovals()).toHaveLength(0);
  });

  it('按 dispatch / request 精确清理，不误删别的 dispatch', () => {
    notePeerApproval(req());
    notePeerApproval(req({ dispatchId: 'dispatch-2', requestId: 'req-2' }));
    clearPeerApproval('dispatch-1');
    expect(getPeerApprovals().map((i) => i.dispatchId)).toEqual(['dispatch-2']);
    clearPeerApprovalRequest('dispatch-2', 'req-2');
    expect(getPeerApprovals()).toHaveLength(0);
  });

  it('空 id 不入册', () => {
    notePeerApproval(req({ dispatchId: '' }));
    notePeerApproval(req({ requestId: '' }));
    expect(getPeerApprovals()).toHaveLength(0);
    clearPeerApproval('nope');
    clearPeerApprovalRequest('nope', 'nope');
  });
});
