import { describe, it, expect } from 'vitest';
import { LEGACY_THREAD, threadLayout } from './bot-threads';
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

/**
 * 🔴 round-120：测的是**到达顺序布局**，不是分组。
 * 对齐 Hermes `group-chat-view.tsx:1044-1056`——消息顺序 = 日志顺序；
 * 线程 id 只决定"回复入口插在哪"（`threadEnds`）。
 * 旧的 `groupEventsByThread`（按线程归并 + 按最后活跃排序 + 摘要行）已退役。
 */
describe('threadLayout — 到达顺序 + 每线程收尾位置（对齐 Hermes threadEnds）', () => {
  it('threadOf 与事件等长同序（永不重排）', () => {
    const events = [
      ev('room.created', {}, 'room:created:1'),
      ev('message.user', { text: '第一轮' }, 'user:a'),
      ev('message.member', { text: '回', member_id: 'm1' }),
    ];
    const { threadOf, ends } = threadLayout(events);
    expect(threadOf).toHaveLength(events.length);
    expect(threadOf).toEqual([LEGACY_THREAD, 'user:a', 'user:a']);
    // 收尾位置 = 该线程最后一个事件的索引（与 Hermes 同构）
    expect(ends.get(LEGACY_THREAD)).toBe(0);
    expect(ends.get('user:a')).toBe(2);
  });

  it('主输入框开新线程：thread 缺省 = 自己的 event_id', () => {
    const events = [ev('message.user', { text: 'A' }, 'user:a')];
    expect(threadLayout(events).threadOf).toEqual(['user:a']);
  });

  it('线程内回复：事件 id 不同但归到原线程', () => {
    const events = [
      ev('message.user', { text: '开线程', thread: 'user:a' }, 'user:a'),
      ev('message.member', { text: '答', thread: 'user:a' }),
      ev('message.user', { text: '接着说', thread: 'user:a' }, 'user:b'),
      ev('message.member', { text: '再答', thread: 'user:a' }),
    ];
    const { threadOf, ends } = threadLayout(events);
    expect(threadOf).toEqual(['user:a', 'user:a', 'user:a', 'user:a']);
    expect(ends.size).toBe(1);
    expect(ends.get('user:a')).toBe(3);
  });

  it('🔴 两线程交错时保持到达顺序（不归并、不重排）', () => {
    const events = [
      ev('message.user', { text: 'A' }, 'user:a', 100),
      ev('message.user', { text: 'B' }, 'user:b', 200),
      ev('message.member', { text: 'A 的迟到回答', thread: 'user:a' }, undefined, 300),
      ev('message.member', { text: 'B 的回答', thread: 'user:b' }, undefined, 400),
    ];
    const { threadOf, ends } = threadLayout(events);
    // 到达顺序：A、B、A 的回答、B 的回答——绝不重排成 A,A,B,B
    expect(threadOf).toEqual(['user:a', 'user:b', 'user:a', 'user:b']);
    // A 的最后事件在索引 2（回复入口插那里）、B 在索引 3
    expect(ends.get('user:a')).toBe(2);
    expect(ends.get('user:b')).toBe(3);
  });

  it('老日志（无 thread 字段）：回落到"最后一条用户消息之后"的游标', () => {
    const events = [
      ev('message.user', { text: '老一轮' }, 'user:1', 100),
      ev('message.member', { text: 'x' }, undefined, 110),
      ev('turn.settled', {}, undefined, 120),
      ev('message.user', { text: '老两轮' }, 'user:2', 200),
      ev('message.member', { text: 'y' }, undefined, 210),
    ];
    const { threadOf, ends } = threadLayout(events);
    expect(threadOf).toEqual(['user:1', 'user:1', 'user:1', 'user:2', 'user:2']);
    expect(ends.get('user:1')).toBe(2);
    expect(ends.get('user:2')).toBe(4);
  });

  it('room.activity 的 thread_id 参与定组（迟到的收敛标记回到原线程）', () => {
    const events = [
      ev('message.user', { text: 'A' }, 'user:a', 100),
      ev('message.user', { text: 'B' }, 'user:b', 200),
      ev('room.activity', { status: 'settled', thread_id: 'user:a' }, undefined, 300),
    ];
    const { threadOf, ends } = threadLayout(events);
    expect(threadOf).toEqual(['user:a', 'user:b', 'user:a']);
    expect(ends.get('user:a')).toBe(2);
    expect(ends.get('user:b')).toBe(1);
  });

  it('无线程上下文的房间级事件 → LEGACY 桶', () => {
    const { threadOf } = threadLayout([ev('room.created', {}, 'room:created:1')]);
    expect(threadOf).toEqual([LEGACY_THREAD]);
  });

  it('空日志 → 空布局（不造幽灵线程）', () => {
    const { threadOf, ends } = threadLayout([]);
    expect(threadOf).toEqual([]);
    expect(ends.size).toBe(0);
  });
});
