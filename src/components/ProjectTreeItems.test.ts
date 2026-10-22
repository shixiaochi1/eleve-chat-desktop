/**
 * 🔴 2026-10-22 任务 A：HOME 桶里的 canonical Bot Chat（= 与 Agent 的私聊）
 * 必须恒置顶、且有独立判据（点击走 bot 域登记链，不能当普通会话切）。
 *
 * 不变量来源：docs/refactor/HANDOFF-2026-10-22-agent-panel.md §4-A
 *   - 私聊不是特殊物件，只是 HOME 项目下的一条会话 → 不做独立列表/分组
 *   - 但它在 HOME 里恒排第一，并用对话气泡图标区分
 */
import { describe, it, expect } from 'vitest';
import { isBotChatPreview, orderHomePreviews } from './ProjectTreeItems';
import type { SessionPreview } from './ProjectTreeItems';

function preview(id: string, title: string, lastActive = 0): SessionPreview {
  return { id, title, lastActive, startedAt: lastActive, messageCount: 1 };
}

const botChat = preview('agent:default:bot:aaaa', 'Bot Chat', 100);
const normal1 = preview('agent:default:s1', '项目里的会话', 300);
const normal2 = preview('agent:default:s2', '另一条会话', 200);

describe('HOME 桶里的 Bot Chat', () => {
  it('判据 = id 含 :bot: 且标题为 Bot Chat', () => {
    expect(isBotChatPreview(botChat)).toBe(true);
    expect(isBotChatPreview(normal1)).toBe(false);
    // 只有 id 形态对但标题被改过 → 不再当作私聊（用户重命名即脱离该语义）
    expect(isBotChatPreview({ ...botChat, title: '我的私聊' })).toBe(false);
    // 普通会话即使标题叫 Bot Chat 也不算
    expect(isBotChatPreview({ ...normal1, title: 'Bot Chat' })).toBe(false);
  });

  it('HOME 里置顶，且不打乱其余会话顺序（不动入参）', () => {
    const input = [normal1, normal2, botChat];
    const ordered = orderHomePreviews(input, true);
    expect(ordered.map((s) => s.id)).toEqual([botChat.id, normal1.id, normal2.id]);
    // 非 HOME 项目原样返回（项目内排序由后端决定）
    expect(orderHomePreviews(input, false)).toBe(input);
    // 不改入参
    expect(input[0].id).toBe(normal1.id);
  });

  it('没有 Bot Chat 时顺序完全不变', () => {
    const input = [normal1, normal2];
    expect(orderHomePreviews(input, true).map((s) => s.id)).toEqual([normal1.id, normal2.id]);
  });
});
