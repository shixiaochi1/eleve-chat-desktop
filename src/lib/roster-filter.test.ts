import { describe, it, expect } from 'vitest';
import type { BotRoom, BotRosterEntry } from '../utils/api';
import {
  RECENT_ACTIVITY_WINDOW_S,
  activeFilterCount,
  botActivityMs,
  botMatchesQuery,
  filterByGateway,
  gatewayOptions,
  filterHiddenBots,
  filterHiddenRooms,
  isBotHidden,
  isBotPinned,
  kindAllowsBots,
  kindAllowsRooms,
  matchesActivityFilter,
  normalizeQuery,
  roomActivityMs,
  roomMatchesFilters,
  sortByPinThenActivity,
} from './roster-filter';

const NOW = 1_700_000_000_000; // 固定毫秒时刻
const nowS = NOW / 1000;

function bot(patch: Partial<BotRosterEntry> = {}): BotRosterEntry {
  return { profile: 'p', handle: 'p', display_name: 'P', ...patch } as BotRosterEntry;
}

function room(patch: Partial<BotRoom> = {}): BotRoom {
  return {
    room_id: 'r1',
    name: '设计讨论',
    members: [{ member_id: 'm1', profile: 'alice', handle: 'alice', display_name: 'Alice' }],
    next_seq: 1,
    created_at: 0,
    ...patch,
  } as BotRoom;
}

describe('botActivityMs — 活动度 = max(created, last_active)（Hermes activityOf）', () => {
  it('🔴 新建但没消息的 Agent 靠 created 撑住（否则活跃排序下会沉底）', () => {
    expect(botActivityMs(bot({ created_at: nowS - 10, last_active: null }))).toBe((nowS - 10) * 1000);
  });

  it('有消息时取较新的那个', () => {
    expect(botActivityMs(bot({ created_at: nowS - 100, last_active: nowS - 5 }))).toBe((nowS - 5) * 1000);
    expect(botActivityMs(bot({ created_at: nowS - 5, last_active: nowS - 100 }))).toBe((nowS - 5) * 1000);
  });

  it('两者都缺 = 0（不抛）', () => {
    expect(botActivityMs(bot())).toBe(0);
  });
});

describe('roomActivityMs — 房间活动度只取最后消息时间（Hermes groupLastActivity）', () => {
  it('有消息 = 该消息时间；无消息 = 0（**不**加 created，与 Hermes 一致）', () => {
    expect(
      roomActivityMs(room({ last_message: { text: 'x', created_at: nowS - 3, actor_kind: 'user', actor_handle: '' } })),
    ).toBe((nowS - 3) * 1000);
    expect(roomActivityMs(room({ created_at: nowS - 1, last_message: null }))).toBe(0);
  });
});

describe('matchesActivityFilter — 四档（Hermes rosterActivityMatches）', () => {
  const active = { active: true, activity: NOW - 1000 };
  const recent = { active: false, activity: NOW - 1000 };
  const stale = { active: false, activity: NOW - (RECENT_ACTIVITY_WINDOW_S + 10) * 1000 };
  const never = { active: false, activity: 0 };

  it('all 全通过', () => {
    for (const r of [active, recent, stale, never]) {
      expect(matchesActivityFilter(r, 'all', NOW)).toBe(true);
    }
  });

  it("active 只看 active 位（不看活动度）", () => {
    expect(matchesActivityFilter(active, 'active', NOW)).toBe(true);
    expect(matchesActivityFilter(recent, 'active', NOW)).toBe(false);
  });

  it('recent = 7 天窗内；older = 其余（含"从无消息"）', () => {
    expect(matchesActivityFilter(recent, 'recent', NOW)).toBe(true);
    expect(matchesActivityFilter(stale, 'recent', NOW)).toBe(false);
    expect(matchesActivityFilter(never, 'recent', NOW)).toBe(false);

    expect(matchesActivityFilter(stale, 'older', NOW)).toBe(true);
    expect(matchesActivityFilter(never, 'older', NOW)).toBe(true);
    expect(matchesActivityFilter(recent, 'older', NOW)).toBe(false);
  });

  it('窗口边界：正好 7 天算 recent（≤）', () => {
    const edge = { active: false, activity: NOW - RECENT_ACTIVITY_WINDOW_S * 1000 };
    expect(matchesActivityFilter(edge, 'recent', NOW)).toBe(true);
    expect(matchesActivityFilter({ ...edge, activity: edge.activity - 1 }, 'recent', NOW)).toBe(false);
  });
});

describe('botMatchesQuery — 匹配面（Hermes filterBots）', () => {
  const entry = bot({ profile: 'coder', handle: 'coder', display_name: '代码助手', description: '写代码的' });

  it('显示名 / profile / handle / 角色描述 / 连接名 都命中', () => {
    expect(botMatchesQuery(entry, '本机', '代码')).toBe(true);
    expect(botMatchesQuery(entry, '本机', 'CODER')).toBe(true);
    expect(botMatchesQuery(entry, '本机', '写代码')).toBe(true);
    expect(botMatchesQuery(entry, 'homelab', 'homelab')).toBe(true);
  });

  it('前导 @ 被剥掉（对齐 Hermes /^@/）', () => {
    expect(normalizeQuery('@coder')).toBe('coder');
    expect(botMatchesQuery(entry, '本机', '@coder')).toBe(true);
  });

  it('空词 = 全通过', () => {
    expect(botMatchesQuery(entry, '本机', '   ')).toBe(true);
  });

  it('不命中 = false', () => {
    expect(botMatchesQuery(entry, '本机', 'zzz')).toBe(false);
  });
});

describe('filterByGateway / gatewayOptions', () => {
  const rows = [
    { connectionId: 'local', connectionLabel: '本机' },
    { connectionId: 'c1', connectionLabel: 'homelab' },
    { connectionId: 'c1', connectionLabel: 'homelab' },
  ];

  it("'all' 不过滤；否则按 connectionId", () => {
    expect(filterByGateway(rows, 'all')).toHaveLength(3);
    expect(filterByGateway(rows, 'c1')).toHaveLength(2);
    expect(filterByGateway(rows, 'nope')).toHaveLength(0);
  });

  it('选项去重且保持插入序（本机在首，因为 union 先 push 本机）', () => {
    expect(gatewayOptions(rows)).toEqual([
      { id: 'local', label: '本机' },
      { id: 'c1', label: 'homelab' },
    ]);
  });
});

describe('roomMatchesFilters — 名称 OR 成员命中（Hermes groupMatchesRosterFilters）', () => {
  const roster = [
    { entry: bot({ profile: 'alice', handle: 'alice', display_name: 'Alice' }), connectionId: 'local', connectionLabel: '本机' },
    { entry: bot({ profile: 'bob', handle: 'bob', display_name: 'Bob' }), connectionId: 'c1', connectionLabel: 'homelab' },
  ];
  const r = room({
    name: '设计讨论',
    members: [
      { member_id: 'm1', profile: 'alice', handle: 'alice', display_name: 'Alice' },
      { member_id: 'm2', profile: 'bob', handle: 'bob', display_name: 'Bob' },
    ],
  });

  it('房间名命中', () => {
    expect(roomMatchesFilters(r, roster, '设计', 'all')).toBe(true);
  });

  it('成员命中（搜成员名也能找到房间）', () => {
    expect(roomMatchesFilters(r, roster, 'bob', 'all')).toBe(true);
  });

  it('都不命中 = false', () => {
    expect(roomMatchesFilters(r, roster, 'zzz', 'all')).toBe(false);
  });

  it("连接过滤：房间有成员在 c1 上 → 通过；只筛本机时该成员不参与", () => {
    expect(roomMatchesFilters(r, roster, '', 'c1')).toBe(true);
    // 只筛本机连接：bob 不参与匹配，但 alice 在 → 通过
    expect(roomMatchesFilters(r, roster, '', 'local')).toBe(true);
  });

  it('连接过滤：房间在那个连接上没有成员 → 整个房间被过滤掉', () => {
    const solo = room({
      members: [{ member_id: 'm1', profile: 'alice', handle: 'alice', display_name: 'Alice' }],
    });
    expect(roomMatchesFilters(solo, roster, '', 'c1')).toBe(false);
    // 且成员命中也不能把它救回来（该成员不在所筛连接上）
    expect(roomMatchesFilters(solo, roster, 'bob', 'c1')).toBe(false);
  });
});

describe('kind 过滤', () => {
  it('all / bots / groups 三态', () => {
    expect([kindAllowsBots('all'), kindAllowsRooms('all')]).toEqual([true, true]);
    expect([kindAllowsBots('bots'), kindAllowsRooms('bots')]).toEqual([true, false]);
    expect([kindAllowsBots('groups'), kindAllowsRooms('groups')]).toEqual([false, true]);
  });
});

describe('isBotHidden / isBotPinned / filterHiddenBots（对齐 Hermes hidden-bots.ts）', () => {
  const row = (profile: string, patch: Partial<BotRosterEntry> = {}) => ({
    entry: bot({ profile, ...patch }),
  });

  it('缺字段 = false（老网关不带这两个键）', () => {
    expect(isBotHidden(bot())).toBe(false);
    expect(isBotPinned(bot())).toBe(false);
    expect(isBotHidden(bot({ hidden: true }))).toBe(true);
    expect(isBotPinned(bot({ pinned: true }))).toBe(true);
  });

  it('🔴 revealHidden = false 时隐藏项被收起（隐藏是展示层行为）', () => {
    const rows = [row('a'), row('b', { hidden: true }), row('c')];
    expect(filterHiddenBots(rows, false).map((r) => r.entry.profile)).toEqual(['a', 'c']);
  });

  it('🔴 revealHidden = true 时隐藏项露出（调用方已把"有筛选约束"并进来）', () => {
    const rows = [row('a'), row('b', { hidden: true })];
    expect(filterHiddenBots(rows, true).map((r) => r.entry.profile)).toEqual(['a', 'b']);
  });

  it('不改原数组', () => {
    const rows = [row('a'), row('b', { hidden: true })];
    filterHiddenBots(rows, false);
    expect(rows).toHaveLength(2);
  });
});

describe('sortByPinThenActivity — 置顶优先 + 活动度降序（Hermes sortRosterRows）', () => {
  const rows = [
    { id: 'a', pinned: false, activity: 100 },
    { id: 'b', pinned: true, activity: 1 },
    { id: 'c', pinned: false, activity: 300 },
  ];
  const isPinned = (r: (typeof rows)[number]) => r.pinned;
  const activityOf = (r: (typeof rows)[number]) => r.activity;

  it('置顶的排最前（哪怕活动度最低），其余按活动度降序', () => {
    expect(sortByPinThenActivity(rows, isPinned, activityOf).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('活动度相同时保持原序（稳定——避免轮询抖动）', () => {
    const ties = [
      { id: 'x', pinned: false, activity: 5 },
      { id: 'y', pinned: false, activity: 5 },
      { id: 'z', pinned: false, activity: 5 },
    ];
    expect(sortByPinThenActivity(ties, isPinned, activityOf).map((r) => r.id)).toEqual(['x', 'y', 'z']);
  });

  it('不改原数组', () => {
    const before = rows.map((r) => r.id);
    sortByPinThenActivity(rows, isPinned, activityOf);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('activeFilterCount — 过滤徽标', () => {
  it('只数非 all 的项', () => {
    expect(activeFilterCount('all', 'all', 'all')).toBe(0);
    expect(activeFilterCount('bots', 'all', 'all')).toBe(1);
    expect(activeFilterCount('bots', 'recent', 'c1')).toBe(3);
  });
});

describe('filterHiddenRooms — 房间隐藏过滤（round-110，与 Agent 端同口径）', () => {
  it('revealHidden=false 收起隐藏项；true 全放行', () => {
    const rooms = [{ hidden: true }, { hidden: false }, {}];
    expect(filterHiddenRooms(rooms, false).map((r) => r.hidden)).toEqual([false, undefined]);
    expect(filterHiddenRooms(rooms, true)).toHaveLength(3);
  });

  it('不改原数组', () => {
    const rooms = [{ hidden: true }, { hidden: false }];
    const snapshot = [...rooms];
    filterHiddenRooms(rooms, false);
    expect(rooms).toEqual(snapshot);
  });
});
