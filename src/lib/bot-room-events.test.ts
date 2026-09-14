import { describe, it, expect } from 'vitest';
import type { BotRoomEvent } from '../utils/api';
import {
  RETAINED_EVENTS,
  mergeRoomEvents,
  oldestInflightStartIndex,
  oldestPendingInteractionIndex,
  retainLoadedEvents,
} from './bot-room-events';

function ev(
  seq: number,
  kind = 'message.user',
  eventId = `user:${seq}`,
  payload: Record<string, unknown> = { text: `m${seq}` },
): BotRoomEvent {
  return {
    seq,
    event_id: eventId,
    kind,
    actor: { kind: 'user', id: 'desktop' },
    payload,
    created_at: 1_700_000_000 + seq,
  };
}

const started = (seq: number, turnId: string) =>
  ev(seq, 'turn.started', `turn:${turnId}:started`);
const terminal = (seq: number, turnId: string) =>
  ev(seq, 'turn.settled', `turn:${turnId}:terminal`);
const requested = (seq: number, rid: string) =>
  ev(seq, 'interaction.request', `interaction:req:${rid}`, { request_id: rid });
const resolved = (seq: number, rid: string) =>
  ev(seq, 'interaction.resolved', `interaction:res:${rid}`, { request_id: rid });

describe('mergeRoomEvents — 增量并入', () => {
  it('尾部单调追加走快路径（结果是 current 之后的新数组，保序）', () => {
    const cur = [ev(1), ev(2)];
    const out = mergeRoomEvents(cur, [ev(3), ev(4)]);
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(out).not.toBe(cur);
  });

  it('无新增 → 返回**原引用**（调用方据此跳过 setState）', () => {
    const cur = [ev(1), ev(2)];
    expect(mergeRoomEvents(cur, [])).toBe(cur);
    expect(mergeRoomEvents(cur, [ev(2), ev(1)])).toBe(cur); // 全是重复
  });

  it('重叠增量（重连补齐）不去重出重复行，且结果升序', () => {
    const cur = [ev(1), ev(2)];
    const out = mergeRoomEvents(cur, [ev(2), ev(3)]);
    expect(out.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('乱序增量也要收敛成升序（快路径只用于严格递增且整体在尾部之后）', () => {
    const cur = [ev(1)];
    const out = mergeRoomEvents(cur, [ev(5), ev(4)]);
    expect(out.map((e) => e.seq)).toEqual([1, 4, 5]);
  });

  it('向上翻历史（整体在 current 之前）合并后仍升序', () => {
    const cur = [ev(201), ev(202)];
    const out = mergeRoomEvents(cur, [ev(199), ev(200)]);
    expect(out.map((e) => e.seq)).toEqual([199, 200, 201, 202]);
  });

  it('空 current 也成立', () => {
    expect(mergeRoomEvents([], [ev(2), ev(1)]).map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('oldestInflightStartIndex — 忙态配对的锚点', () => {
  it('有在飞轮 → 指向最早那条未收口的 turn.started', () => {
    const events = [ev(1), started(2, 'd1.r0.p0.s1.m1'), terminal(3, 'd1.r0.p0.s1.m1'), started(4, 'd2.r0.p0.s3.m2')];
    expect(oldestInflightStartIndex(events)).toBe(3);
  });

  it('全部已收口 → -1', () => {
    const events = [started(2, 'd1.r0.p0.s1.m1'), terminal(3, 'd1.r0.p0.s1.m1')];
    expect(oldestInflightStartIndex(events)).toBe(-1);
  });

  it('无 turn 事件 → -1', () => {
    expect(oldestInflightStartIndex([ev(1), ev(2)])).toBe(-1);
  });
});

describe('oldestPendingInteractionIndex — 未决交互的下界锚', () => {
  it('未 resolve 的请求 → 指回它首次出现的下标', () => {
    const events = [ev(1), requested(2, 'r1'), ev(3)];
    expect(oldestPendingInteractionIndex(events)).toBe(1);
  });

  it('已 resolve → -1', () => {
    const events = [requested(1, 'r1'), resolved(2, 'r1')];
    expect(oldestPendingInteractionIndex(events)).toBe(-1);
  });

  it('多个请求只锚最早那条未决的（已解除的不锚）', () => {
    const events = [requested(1, 'r1'), resolved(2, 'r1'), requested(3, 'r2')];
    expect(oldestPendingInteractionIndex(events)).toBe(2);
  });

  it('无交互事件 → -1', () => {
    expect(oldestPendingInteractionIndex([ev(1), ev(2)])).toBe(-1);
  });
});

describe('retainLoadedEvents — 有界本地记录', () => {
  const many = Array.from({ length: 10 }, (_, i) => ev(i + 1));

  it('超出上限 → 裁掉最旧的，保留最新 keep 条', () => {
    const { events, dropped } = retainLoadedEvents(many, 4);
    expect(dropped).toBe(6);
    expect(events.map((e) => e.seq)).toEqual([7, 8, 9, 10]);
  });

  it('未超上限 → 原引用 + dropped 0', () => {
    const { events, dropped } = retainLoadedEvents(many, 10);
    expect(events).toBe(many);
    expect(dropped).toBe(0);
  });

  it('绝不越过"在飞轮的开轮事件"（忙态配对必须看得到 turn.started）', () => {
    const events = [ev(1), ev(2), started(3, 'd3.r0.p0.s2.m1'), ev(4), ev(5), ev(6), ev(7), ev(8), ev(9), ev(10)];
    const { events: kept, dropped } = retainLoadedEvents(events, 4);
    expect(dropped).toBe(2); // 只裁到锚点，而不是裁到"最新 4 条"
    expect(kept[0].seq).toBe(3);
    expect(oldestInflightStartIndex(kept)).toBe(0); // 开轮事件仍在，忙态配对照常
  });

  it('开轮事件就是唯一事件时也不裁（容忍过度保守）', () => {
    const events = [started(1, 'd1.r0.p0.s0.m1')];
    const { events: kept, dropped } = retainLoadedEvents(events, 0);
    expect(kept).toBe(events);
    expect(dropped).toBe(0);
  });

  it('keep 非有限/负数按 0 处理（未知不当"全都要"）', () => {
    expect(retainLoadedEvents(many, Number.NaN).dropped).toBe(10);
    expect(retainLoadedEvents(many, -5).dropped).toBe(10);
  });

  it('未决交互请求同样是下界锚（卡还在 ⇒ 徽标回灌必须还能看到它）', () => {
    const events = [ev(1), requested(2, 'r1'), ...many.slice(2)];
    const { events: kept, dropped } = retainLoadedEvents(events, 2);
    expect(dropped).toBe(1);
    expect(kept[0].kind).toBe('interaction.request');
    expect(oldestPendingInteractionIndex(kept)).toBe(0);
  });

  it('两枚锚取更早的那枚（在飞轮比未决交互更早时跟在飞轮）', () => {
    const events = [ev(1), started(2, 'd1.r0.p0.s1.m1'), requested(3, 'r1'), ...many.slice(3)];
    const { events: kept, dropped } = retainLoadedEvents(events, 2);
    expect(dropped).toBe(1);
    expect(kept[0].kind).toBe('turn.started');
    expect(kept[1].kind).toBe('interaction.request'); // 两枚锚都在
  });

  it('默认上限 = 400（渲染窗口 200 的两倍；Hermes 是 96，ELEVE 更宽松）', () => {
    expect(RETAINED_EVENTS).toBe(400);
    const long = Array.from({ length: 401 }, (_, i) => ev(i + 1));
    expect(retainLoadedEvents(long).dropped).toBe(1);
  });
});
