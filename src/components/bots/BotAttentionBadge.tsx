/**
 * BotAttentionBadge — Bot / Agent 行的 needs-attention 徽标。
 *
 * 对齐 Hermes `plugins/hermes-bots/bot-row.tsx:296-303`：行上的琥珀色 warning
 * 图标 + tooltip（类别提示 + 原始失败文本）。数据源 = `hooks/useBotAttention`
 * 的进程内 store：只有**需要用户介入**的失败类别才入册（auth/quota/missing
 * config/agent_blocked），transient 失败永不徽标。
 *
 * 为什么做成独立组件：`useBotAttention` 是 hook，行列表里不能内联调用；
 * 只有真正带 attention 的行需要订阅，不把全部行拖进重渲染。
 */
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { attentionHint, useBotAttention } from '../../hooks/useBotAttention';

export interface BotAttentionBadgeProps {
  /** `${connectionId}::${profile}`（与 `services/bot-relay.ts` 写入口同源） */
  rowKey: string;
  className?: string;
}

export function BotAttentionBadge({ rowKey, className }: BotAttentionBadgeProps) {
  const attention = useBotAttention(rowKey);
  if (!attention) return null;
  const hint = attentionHint(attention);
  return (
    <span
      className={cn('shrink-0 inline-flex items-center', className)}
      role="img"
      aria-label="需要用户处理"
      title={hint}
    >
      <AlertTriangle size={11} strokeWidth={1.8} className="text-amber-600 dark:text-amber-300" />
    </span>
  );
}
