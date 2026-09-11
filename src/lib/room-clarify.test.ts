/**
 * 🔴 round-111 回归：群聊 clarify/approval 注意力必须是**派生值**，不能与
 * 「成员 @ 了你」共用同一个可写标志。
 *
 * 对齐 Hermes `ad08688bc6 fix(bot-mode): derive group clarify/approval
 * attention from $groupClarify instead of duplicating it into $groupNeedsYou`
 * ——那边 `$groupNeedsYou` 被两个独立来源写，任何一侧的清位都会抹掉另一侧
 * 仍然成立的信号，留下一盏"背后什么都没有"的徽标（或反过来熄灭一盏该亮的）。
 *
 * ELEVE 的形态：`noteRoomClarify` / `clearRoomClarify` / `dropRoomClarify`
 * 维护 `roomId → 未决 requestId 集`，渲染处与 `roomsNeedingYou` 取并集。
 */
import { describe, it, expect } from 'vitest';
import {
  clearRoomClarify,
  dropRoomClarify,
  getRoomsWithPendingClarify,
  noteRoomClarify,
} from '../plugins/bots/state';

// 模块级 store 无 reset API：每个用例用独立 roomId，避免用例间串味。
let seq = 0;
const room = () => `r111-${++seq}`;
const req = () => `req-${++seq}`;

describe('roomsWithPendingClarify — 未决交互派生集合', () => {
  it('request 置位、resolved 撤位', () => {
    const r = room();
    const q = req();
    expect(getRoomsWithPendingClarify().has(r)).toBe(false);
    noteRoomClarify(r, q);
    expect(getRoomsWithPendingClarify().has(r)).toBe(true);
    clearRoomClarify(r, q);
    expect(getRoomsWithPendingClarify().has(r)).toBe(false);
  });

  it('同房间多条未决：清掉一条不熄灯，清完才熄（对齐"某一条 resolved 不等于全清"）', () => {
    const r = room();
    const a = req();
    const b = req();
    noteRoomClarify(r, a);
    noteRoomClarify(r, b);
    expect(getRoomsWithPendingClarify().has(r)).toBe(true);
    clearRoomClarify(r, a);
    expect(getRoomsWithPendingClarify().has(r)).toBe(true);
    clearRoomClarify(r, b);
    expect(getRoomsWithPendingClarify().has(r)).toBe(false);
  });

  it('多房间互不影响（覆盖"未打开的房间也要能亮"）', () => {
    const r1 = room();
    const r2 = room();
    noteRoomClarify(r1, req());
    noteRoomClarify(r2, req());
    const set = getRoomsWithPendingClarify();
    expect(set.has(r1) && set.has(r2)).toBe(true);
  });

  it('幂等：重复 note 同一条、clear 不存在的条目都不改变结果', () => {
    const r = room();
    const q = req();
    noteRoomClarify(r, q);
    noteRoomClarify(r, q);
    clearRoomClarify(r, q);
    // 已清空 —— 再 clear 一次不得把房间重新加回
    clearRoomClarify(r, q);
    expect(getRoomsWithPendingClarify().has(r)).toBe(false);
    clearRoomClarify(room(), req());
    expect(getRoomsWithPendingClarify().has(r)).toBe(false);
  });

  it('房间解散 → 未决信号全部退役（对齐 Hermes "retire late work after disband"）', () => {
    const r = room();
    noteRoomClarify(r, req());
    noteRoomClarify(r, req());
    expect(getRoomsWithPendingClarify().has(r)).toBe(true);
    dropRoomClarify(r);
    expect(getRoomsWithPendingClarify().has(r)).toBe(false);
    // 解散后迟到的 resolved 不得抛错
    expect(() => clearRoomClarify(r, 'late-req')).not.toThrow();
  });

  it('空 id 不入集合（事件载荷缺字段时不得点亮任意房间）', () => {
    noteRoomClarify('', req());
    noteRoomClarify(room(), '');
    expect(getRoomsWithPendingClarify().has('')).toBe(false);
  });

  it('快照不可变：每次变更返回新集合（useSyncExternalStore 靠 Object.is 判变化）', () => {
    const r = room();
    const before = getRoomsWithPendingClarify();
    noteRoomClarify(r, req());
    const after = getRoomsWithPendingClarify();
    expect(after).not.toBe(before);
    expect(before.has(r)).toBe(false); // 旧快照不被原地改写
  });
});
