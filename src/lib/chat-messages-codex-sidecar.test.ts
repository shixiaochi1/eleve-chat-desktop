/**
 * Responses-API 回复 sidecar 的恢复单元测试（2026-09-12 对齐 Hermes `42f8389987`）。
 *
 * 背景：Codex（Responses API）轮次落库时 `content` 可能为**空**，用户实际看到的回复只存在于
 * `codex_message_items` sidecar；且**有工具调用时也必须提取**——工具不是回答的替代品。
 * 缺了这条提取，恢复历史时气泡空白，随后 reconcileResumeMessages 会把该序号上的缓存行整条剔除。
 *
 * 形状：REST 下发 SQLite JSON **文本**（string），RPC 下发已解码**列表**（array）——两种都要吃下。
 */
import { describe, it, expect } from 'vitest';
import { toChatMessages, type SessionMessage } from './chat-messages';

const REPLY_ITEM = {
  type: 'message',
  role: 'assistant',
  phase: 'final_answer',
  content: [{ type: 'output_text', text: '这是最终回答' }],
};

function assistant(extra: Partial<SessionMessage>): SessionMessage {
  return { role: 'assistant', content: '', timestamp: 1, ...extra };
}

describe('codex_message_items sidecar 恢复', () => {
  it('REST 形态（JSON 文本）+ content 为空 → 还原回复正文', () => {
    const out = toChatMessages([
      assistant({ codex_message_items: JSON.stringify([REPLY_ITEM]) }),
    ]);
    const texts = out.flatMap((m) => m.parts.filter((p) => p.type === 'text'));
    expect(texts.map((p) => (p as { text: string }).text)).toEqual(['这是最终回答']);
  });

  it('RPC 形态（已解码列表）→ 同样还原', () => {
    const out = toChatMessages([assistant({ codex_message_items: [REPLY_ITEM] })]);
    const texts = out.flatMap((m) => m.parts.filter((p) => p.type === 'text'));
    expect(texts.map((p) => (p as { text: string }).text)).toEqual(['这是最终回答']);
  });

  it('🔴 有 tool_calls 时回复不得被吞（工具不是回答的替代品）', () => {
    const out = toChatMessages([
      assistant({
        codex_message_items: JSON.stringify([REPLY_ITEM]),
        tool_calls: [{ id: 'call_1', function: { name: 'shell', arguments: '{}' } }],
      }),
    ]);
    const parts = out.flatMap((m) => m.parts);
    expect(parts.some((p) => p.type === 'text')).toBe(true);
    expect(parts.some((p) => p.type === 'tool-call')).toBe(true);
  });

  it('commentary / analysis 是中途叙述，不算回复', () => {
    const out = toChatMessages([
      assistant({
        codex_message_items: [
          { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: '叙述' }] },
          { type: 'message', role: 'assistant', phase: 'analysis', content: [{ type: 'output_text', text: '分析' }] },
        ],
      }),
    ]);
    expect(out.flatMap((m) => m.parts).some((p) => p.type === 'text')).toBe(false);
  });

  it('canonical content 优先：有 content 时不重复叠加 sidecar', () => {
    const out = toChatMessages([
      assistant({ content: '权威正文', codex_message_items: JSON.stringify([REPLY_ITEM]) }),
    ]);
    const texts = out
      .flatMap((m) => m.parts)
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text);
    expect(texts).toEqual(['权威正文']);
  });

  it('hidden 行不参与（内容按约定丢弃）', () => {
    const out = toChatMessages([
      assistant({ display_kind: 'hidden', codex_message_items: JSON.stringify([REPLY_ITEM]) }),
    ]);
    expect(out.flatMap((m) => m.parts).some((p) => p.type === 'text')).toBe(false);
  });

  it('畸形/非数组 sidecar 不炸也不产文本', () => {
    for (const bad of ['{not-json', 42, { type: 'message' }, null]) {
      const out = toChatMessages([assistant({ codex_message_items: bad })]);
      expect(out.flatMap((m) => m.parts).some((p) => p.type === 'text')).toBe(false);
    }
  });

  it('user 行不读该 sidecar（只服务 assistant 回复）', () => {
    const out = toChatMessages([
      { role: 'user', content: '', codex_message_items: JSON.stringify([REPLY_ITEM]) },
    ]);
    expect(out.flatMap((m) => m.parts).some((p) => p.type === 'text')).toBe(false);
  });
});
