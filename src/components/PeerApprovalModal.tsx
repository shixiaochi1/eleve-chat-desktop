/**
 * 🔴 2026-10-25：远端成员轮的审批卡（Desktop courier）。
 *
 * 数据源 = `plugins/bots/peerApprovals`（`services/bot-relay.ts` 从 target
 * `peer.status.running.pending_approval` 写入）。选择后骑 authority 签给
 * target 的 grant 调 **target** `bot.rooms.peer.approve`；target 的
 * `approval_async` 唤醒成员轮。
 *
 * 只允许 once/deny——远端审批不写目标会话白名单（与房间审批卡同口径）。
 * 不做“稍后”：轮询下一拍会重新登记，半关状态只会让卡片闪回。
 */
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { requestForBot } from '../services/connections';
import { approveBotRoomTask } from '../utils/api';
import { useActiveRoomId } from '../plugins/bots/active-room';
import {
  clearPeerApprovalRequest,
  usePeerApprovals,
} from '../plugins/bots/peerApprovals';

export default function PeerApprovalModal() {
  const pending = usePeerApprovals();
  const req = pending[0];
  const activeRoomId = useActiveRoomId();
  const [busy, setBusy] = useState<null | 'once' | 'deny'>(null);
  const [error, setError] = useState<string | null>(null);

  if (!req) return null;
  // 房间卡已经可见 → 以房间卡为主，避免同一 decision 两张卡。
  if (activeRoomId === req.roomId) return null;

  const submit = async (choice: 'once' | 'deny') => {
    if (busy) return;
    setBusy(choice);
    setError(null);
    try {
      await requestForBot(
        { connectionId: req.targetConnId, profile: 'default' },
        'bot.rooms.peer.approve',
        {
          grant_token: req.grantToken,
          dispatch: req.dispatch,
          prompt: req.prompt,
          request_id: req.requestId,
          choice,
        },
        30_000,
      );
      // 房间时间线的镜像卡同步收口（best effort；若用户是在房间卡处裁决的，
      // Desktop 的 outbox 轮询也会走到这里，target 侧幂等）。
      if (req.authorityConnId && req.authorityConnId !== 'local') {
        void requestForBot(
          { connectionId: req.authorityConnId, profile: 'default' },
          'bot.rooms.approve',
          {
            room_id: req.roomId,
            member_id: req.memberId,
            task_id: req.taskId,
            execution_generation: req.executionGeneration,
            request_id: req.requestId,
            choice,
          },
          15_000,
        ).catch(() => {});
      } else {
        void approveBotRoomTask({
          roomId: req.roomId,
          memberId: req.memberId,
          taskId: req.taskId,
          executionGeneration: req.executionGeneration,
          requestId: req.requestId,
          choice,
        }).catch(() => {});
      }
      clearPeerApprovalRequest(req.dispatchId, req.requestId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no longer pending|not pending|resolved/i.test(msg)) {
        clearPeerApprovalRequest(req.dispatchId, req.requestId);
        return;
      }
      setError(`审批失败：${msg}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-[var(--ui-stroke-tertiary)] bg-popover text-popover-foreground shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="远端成员请求审批"
      >
        <div className="flex items-start gap-2 px-4 pt-4">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">远端成员请求审批</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              @{req.memberProfile || req.memberId} · 房间 {req.roomId.slice(0, 8)}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 space-y-2">
          {req.description ? (
            <div className="text-xs text-muted-foreground">{req.description}</div>
          ) : null}
          <pre className="max-h-40 overflow-auto rounded-md border border-[var(--ui-stroke-tertiary)] bg-accent/30 px-2.5 py-2 text-[11px] whitespace-pre-wrap break-all">
            {req.command || '(no command)'}
          </pre>
          <div className="text-[11px] text-muted-foreground">
            该审批只对本次成员轮生效；不会写入目标会话的白名单。
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 pb-4">
          <button
            type="button"
            className="rounded-md border border-[var(--ui-stroke-tertiary)] px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void submit('deny')}
          >
            {busy === 'deny' ? '拒绝中…' : '拒绝'}
          </button>
          <button
            type="button"
            className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background hover:bg-foreground/90 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void submit('once')}
          >
            {busy === 'once' ? '批准中…' : '允许一次'}
          </button>
        </div>
      </div>
    </div>
  );
}
