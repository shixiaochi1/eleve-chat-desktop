/**
 * ElicitationInbox — MCP 服务器「请求用户输入」的待办收件箱。
 *
 * 后端契约（`GET /api/elicitations`）：
 * ```
 * { pending: [{ id, server, message, fields, form_supported }] }
 * ```
 *
 * 三条必须遵守的语义（与后端 fail-closed 设计对齐）：
 * 1. **只渲染「同意 / 拒绝」**。`form_supported: false` 表示后端不采集字段值，
 *    `accept` 时 `content` 为空——界面绝不能自己编字段值回填。
 * 2. **超时由后端判定**（`action: "cancel"`），所以这里不放"取消"按钮：
 *    用户不点，请求到点自然消失，不会留下"点了但没反应"的死按钮。
 * 3. **没有待办时不占版面**：轮询拿到空数组直接返回 null。
 *
 * 轮询间隔 3s：这是"有人在等"的场景，太慢会让服务器侧的工具调用干等。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { Button } from '../ui/button';
import { notifyError, notifySuccess } from '../../utils/notifications';
import { fetchElicitations, respondElicitation } from '../../utils/api';
import type { PendingElicitation } from '../../utils/api';

const POLL_INTERVAL_MS = 3000;

export default function ElicitationInbox() {
  const [pending, setPending] = useState<PendingElicitation[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  // 组件卸载后不再 setState（轮询是异步的，切页面时很容易踩到）
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const poll = useCallback(async () => {
    try {
      const items = await fetchElicitations();
      if (alive.current) setPending(items);
    } catch {
      // 网关没起来 / 端点不可用时不打扰用户：这是被动轮询，不是用户动作
      if (alive.current) setPending([]);
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const respond = useCallback(
    async (item: PendingElicitation, decision: 'accept' | 'decline') => {
      setBusy(item.id);
      try {
        const res = await respondElicitation(item.id, decision);
        if (res.resolved) {
          notifySuccess(
            decision === 'accept'
              ? `已同意「${item.server}」的请求`
              : `已拒绝「${item.server}」的请求`,
          );
        } else {
          // 已被应答或已超时：不是错误，只是慢了一步
          notifyError(
            new Error('该请求已失效（可能已超时或被其他窗口应答）'),
            '应答未生效',
          );
        }
        await poll();
      } catch (err) {
        notifyError(err, '应答 elicitation 失败');
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [poll],
  );

  if (pending.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {pending.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3"
        >
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-foreground">
                「{item.server}」请求你的输入
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground break-words">
                {item.message}
              </p>

              {item.fields.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {item.fields.map((field) => (
                    <li
                      key={field}
                      className="font-mono text-[10px] text-muted-foreground/80"
                    >
                      · {field}
                    </li>
                  ))}
                </ul>
              )}

              {!item.form_supported && item.fields.length > 0 && (
                <p className="mt-2 text-[10px] text-muted-foreground/60">
                  当前只能回复「同意 / 拒绝」，不会填写上述字段的值。
                </p>
              )}

              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={busy === item.id}
                  onClick={() => void respond(item, 'accept')}
                >
                  <Check size={12} className="mr-1" /> 同意
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={busy === item.id}
                  onClick={() => void respond(item, 'decline')}
                >
                  <X size={12} className="mr-1" /> 拒绝
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
