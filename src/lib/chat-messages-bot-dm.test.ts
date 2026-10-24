/**
 * Bot DM 行渲染测试（2026-10-24）。
 *
 * ① 回执四态词表：后端 bot_chat.rs 的回执有 REPLY/FAILED/SILENT/TIMEOUT
 *    四种头，前端必须逐态给文案——SILENT/TIMEOUT 曾落入兜底被误报为
 *    "回信已送达"（状态说反 + 模型侧英文说明外泄）。无回执头的 bot_dm 行
 *    （intro kick / cron 投递）走中性"系统注入消息"。
 * ② DM 来信行（AGENT_MESSAGE_RE，对齐 Hermes user-message.tsx:94-95）：
 *    role=user 且 display_kind 为空的 "Message from 🤖 …" 行降级为 system
 *    事件行，不渲染成用户气泡。
 */
import { describe, it, expect } from 'vitest';
import { toChatMessages, type SessionMessage } from './chat-messages';

function msg(extra: Partial<SessionMessage>): SessionMessage {
  return { role: 'user', content: '', timestamp: 1, ...extra };
}

function texts(out: ReturnType<typeof toChatMessages>): { role: string; text: string }[] {
  return out
    .filter((m) => m.parts.some((p) => p.type === 'text'))
    .map((m) => ({
      role: m.role,
      text: (m.parts.find((p) => p.type === 'text') as { text: string }).text,
    }));
}

describe('bot_dm 回执四态', () => {
  it('REPLY → 「@x 的回信已送达：摘要」', () => {
    const out = toChatMessages([
      msg({
        display_kind: 'bot_dm',
        content: '[BOT DM REPLY — @scout (Scout)]\n\non it\n\n[Replied to: "ping"]',
      }),
    ]);
    expect(texts(out)).toEqual([{ role: 'system', text: '@scout 的回信已送达：on it' }]);
  });

  it('FAILED → 「未能送达回信」+ 诊断摘要', () => {
    const out = toChatMessages([
      msg({
        display_kind: 'bot_dm',
        content:
          '[BOT DM FAILED — @scout (Scout)]\n\nThe teammate\'s turn produced no text reply (turn end reason: other).',
      }),
    ]);
    const [row] = texts(out);
    expect(row.role).toBe('system');
    expect(row.text.startsWith('@scout 的 DM 未能送达回信：')).toBe(true);
    expect(row.text).toContain('no text reply');
  });

  it('SILENT → 已读不回，不泄露模型侧英文说明', () => {
    const out = toChatMessages([
      msg({
        display_kind: 'bot_dm',
        content:
          '[BOT DM SILENT — @scout (Scout)]\n\nThe teammate read your message and chose not to reply (this was a successful turn, not a failure).',
      }),
    ]);
    expect(texts(out)).toEqual([
      { role: 'system', text: '@scout 已读但选择不回复（无需跟进）' },
    ]);
  });

  it('TIMEOUT → 超时行，不带英文回执正文', () => {
    const out = toChatMessages([
      msg({
        display_kind: 'bot_dm',
        content:
          '[BOT DM TIMEOUT — @scout (Scout)]\n\nNo reply from @scout within 900s. The teammate may still be mid-turn.',
      }),
    ]);
    const [row] = texts(out);
    expect(row.role).toBe('system');
    expect(row.text).toContain('@scout 等待回信超时');
    expect(row.text).not.toContain('No reply from');
  });

  it('无回执头（intro kick / cron 投递）→ 中性系统注入文案，不冒称回信', () => {
    const out = toChatMessages([
      msg({ display_kind: 'bot_dm', content: '向用户介绍一下你自己：你是谁、能做什么。' }),
    ]);
    const [row] = texts(out);
    expect(row.role).toBe('system');
    expect(row.text.startsWith('系统注入消息：')).toBe(true);
    expect(row.text).not.toContain('回信已送达');
  });
});

describe('DM 来信行（AGENT_MESSAGE_RE）', () => {
  it('标准形 → system 事件行 + 归属文案', () => {
    const out = toChatMessages([
      msg({ content: 'Message from 🤖 Scribe (@scribe): ping 一下' }),
    ]);
    expect(texts(out)).toEqual([
      { role: 'system', text: '🤖 Scribe (@scribe) 的私信：ping 一下' },
    ]);
  });

  it('relay 限定形（@handle@connection）→ 同样识别', () => {
    const out = toChatMessages([
      msg({ content: 'Message from 🤖 Scribe (@scribe@mini): 跨机问候' }),
    ]);
    const [row] = texts(out);
    expect(row.role).toBe('system');
    expect(row.text).toContain('🤖 Scribe (@scribe)');
    expect(row.text).toContain('跨机问候');
  });

  it('旧式方括号形 → 识别', () => {
    const out = toChatMessages([msg({ content: "[Message from agent 'Scout'] 旧格式正文" })]);
    const [row] = texts(out);
    expect(row.role).toBe('system');
    expect(row.text).toContain('Scout');
    expect(row.text).toContain('旧格式正文');
  });

  it('普通用户消息不受影响（仍为用户气泡）', () => {
    const out = toChatMessages([msg({ content: 'Message from 我自己：这不是 DM 前缀' })]);
    // 无 🤖 且无 (@handle) 形态 → 不命中（name 段后必须跟 ( 或 :）
    const [row] = texts(out);
    expect(row.role).toBe('user');
  });

  it('bot_dm 回执行不被来信正则截胡（display_kind 优先）', () => {
    const out = toChatMessages([
      msg({
        display_kind: 'bot_dm',
        content: '[BOT DM REPLY — @scout (Scout)]\n\n正文',
      }),
    ]);
    const [row] = texts(out);
    expect(row.text).toBe('@scout 的回信已送达：正文');
  });
});
