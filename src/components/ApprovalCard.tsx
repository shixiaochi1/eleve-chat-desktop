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
  onDone?: (choice: string) => void;
}

const choiceLabels: Record<string, string> = {
  once: '批准本次',
  session: '批准此会话',
  always: '始终批准',
  deny: '拒绝',
};

export default function ApprovalCard({ command, description, pattern, choices, run_id, onDone }: ApprovalCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChoice = useCallback(async (choice: string) => {
    if (submitting || submitted) return;
    setSubmitting(true);
    setSelected(choice);
    setError(null);
    try {
      // 🔴 对齐 Hermes: WS JSON-RPC approval.respond（非 HTTP POST）
      // Hermes 桌面端: gateway.request('approval.respond', { choice, session_id })
      // run_id 在 WS 路径中即为 session_id（approval_session_key）
      const ws = getWsClient();
      await ws.sendRpc('approval.respond', {
        session_id: run_id,
        choice,
        all: false,
      });
      setSubmitted(true);
      onDone?.(choice);
    } catch (err: unknown) {
      setError((err as Error).message || '网络错误');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, submitted, onDone, run_id]);

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

  const choiceList = choices || ['once', 'session', 'always', 'deny'];
  const denyChoices = choiceList.filter((c) => c === 'deny');
  const approveChoices = choiceList.filter((c) => c !== 'deny');

  return (
    <div className="icard icard--warning">
      {/* 头部：类型色图标 + 标题 + pattern 徽章 */}
      <div className="icard-head">
        <div className="icard-icon">
          <ShieldCheck size={14} strokeWidth={2} />
        </div>
        <span className="icard-title">需要审批 · 危险命令</span>
        {pattern && <span className="icard-badge">{pattern}</span>}
      </div>

      <div className="icard-body">
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
