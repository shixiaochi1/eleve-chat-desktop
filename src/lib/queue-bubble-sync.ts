/**
 * queue-bubble-sync — 排队条目编辑/删除与聊天区乐观气泡同步（四系统联动审计 C2）
 *
 * 🔴 2026-08-16（审计 C2）：busy 直发时前端立即乐观上屏用户气泡
 * （usePromptActions.handleSend / useGridChat.sendTo），后端把文本收进
 * Inbox.followup 排队。用户在 QueuePanel 编辑/删除排队条目后，气泡仍显示
 * 旧文本 / 残留无回复气泡（后端不推用户消息事件，队列权威投影只在 QueuePanel）。
 *
 * 本模块按「文本 + 无回复（尾部用户消息段）」匹配乐观气泡并就地更新/移除。
 * 后端条目无稳定 id（C1 用 expected-text CAS 守卫），文本匹配是同一语义的
 * 前端对应物：同文本条目编辑/删除哪个都无差别。
 *
 * 匹配规则：从消息尾部向前扫，遇到第一个非 user 消息即停（之前的用户消息
 * 已有回复，不可能是排队中的乐观气泡）；在尾部 user 段内取最后一个文本匹配
 * 的气泡（媒体条目：文本空 + attachmentRefs 存在 + 条目 media_count>0）。
 */
import type { ChatMessage } from '@/types';

export type QueueBubbleSyncOp =
  | { type: 'edit'; oldText: string; newText: string; mediaCount: number }
  | { type: 'remove'; text: string; mediaCount: number };

function userMessageText(m: ChatMessage): string {
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('');
}

function findPendingQueuedBubbleIndex(
  messages: ChatMessage[],
  text: string,
  mediaCount: number,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.hidden) continue;
    if (m.role !== 'user') break; // 之前的用户消息已有回复
    const t = userMessageText(m);
    if (text !== '' && t === text) return i;
    if (text === '' && mediaCount > 0 && t === '' && (m.attachmentRefs?.length ?? 0) > 0) return i;
  }
  return -1;
}

/** queue.edit 成功后同步乐观气泡文本。无匹配 → 返回 null（调用方保持现状）。 */
export function applyQueueEditToBubbles(
  messages: ChatMessage[],
  op: { oldText: string; newText: string; mediaCount: number },
): ChatMessage[] | null {
  const idx = findPendingQueuedBubbleIndex(messages, op.oldText, op.mediaCount);
  if (idx < 0) return null;
  const next = messages.slice();
  next[idx] = {
    ...next[idx],
    parts: next[idx].parts.map((p) => (p.type === 'text' ? { ...p, text: op.newText } : p)),
  };
  return next;
}

/** queue.remove 成功后移除乐观气泡（防残留无回复气泡）。无匹配 → 返回 null。 */
export function applyQueueRemoveToBubbles(
  messages: ChatMessage[],
  op: { text: string; mediaCount: number },
): ChatMessage[] | null {
  const idx = findPendingQueuedBubbleIndex(messages, op.text, op.mediaCount);
  if (idx < 0) return null;
  const next = messages.slice();
  next.splice(idx, 1);
  return next;
}
