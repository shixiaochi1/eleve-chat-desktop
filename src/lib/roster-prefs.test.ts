import { describe, it, expect } from 'vitest';
import { filterVisibleRooms, sortRoomsByPin, toggleMember } from './roster-prefs';

const room = (id: string) => ({ room_id: id });

/** Hermes `sortRosterRows`：pinned 先，同档保持原序（稳定）。 */
describe('sortRoomsByPin — 置顶优先', () => {
  it('置顶项排到最前，其余保持传入顺序', () => {
    const rooms = [room('a'), room('b'), room('c'), room('d')];
    const out = sortRoomsByPin(rooms, new Set(['c']));
    expect(out.map((r) => r.room_id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('多个置顶项之间保持传入顺序（稳定，不互相打乱）', () => {
    const out = sortRoomsByPin([room('a'), room('b'), room('c'), room('d')], new Set(['b', 'd']));
    expect(out.map((r) => r.room_id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('无置顶 / 空列表 → 原样与空', () => {
    const rooms = [room('a'), room('b')];
    expect(sortRoomsByPin(rooms, new Set()).map((r) => r.room_id)).toEqual(['a', 'b']);
    expect(sortRoomsByPin([], new Set(['x']))).toEqual([]);
  });

  it('不修改入参（返回新数组）', () => {
    const rooms = [room('a'), room('b')];
    const snapshot = rooms.map((r) => r.room_id);
    sortRoomsByPin(rooms, new Set(['b']));
    expect(rooms.map((r) => r.room_id)).toEqual(snapshot);
  });
});

/** Hermes `$showHiddenBots`：隐藏项只在开关打开时出现。 */
describe('filterVisibleRooms — 隐藏是展示层收起', () => {
  it('默认收起隐藏项', () => {
    const out = filterVisibleRooms([room('a'), room('b'), room('c')], new Set(['b']), false);
    expect(out.map((r) => r.room_id)).toEqual(['a', 'c']);
  });

  it('开关打开 → 隐藏项出现（Hermes: reveal hidden bots (dimmed)）', () => {
    const out = filterVisibleRooms([room('a'), room('b'), room('c')], new Set(['b']), true);
    expect(out.map((r) => r.room_id)).toEqual(['a', 'b', 'c']);
  });

  it('无隐藏 → 与开关无关', () => {
    const rooms = [room('a')];
    expect(filterVisibleRooms(rooms, new Set(), false).map((r) => r.room_id)).toEqual(['a']);
    expect(filterVisibleRooms(rooms, new Set(), true).map((r) => r.room_id)).toEqual(['a']);
  });
});

describe('toggleMember', () => {
  it('往返切换取反，且返回新 Set（不可变）', () => {
    const s = new Set(['a']);
    const on = toggleMember(s, 'b');
    expect([...on].sort()).toEqual(['a', 'b']);
    expect(s.has('b')).toBe(false); // 原集合不被改
    const off = toggleMember(on, 'a');
    expect([...off]).toEqual(['b']);
  });
});
