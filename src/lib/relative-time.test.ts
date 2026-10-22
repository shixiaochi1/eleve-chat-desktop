import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './relative-time';

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
