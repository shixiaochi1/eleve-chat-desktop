import { useState, useCallback } from 'react';
import { ShieldCheck, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWsClient } from '../services/ws-client';

/**
 * ApprovalCard — 危险操作审批卡片（中断型交互卡片家族 · warning 变体）
 *
 * 对齐 Hermes approval: 当终端等工具执行危险命令时，
 * 前端显示此卡片让用户选择审批级别。
 * Choices: "once" | "session" | "always" | "deny"
 *
 * 🔴 对齐 Hermes: 审批回传走 WS JSON-RPC approval.respond，
 * 不走 HTTP POST /v1/runs/{run_id}/approval（那是 API Server 路径）。
 */
interface ApprovalCardProps {
  command?: string;
  description?: string;
  pattern?: string;
  choices?: string[];
  run_id?: string;  // 即 session_id，用于 WS approval.respond
  /** 🔴 卡片归属 profile（宫格模式显式传入）；undefined 时 sendRpc 自动盖当前活跃 profile（单视图正确） */
  profile?: string;
  onDone?: (choice: string) => void;
}

const choiceLabels: Record<string, string> = {
  once: '批准本次',
  session: '批准此会话',
  always: '始终批准',
  deny: '拒绝',
};

export default function ApprovalCard({ command, description, pattern, choices, run_id, profile, onDone }: ApprovalCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  /** 🔴 2026-08-11 超时/中断后后端已清 pending → 提交返回 resolved:0 或报错
   *  旧实现不检查 resolved，超时后点按钮显示"已批准"但实际已被 deny（或永远挂着）= 卡死。
   *  失败即折叠为「已过期」态。 */
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChoice = useCallback(async (choice: string) => {
    if (submitting || submitted || expired) return;
    setSubmitting(true);
    setSelected(choice);
    setError(null);
    try {
      // 🔴 对齐 Hermes: WS JSON-RPC approval.respond（非 HTTP POST）
      // Hermes 桌面端: gateway.request('approval.respond', { choice, session_id })
      // run_id 在 WS 路径中即为 session_id（approval_session_key）
      const ws = getWsClient();
      const res = await ws.sendRpc('approval.respond', {
        session_id: run_id,
        choice,
        all: false,
        profile, // 显式归属 profile（undefined → sendRpc 自动盖章）
      }) as { resolved?: number };
      // 🔴 resolved=0 = 后端已无 pending（超时/中断已 deny）→ 折叠过期态
      if (typeof res?.resolved === 'number' && res.resolved === 0) {
        setExpired(true);
        return;
      }
      setSubmitted(true);
      onDone?.(choice);
    } catch (err: unknown) {
      // 🔴 后端已无 pending（超时/中断清理）→ 折叠过期态，不再让用户反复点击
      setExpired(true);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, submitted, expired, onDone, run_id, profile]);

  // ── 已完成折叠态 ──
  if (submitted) {
    return (
      <div className="icard icard--done">
        <div className="icard-head">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="icard-check">
              <Check size={11} strokeWidth={3} />
            </span>
            <span>{selected === 'deny' ? '已拒绝' : '已批准'}</span>
            {command && (
              <span className="font-mono text-[10px] text-muted-foreground/60 truncate max-w-[320px]">{command}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 🔴 已过期折叠态（超时/中断后后端已无 pending）──
  if (expired) {
    return (
      <div className="icard icard--done">
        <div className="icard-head">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="icard-check">
              <Check size={11} strokeWidth={3} />
            </span>
            <span>已过期（未及时审批）</span>
            {command && (
              <span className="font-mono text-[10px] text-muted-foreground/60 truncate max-w-[320px]">{command}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const choiceList = choices || ['once', 'session', 'always', 'deny'];
  const denyChoices = choiceList.filter((c) => c === 'deny');
  const approveChoices = choiceList.filter((c) => c !== 'deny');

  // 🔴 computer_use 输入动作的审批是"桌面操作"而非"危险命令"——标题误导会让
  // 用户困惑（ELEVE 点个计算器按钮不该显示"危险命令"）；同时这类审批必须醒目，
  // 用户在操作桌面时看不到普通消息流里的卡片 → 300s 超时（实测根因）。
  const isDesktopAction = (command ?? '').startsWith('computer_use') || (command ?? '').startsWith('click');

  return (
    <div className="icard icard--warning">
      {/* 头部：类型色图标 + 标题 + pattern 徽章 */}
      <div className="icard-head">
        <div className="icard-icon">
          <ShieldCheck size={14} strokeWidth={2} />
        </div>
        <span className="icard-title">{isDesktopAction ? '需要审批 · 桌面操作' : '需要审批 · 危险命令'}</span>
        {pattern && <span className="icard-badge">{pattern}</span>}
      </div>

      <div className="icard-body">
        {/* 🔴 醒目提示条：等待批准中（桌面操作审批必须让用户一眼看到） */}
        <div
          className={cn(
            'mb-2.5 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5',
            'text-xs text-warning'
          )}
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-warning" />
          </span>
          <span>
            {isDesktopAction
              ? 'ELEVE 想操作你的桌面（点击/输入），请在下方选择批准方式'
              : '等待你审批——不响应将在超时后自动拒绝'}
          </span>
        </div>

        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed mb-2.5">{description}</p>
        )}

        {/* 终端式命令块 */}
        {command && (
          <div className="icard-cmd">
            <span className="prompt">$</span>
            <span className="text-foreground">{command}</span>
          </div>
        )}

        {error && (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        )}

        {/* 按钮层级：拒绝(幽灵) ← 弹性间隔 → 次级批准 → 主操作 */}
        <div className="flex items-center gap-2 mt-3.5">
          {denyChoices.map((choice) => (
            <button
              key={choice}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                'border border-destructive/25 text-destructive',
                'hover:bg-destructive/10 hover:border-destructive/50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40',
                'disabled:pointer-events-none disabled:opacity-50',
                'active:scale-95'
              )}
              onClick={() => void handleChoice(choice)}
              disabled={submitting}
            >
              {submitting && selected === choice && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              ✕ {choiceLabels[choice] || choice}
            </button>
          ))}
          <span className="flex-1" />
          {approveChoices.map((choice, i) => {
            const isPrimary = i === approveChoices.length - 1;
            return (
              <button
                key={choice}
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40',
                  'disabled:pointer-events-none disabled:opacity-50',
                  'active:scale-95',
                  isPrimary
                    ? 'bg-warning text-background shadow-sm hover:brightness-110 hover:-translate-y-px'
                    : 'border border-border bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
                onClick={() => void handleChoice(choice)}
                disabled={submitting}
              >
                {submitting && selected === choice && (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {choiceLabels[choice] || choice}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
