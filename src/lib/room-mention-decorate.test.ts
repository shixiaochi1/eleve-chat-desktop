/**
 * room-mention-decorate 纯函数测试（2026-10-24，对齐 Hermes
 * `group-mention-text.test.tsx` 的语义面：染色判定 = 路由认不认）。
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRoomMention,
  splitMentionSegments,
  type RoomMentionMember,
} from './room-mention-decorate';

const MEMBERS: RoomMentionMember[] = [
  { handle: 'alice', display_name: 'Alice' },
  { handle: 'xiaoming', display_name: '小明' },
];

describe('classifyRoomMention', () => {
  it('成员 handle/display（含中文 display）→ agent；大小写不敏感', () => {
    expect(classifyRoomMention('alice', MEMBERS)).toBe('agent');
    expect(classifyRoomMention('ALICE', MEMBERS)).toBe('agent');
    expect(classifyRoomMention('小明', MEMBERS)).toBe('agent');
  });

  it('broadcast / human / 未知', () => {
    expect(classifyRoomMention('everyone', MEMBERS)).toBe('broadcast');
    expect(classifyRoomMention('all', MEMBERS)).toBe('broadcast');
    expect(classifyRoomMention('user', MEMBERS)).toBe('human');
    expect(classifyRoomMention('nobody', MEMBERS)).toBeNull();
    expect(classifyRoomMention('', MEMBERS)).toBeNull();
  });
});

describe('splitMentionSegments', () => {
  it('命中词表的 token 成段，其余原文连段', () => {
    const segs = splitMentionSegments('@alice 看下 @小明 的意见，@nobody 保持原文', MEMBERS);
    expect(segs).toEqual([
      { text: '@alice', kind: 'agent' },
      { text: ' 看下 ' },
      { text: '@小明', kind: 'agent' },
      { text: ' 的意见，@nobody 保持原文' },
    ]);
  });

  it('broadcast/human 各归其类', () => {
    const segs = splitMentionSegments('@everyone 开会，@user 裁决一下', MEMBERS);
    expect(segs[0]).toEqual({ text: '@everyone', kind: 'broadcast' });
    expect(segs[2]).toEqual({ text: '@user', kind: 'human' });
  });

  it('邮箱整体成一个未知 token，不染（对齐 Hermes 的取舍）', () => {
    const segs = splitMentionSegments('联系 ops@example.com 或 @alice', MEMBERS);
    // @example.com 未知 → 原文；@alice 命中
    expect(segs).toEqual([
      { text: '联系 ops@example.com 或 ' },
      { text: '@alice', kind: 'agent' },
    ]);
  });

  it('无 @ 与全未知 → 原文单段', () => {
    expect(splitMentionSegments('没有提及', MEMBERS)).toEqual([{ text: '没有提及' }]);
    expect(splitMentionSegments('@nobody 不认识', MEMBERS)).toEqual([{ text: '@nobody 不认识' }]);
  });

  it('尾部标点与后端清洗同规则：@bob. / @alice: 仍染色，标点留正文', () => {
    expect(splitMentionSegments('@alice. 继续', MEMBERS)).toEqual([
      { text: '@alice', kind: 'agent' },
      { text: '. 继续' },
    ]);
    expect(splitMentionSegments('@alice: 继续', MEMBERS)).toEqual([
      { text: '@alice', kind: 'agent' },
      // `:` 不在 MENTION_TOKEN_RE 词类内，本就落在正文段
      { text: ': 继续' },
    ]);
    expect(classifyRoomMention('alice.', MEMBERS)).toBe('agent');
  });
});
