import { describe, it, expect } from 'vitest';
import {
  ACTIVE_WINDOW_S,
  WORKER_ACTIVE_WINDOW_S,
  botStalledSecs,
  isBotActive,
  isBotWorkerActive,
  isGatewayBusy,
} from './bot-activity';

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

/**
 * 🔴 round-106：worker 一路（对齐 Hermes `workerActiveAt`）。
 *
 * 窗口比 chat 宽（150 vs 90），因为 worker 至少每 60s 心跳一次，要桥接一次漏跳。
 */
describe('isBotWorkerActive — 150s worker 心跳窗口（对齐 Hermes WORKER_ACTIVE_WINDOW_S）', () => {
  const nowMs = 1_700_000_000_000;
  const nowS = nowMs / 1000;
  const row = (lastActive: number | null | undefined) => ({
    id: 'w1',
    source: 'kanban',
    title: '',
    last_active: lastActive,
  });

  it('窗口比 chat 宽——95s 前的 worker 心跳仍算活跃，chat 早已不算', () => {
    // 两个窗口的差异必须真的存在，否则这第二路输入等于没加
    expect(isBotWorkerActive(row(nowS - 95), nowMs)).toBe(true);
    expect(isBotActive(nowS - 95, nowMs)).toBe(false);
  });

  it('边界：刚好在窗内 → true；等于窗口 → false', () => {
    expect(isBotWorkerActive(row(nowS - (WORKER_ACTIVE_WINDOW_S - 1)), nowMs)).toBe(true);
    expect(isBotWorkerActive(row(nowS - WORKER_ACTIVE_WINDOW_S), nowMs)).toBe(false);
  });

  it('worker 心跳过期（跑完/卡死）→ false', () => {
    expect(isBotWorkerActive(row(nowS - 200), nowMs)).toBe(false);
  });

  it('无 worker（null / undefined / 缺 last_active / 0）→ false', () => {
    expect(isBotWorkerActive(null, nowMs)).toBe(false);
    expect(isBotWorkerActive(undefined, nowMs)).toBe(false);
    expect(isBotWorkerActive({}, nowMs)).toBe(false);
    expect(isBotWorkerActive(row(null), nowMs)).toBe(false);
    expect(isBotWorkerActive(row(0), nowMs)).toBe(false);
  });
});

/**
 * 🔴 2026-09-15（对齐 Hermes roster `botMood = workerActive || (本机 && gateway busy)`
 * + `gateway/session_stall.py`）：本机 gateway 的运行态两路。
 *
 * 这两路此前**不可得**（见 `bot-activity.ts` 文件头记录：*"gateway busy ❌ 仍不可得"*），
 * 现由后端 `bots.roster` 的 `busy` / `stalled_secs` 透传。
 */
describe('isGatewayBusy — 本机会话正在跑一轮（botMood 的 gateway busy 一路）', () => {
  it('true ⇒ 忙碌', () => {
    expect(isGatewayBusy(true)).toBe(true);
  });

  it('false / null / undefined（旧后端、远端行）⇒ false —— 未知不得当忙碌', () => {
    expect(isGatewayBusy(false)).toBe(false);
    expect(isGatewayBusy(null)).toBe(false);
    expect(isGatewayBusy(undefined)).toBe(false);
  });
});

describe('botStalledSecs — 会话卡死空闲秒数（判据在**后端**，前端只呈现）', () => {
  it('正秒数 ⇒ 向下取整返回', () => {
    expect(botStalledSecs(301.9)).toBe(301);
    expect(botStalledSecs(1)).toBe(1);
    expect(botStalledSecs(600)).toBe(600);
  });

  it('0 / 负数 / 缺失 / 非有限值 ⇒ null —— 未知不得当卡死', () => {
    expect(botStalledSecs(0)).toBeNull();
    expect(botStalledSecs(-5)).toBeNull();
    expect(botStalledSecs(null)).toBeNull();
    expect(botStalledSecs(undefined)).toBeNull();
    expect(botStalledSecs(Number.NaN)).toBeNull();
    expect(botStalledSecs(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
