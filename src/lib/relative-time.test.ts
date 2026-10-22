import { describe, it, expect } from 'vitest';
import { formatChatListTime, formatRelativeTime } from './relative-time';

describe('formatRelativeTime', () => {
  const NOW = 1_700_000_000_000; // 毫秒

  it('空值/非法值返回空串', () => {
    expect(formatRelativeTime(null, NOW)).toBe('');
    expect(formatRelativeTime(undefined, NOW)).toBe('');
    expect(formatRelativeTime(0, NOW)).toBe('');
    expect(formatRelativeTime(-5, NOW)).toBe('');
  });

  it('分钟内 = 刚刚', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('刚刚');
  });

  it('分钟 / 小时', () => {
    expect(formatRelativeTime(NOW - 3 * 60_000, NOW)).toBe('3 分钟前');
    expect(formatRelativeTime(NOW - 5 * 3_600_000, NOW)).toBe('5 小时前');
  });

  it('昨天 / N 天前', () => {
    expect(formatRelativeTime(NOW - 26 * 3_600_000, NOW)).toBe('昨天');
    expect(formatRelativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3 天前');
  });

  it('超过 7 天显示日期', () => {
    const out = formatRelativeTime(NOW - 30 * 86_400_000, NOW);
    expect(out).toMatch(/^\d{1,2}\/\d{1,2}$/);
  });

  it('秒级 epoch 自动换算', () => {
    expect(formatRelativeTime(Math.floor(NOW / 1000) - 120, NOW)).toBe('2 分钟前');
  });

  it('未来时间钳制为刚刚', () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('刚刚');
  });
});

describe('formatChatListTime（微信式列表角标）', () => {
  // 用本地时间构造，避免时区导致断言漂移
  const now = new Date(2026, 9, 23, 15, 30, 0); // 2026-10-23 15:30 本地
  const NOW = now.getTime();
  const ts = (d: Date) => Math.floor(d.getTime() / 1000); // 秒级 epoch

  it('空值返回空串', () => {
    expect(formatChatListTime(null, NOW)).toBe('');
    expect(formatChatListTime(0, NOW)).toBe('');
  });

  it('今天 = HH:mm（补零）', () => {
    expect(formatChatListTime(ts(new Date(2026, 9, 23, 9, 5)), NOW)).toBe('09:05');
    expect(formatChatListTime(ts(new Date(2026, 9, 23, 15, 29)), NOW)).toBe('15:29');
  });

  it('昨天 = 昨天', () => {
    expect(formatChatListTime(ts(new Date(2026, 9, 22, 23, 59)), NOW)).toBe('昨天');
  });

  it('今年更早 = M/D；跨年 = YYYY/M/D', () => {
    expect(formatChatListTime(ts(new Date(2026, 0, 5, 8, 0)), NOW)).toBe('1/5');
    expect(formatChatListTime(ts(new Date(2025, 11, 31, 8, 0)), NOW)).toBe('2025/12/31');
  });

  it('毫秒级 epoch 同样支持', () => {
    expect(formatChatListTime(new Date(2026, 9, 23, 7, 8).getTime(), NOW)).toBe('07:08');
  });
});
