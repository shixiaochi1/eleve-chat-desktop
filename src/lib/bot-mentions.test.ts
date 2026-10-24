import { describe, it, expect } from 'vitest';
import { buildIdentificationNote, matchMentionRows, extractMentionTokens, type MentionRow } from './bot-mentions';

/**
 * 🔴 2026-10-24（对齐审查 A4）：注入行逐字对齐 Hermes plugin.tsx:851-882
 * middleware 形态——逐 bot 解析行（profile + 友好名 + 连接来源 +
 * message_agent target）+ "无 message_agent 工具就明说"兜底。
 */

const local = (over: Partial<MentionRow> = {}): MentionRow => ({
  handle: 'alice',
  profile: 'alice',
  displayName: 'Alice',
  isRemote: false,
  ...over,
});

describe('buildIdentificationNote — Hermes middleware 形态', () => {
  it('本地行：profile 解析 + 友好名；handle≠profile 时标注 target', () => {
    const note = buildIdentificationNote([local()]);
    expect(note).toContain('@alice = agent profile "alice" ("Alice")');
    // handle === profile → 本地行不标注 target（无歧义）
    expect(note).not.toContain('message_agent target');
  });

  it('本地行 handle≠profile（UI 别名）→ 标注 canonical target', () => {
    const note = buildIdentificationNote([local({ handle: 'alice-local' })]);
    expect(note).toContain('@alice-local = agent profile "alice" ("Alice") (message_agent target: "alice")');
  });

  it('远端行：连接来源 + profile@connection target', () => {
    const note = buildIdentificationNote([
      local({
        handle: 'bob',
        profile: 'bob',
        displayName: 'Bob',
        isRemote: true,
        connectionId: 'conn-9',
        connectionLabel: 'NucBox',
      }),
    ]);
    expect(note).toContain('@bob = agent profile "bob" ("Bob") — on NucBox (message_agent target: "bob@conn-9")');
  });

  it('兜底指令与"绝不逐字转发"在注入文本中', () => {
    const note = buildIdentificationNote([local()]);
    expect(note).toContain('never forward the user’s text verbatim');
    expect(note).toContain('If this session has no message_agent tool, agent messaging is unavailable here — say so.');
    expect(note).toContain('compose your own message and send it with your message_agent tool');
  });

  it('多命中以分号连接，单行一个 bot', () => {
    const note = buildIdentificationNote([local(), local({ handle: 'bob', profile: 'bob', displayName: 'Bob' })]);
    expect(note).toContain('@alice = agent profile "alice" ("Alice"); @bob = agent profile "bob" ("Bob")');
  });
});

describe('matchMentionRows / extractMentionTokens', () => {
  it('handle/profile 大小写不敏感命中；@file: 等 directive 靠名册 miss 兜底', () => {
    const rows = [local(), local({ handle: 'bob', profile: 'bob' })];
    expect(matchMentionRows('@Alice 看一下', rows)).toHaveLength(1);
    expect(matchMentionRows('@BOB 在吗', rows)).toHaveLength(1);
    // 现状钉住：token 词类不含 ':'，'@file:…' 切出 '@file'（前缀过滤器
    // 预期带冒号形态，实际吃不掉）；有效防线是名册无 'file' 行 → 不命中
    expect(extractMentionTokens('看 @file:src/a.ts 和 @alice')).toEqual(['@file', '@alice']);
    expect(matchMentionRows('看 @file:src/a.ts 和 @alice', rows)).toHaveLength(1);
  });

  it('@all/@everyone 不命中任何队友', () => {
    const rows = [local()];
    expect(matchMentionRows('@all 开会了', rows)).toHaveLength(0);
    expect(matchMentionRows('@everyone 看一下', rows)).toHaveLength(0);
  });
});
