import { describe, it, expect } from 'vitest';
import { filterVisibleRooms, toggleMember } from './roster-prefs';

const room = (id: string) => ({ room_id: id });

// 🔴 round-108：排序用例已迁到 `roster-filter.test.ts`（`sortByPinThenActivity`）——
// 排序归 roster-filter，本模块只剩"偏好存取 + 隐藏过滤"。

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
