/**
 * 🔴 round-111：房间展示顺序（对齐 Hermes `group-order.test.ts`）。
 *
 * 逐条镜像 Hermes 的两组断言：legacy 保持活动度序、显式排序后只置换 band 内
 * 的房间；上/下移只在**同 pin band + 可见**的邻居间交换，隐藏房间保留槽位。
 */
import { describe, it, expect } from 'vitest';
import type { BotRoom } from '../utils/api';
import { reorderRosterRooms, rosterOrderWrites, sortRosterRooms } from './group-order';

function room(patch: Partial<BotRoom> & { room_id: string }): BotRoom {
  return { name: patch.room_id, members: [], next_seq: 1, created_at: 0, ...patch } as BotRoom;
}

/** activity 用 name 查表注入（与 Hermes 测试的 `activity` 字段等价）。 */
const ACTIVITY: Record<string, number> = { Older: 1, Newer: 3, Pinned: 0, Hidden: 2 };
const activityOf = (r: BotRoom) => ACTIVITY[r.name] ?? 0;

const rooms = [
  room({ room_id: 'Older' }),
  room({ room_id: 'Newer' }),
  room({ room_id: 'Pinned', pinned: true }),
];

describe('房间展示顺序', () => {
  it('未显式排序前保持活动度序；显式排序后只置换 band 内的房间', () => {
    // 无 roster_order：pin 外层 band + 活动度降序
    expect(sortRosterRooms(rooms, activityOf).map((r) => r.room_id)).toEqual([
      'Pinned',
      'Newer',
      'Older',
    ]);

    const ordered = rooms.map((r) =>
      r.room_id === 'Older'
        ? { ...r, roster_order: 0 }
        : r.room_id === 'Newer'
          ? { ...r, roster_order: 1 }
          : r,
    );
    expect(sortRosterRooms(ordered, activityOf).map((r) => r.room_id)).toEqual([
      'Pinned',
      'Older',
      'Newer',
    ]);

    // 🔴 活动度变化**不得**推翻显式顺序（只有房间 slot 被置换）
    const hotter = ordered.map((r) => (r.room_id === 'Newer' ? { ...r, created_at: 999 } : r));
    expect(sortRosterRooms(hotter, () => 0).map((r) => r.room_id)).toEqual([
      'Pinned',
      'Older',
      'Newer',
    ]);
    // 未显式排序的房间必须落到队尾，且彼此保持活动度序
    const partial = rooms.map((r) => (r.room_id === 'Older' ? { ...r, roster_order: 0 } : r));
    expect(sortRosterRooms(partial, activityOf).map((r) => r.room_id)).toEqual([
      'Pinned',
      'Older',
      'Newer',
    ]);
    // 不动入参
    expect(rooms[0].room_id).toBe('Older');
  });

  it('只移动同 band 的可见邻居；隐藏房间保留槽位；过期目标返回 null', () => {
    const ordered = sortRosterRooms(
      rooms.filter((r) => r.room_id !== 'Hidden'),
      activityOf,
    );
    expect(ordered.map((r) => r.room_id)).toEqual(['Pinned', 'Newer', 'Older']);

    // Older 上移一格拉到 Newer 之前
    expect(reorderRosterRooms(ordered, 'Older', -1)).toEqual(['Pinned', 'Older', 'Newer']);
    // Newer 已在 band 顶部 → 无处可移
    expect(reorderRosterRooms(ordered, 'Newer', -1)).toBeNull();
    // 榜上无名（已解散/已删）→ null，不得乱动顺序
    expect(reorderRosterRooms(ordered, 'deleted', 1)).toBeNull();

    // 隐藏房间插在中间：可见集只含 Newer/Older，但它必须原封不动留在槽位 2
    const hidden = room({ room_id: 'Hidden', name: 'Hidden' });
    const withHidden = [ordered[0], ordered[1], hidden, ordered[2]];
    expect(reorderRosterRooms(withHidden, 'Older', -1, ['Newer', 'Older'])).toEqual([
      'Pinned',
      'Older',
      'Hidden',
      'Newer',
    ]);
    // 跨 band 不可移动：Pinned 与 Older 不同 band
    expect(reorderRosterRooms(ordered, 'Pinned', 1, ['Pinned', 'Newer', 'Older'])).toBeNull();
  });

  it('写回值 = 新顺序的下标，且只写真正变化的行', () => {
    const partial = rooms.map((r) => (r.room_id === 'Pinned' ? { ...r, roster_order: 0 } : r));
    // 新顺序 Pinned(0, 未变) / Older(1) / Newer(2)
    expect(rosterOrderWrites(partial, ['Pinned', 'Older', 'Newer'])).toEqual([
      { roomId: 'Older', rosterOrder: 1 },
      { roomId: 'Newer', rosterOrder: 2 },
    ]);
    // 全部已就位 → 零写入（拖动无变化时不该发 RPC）
    const allSet = rooms.map((r) => ({ ...r, roster_order: ['Pinned', 'Older', 'Newer'].indexOf(r.room_id) }));
    expect(rosterOrderWrites(allSet, ['Pinned', 'Older', 'Newer'])).toEqual([]);
  });
});
