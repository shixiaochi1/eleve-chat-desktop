import { describe, it, expect } from 'vitest';
import { ACTIVE_WINDOW_S, isBotActive } from './bot-activity';

/** `last_active` 是 epoch **秒**，入口是 `nowMs`（毫秒）——换算必须在实现内。 */
describe('isBotActive — 90s 活性窗口（对齐 Hermes ACTIVE_WINDOW_S）', () => {
  const nowMs = 1_700_000_000_000; // 固定时刻，秒 = 1_700_000_000
  const nowS = nowMs / 1000;

  it('窗口边界：刚好在窗内 → true；等于窗口 → false（严格小于）', () => {
    expect(isBotActive(nowS - (ACTIVE_WINDOW_S - 1), nowMs)).toBe(true);
    expect(isBotActive(nowS - ACTIVE_WINDOW_S, nowMs)).toBe(false);
  });

  it('刚刚的秒级时间戳被识别（调用方传秒，实现做换算）', () => {
    // 这是最容易写错的地方：若实现忘除 1000，任何秒级时间戳都会「活跃」几十亿秒
    expect(isBotActive(nowS - 5, nowMs)).toBe(true);
    expect(isBotActive(nowS - 100, nowMs)).toBe(false);
  });

  it('缺失 / 0 / 非法 → false（未知不能当活跃）', () => {
    expect(isBotActive(null, nowMs)).toBe(false);
    expect(isBotActive(undefined, nowMs)).toBe(false);
    expect(isBotActive(0, nowMs)).toBe(false);
    expect(isBotActive(Number.NaN, nowMs)).toBe(false);
  });

  it('未来时间戳（时钟偏差）→ 视为活跃，不抛', () => {
    expect(isBotActive(nowS + 10, nowMs)).toBe(true);
  });
});
