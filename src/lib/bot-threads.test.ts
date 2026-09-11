import { describe, it, expect } from 'vitest';
import { groupEventsByThread, LEGACY_THREAD, threadReplyCount, threadSummaryLabel } from './bot-threads';
import type { BotRoomEvent } from '../utils/api';

let seq = 0;
function ev(kind: string, payload: Record<string, unknown>, eventId?: string, at?: number): BotRoomEvent {
  seq += 1;
  return {
    seq,
    event_id: eventId ?? `${kind}:${seq}`,
    kind,
    actor: { kind: 'system', id: 'x' },
    payload,
    created_at: at ?? 1000 + seq,
  };
}

describe('groupEventsByThread', () => {
  it('主输入框开新线程：thread 缺省 = 自己的 event_id', () => {
    const events = [
      ev('room.created', {}, 'room:created:1'),
      ev('message.user', { text: '第一轮' }, 'user:a'),
      ev('message.member', { text: '回', member_id: 'm1' }),
    ];
    const g = groupEventsByThread(events);
    expect(g).toHaveLength(2);
    expect(g[0].thread).toBe(LEGACY_THREAD); // 首条用户消息之前的房间级事件
    expect(g[1].thread).toBe('user:a');
    expect(g[1].events).toHaveLength(2);
    expect(threadSummaryLabel(g[1])).toBe('第一轮');
    expect(threadReplyCount(g[1])).toBe(1);
  });

  it('线程内回复：新消息自己的 event_id 不同，但归到原线程', () => {
    const events = [
      ev('message.user', { text: '开线程', thread: 'user:a' }, 'user:a'),
      ev('message.member', { text: '答', thread: 'user:a' }),
      // 续发：event_id 是 user:b，thread 仍指向 user:a
      ev('message.user', { text: '接着说', thread: 'user:a' }, 'user:b'),
      ev('message.member', { text: '再答', thread: 'user:a' }),
    ];
    const g = groupEventsByThread(events);
    expect(g).toHaveLength(1);
    expect(g[0].thread).toBe('user:a');
    expect(g[0].events).toHaveLength(4);
    expect(threadReplyCount(g[0])).toBe(2);
  });

  it('两条线程按最后活跃升序 —— 最新的在最后（贴输入框）', () => {
    const events = [
      ev('message.user', { text: 'A' }, 'user:a', 100),
      ev('message.member', { text: 'a1', thread: 'user:a' }, undefined, 110),
      ev('message.user', { text: 'B' }, 'user:b', 200),
      ev('message.member', { text: 'b1', thread: 'user:b' }, undefined, 210),
      // A 线程之后又活跃 → A 反而排到最后
      ev('message.user', { text: 'A2', thread: 'user:a' }, 'user:a2', 300),
    ];
    const g = groupEventsByThread(events);
    expect(g.map((x) => x.thread)).toEqual(['user:b', 'user:a']);
    expect(g[g.length - 1].lastAt).toBe(300);
  });

  it('老日志（无 thread 字段）：回落到"最后一条用户消息之后"的边界', () => {
    const events = [
      ev('message.user', { text: '老一轮' }, 'user:1', 100),
      ev('message.member', { text: 'x' }, undefined, 110),
      ev('turn.settled', {}, undefined, 120),
      ev('message.user', { text: '老两轮' }, 'user:2', 200),
      ev('message.member', { text: 'y' }, undefined, 210),
    ];
    const g = groupEventsByThread(events);
    expect(g.map((x) => x.thread)).toEqual(['user:1', 'user:2']);
    // 用本用例自己的 seq（seq 是跨用例累加的计数器，不写死绝对值）
    expect(g[0].events.map((e) => e.seq)).toEqual(events.slice(0, 3).map((e) => e.seq));
    expect(g[1].events.map((e) => e.seq)).toEqual(events.slice(3).map((e) => e.seq));
  });

  it('room.activity 的 thread_id 也参与定组', () => {
    const events = [
      ev('message.user', { text: 'A' }, 'user:a', 100),
      ev('message.user', { text: 'B' }, 'user:b', 200),
      // A 的收敛标记来得很晚（drive 收口），必须回到 A 组而不是当前游标 B
      ev('room.activity', { status: 'settled', thread_id: 'user:a' }, undefined, 300),
    ];
    const g = groupEventsByThread(events);
    const a = g.find((x) => x.thread === 'user:a')!;
    expect(a.events.map((e) => e.kind)).toEqual(['message.user', 'room.activity']);
    const b = g.find((x) => x.thread === 'user:b')!;
    expect(b.events).toHaveLength(1);
  });

  it('同秒事件保持写入顺序（分组不在重渲染间跳动）', () => {
    const events = [
      ev('message.user', { text: 'A' }, 'user:a', 500),
      ev('message.user', { text: 'B' }, 'user:b', 500),
    ];
    const g = groupEventsByThread(events);
    expect(g.map((x) => x.thread)).toEqual(['user:a', 'user:b']);
  });

  it('空日志 → 空分组（不造幽灵线程）', () => {
    expect(groupEventsByThread([])).toEqual([]);
  });
});
