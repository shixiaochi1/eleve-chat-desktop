/**
 * 私聊行末条消息预览（对齐 Hermes `row-helpers.ts`）：
 * 剥 bot-to-bot 投递前缀、压平空白、单行截断（按码点）。
 */
import { describe, it, expect } from 'vitest';
import { formatBotPreview, BOT_PREVIEW_MAX_CHARS } from './bot-preview';

describe('formatBotPreview', () => {
  it('普通文本原样返回（仅压平空白）', () => {
    expect(formatBotPreview('  你好\n世界  ')).toBe('你好 世界');
  });

  it('剥掉现行 DM 投递前缀（🤖 name (@handle):）', () => {
    expect(formatBotPreview('Message from 🤖 Scribe (@scribe): ping 一下')).toBe('ping 一下');
  });

  it('剥掉跨机限定前缀（@handle@connection）', () => {
    expect(formatBotPreview('Message from 🤖 Scribe (@scribe@mini): 跨机问候')).toBe('跨机问候');
  });

  it('剥掉旧式方括号前缀', () => {
    expect(formatBotPreview("[Message from agent 'Scout'] 旧格式正文")).toBe('旧格式正文');
  });

  it('不误伤普通用户文本', () => {
    expect(formatBotPreview('Message from 我自己：这不是 DM 前缀')).toBe(
      'Message from 我自己：这不是 DM 前缀',
    );
  });

  it('按码点截断并补省略号（不切 surrogate pair）', () => {
    const text = '😀'.repeat(BOT_PREVIEW_MAX_CHARS + 5);
    const out = formatBotPreview(text);
    expect(Array.from(out).length).toBe(BOT_PREVIEW_MAX_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('空输入 = 空串', () => {
    expect(formatBotPreview(null)).toBe('');
    expect(formatBotPreview('   ')).toBe('');
  });
});
