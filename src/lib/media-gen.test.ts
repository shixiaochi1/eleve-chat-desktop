import { describe, it, expect } from 'vitest';
import { buildRoomImagePrompt, describeGenError, ImageGenError } from './media-gen';

/**
 * 与 Hermes 逐字同构的 prompt 模板（`group-chat-parts.tsx:68-77`）：
 *
 * ```
 * Group chat icon for an AI agent team called "<who>". \
 * Friendly minimal emblem, bold flat vector style, solid color background, centered, no text.
 * ```
 * `<who>` = 房间名 +（有成员）` — a team of A, B`
 */
describe('buildRoomImagePrompt — 对齐 Hermes 模板', () => {
  it('房间名 + 成员 → who = 「名 — a team of A, B」', () => {
    expect(buildRoomImagePrompt('设计组', ['alice', 'bob'])).toBe(
      'Group chat icon for an AI agent team called "设计组 — a team of alice, bob". ' +
        'Friendly minimal emblem, bold flat vector style, solid color background, centered, no text.',
    );
  });

  it('无成员 → 只有房间名（不加 "a team of"）', () => {
    const p = buildRoomImagePrompt('设计组');
    expect(p).toContain('called "设计组"');
    expect(p).not.toContain('a team of');
  });

  it('空名 / 空白 → 回落 "a bot team"（对齐 Hermes fallback）', () => {
    expect(buildRoomImagePrompt('')).toContain('called "a bot team"');
    expect(buildRoomImagePrompt('   ')).toContain('called "a bot team"');
  });

  it('成员列表里的空白项被丢弃（不留 "a team of ," 这种）', () => {
    const p = buildRoomImagePrompt('组', ['alice', '', '  ', 'bob']);
    expect(p).toContain('a team of alice, bob');
  });

  it('全部成员都空 → 等价于无成员', () => {
    expect(buildRoomImagePrompt('组', ['', ' '])).not.toContain('a team of');
  });
});

describe('describeGenError — 网关错误体 → 可读中文', () => {
  const wrap = (message: string, code?: string) => ({
    error: { message, type: 'invalid_request_error', ...(code ? { code } : {}) },
  });

  it('provider_unavailable → 明确提示去配置渠道（不是"未知错误"）', () => {
    const msg = describeGenError(503, wrap('No image generation provider available', 'provider_unavailable'));
    expect(msg).toContain('生图渠道');
  });

  it('provider_not_registered → 用网关给的具体 message', () => {
    const msg = describeGenError(
      400,
      wrap("image_gen.provider 'foo' is configured but not registered", 'provider_not_registered'),
    );
    expect(msg).toContain("'foo'");
  });

  it('未知 code → 透传 message', () => {
    expect(describeGenError(500, wrap('boom'))).toBe('boom');
  });

  it('错误体缺失/非法 → 回落 HTTP 状态，不抛', () => {
    expect(describeGenError(502, null)).toContain('502');
    expect(describeGenError(502, {})).toContain('502');
    expect(describeGenError(502, 'not json')).toContain('502');
  });
});

describe('ImageGenError', () => {
  it('携带 code 且保留 message', () => {
    const e = new ImageGenError('empty_response', '空响应');
    expect(e.code).toBe('empty_response');
    expect(e.message).toBe('空响应');
    expect(e.name).toBe('ImageGenError');
    expect(e).toBeInstanceOf(Error);
  });
});
