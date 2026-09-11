/**
 * 🔴 round-111 回归：花名册行的**跨连接同名**定位。
 *
 * 真 bug（round-111 发现）：`rowMenu` 只存 `profile`，随后用
 * `bots.find(r => r.entry.profile === profile)` 取行 —— 本机 `coder` 与远端
 * `coder` 同时存在时恒命中**本机**那条。于是对远端行做置顶 / 隐藏 / 编辑 /
 * 复制，全部作用到本机 `coder`（`setBotPrefs` 的 route 也跟着指向本机 socket）。
 *
 * 对齐 Hermes `96ed0e71ea fix(bot-mode): match scoped bot selection in reset
 * guard`（*"An identically named bot on another connection must not win the
 * lookup."*）——Hermes 修法是把 `bot.name` 换成连接作用域的 key。
 */
import { describe, it, expect } from 'vitest';
import type { BotRosterEntry } from '../utils/api';
import { LOCAL_CONNECTION_ID, type UnionRosterRow } from '../services/bot-relay';
import {
  findMemberRoutingRow,
  findRosterRowByKey,
  pickableMembers,
  rosterRowKey,
} from './bot-members';

function entry(patch: Partial<BotRosterEntry> = {}): BotRosterEntry {
  return { profile: 'coder', handle: 'coder', display_name: 'Coder', ...patch } as BotRosterEntry;
}

function local(patch: Partial<BotRosterEntry> = {}): UnionRosterRow {
  return { entry: entry(patch), connectionId: LOCAL_CONNECTION_ID, connectionLabel: '本机', isRemote: false, reachable: true };
}

function remote(connectionId: string, patch: Partial<BotRosterEntry> = {}): UnionRosterRow {
  return { entry: entry(patch), connectionId, connectionLabel: 'Homelab', isRemote: true, reachable: true };
}

/** 两个连接上的同名 `coder`（本机在前，远端在后 —— 与 fetchUnionRoster 的
 *  拼接顺序一致，正是"按 profile find 恒命中本机"的成因）。 */
function twoConnections(): UnionRosterRow[] {
  return [local({ pinned: true }), remote('homelab', { pinned: false })];
}

describe('rosterRowKey — 跨连接同名的唯一键', () => {
  it('同名不同连接 → 键不同（profile 会撞，键不会）', () => {
    const [l, r] = twoConnections();
    expect(rosterRowKey(l)).toBe(`${LOCAL_CONNECTION_ID}::coder`);
    expect(rosterRowKey(r)).toBe('homelab::coder');
    expect(rosterRowKey(l)).not.toBe(rosterRowKey(r));
  });
});

describe('findRosterRowByKey — 按唯一键精确定位（不按 profile 猜）', () => {
  it('🔴 远端那行必须命中远端，而不是第一条同名的本机行', () => {
    const rows = twoConnections();
    const menuRow = findRosterRowByKey(rows, rosterRowKey(rows[1]));
    expect(menuRow).not.toBeNull();
    expect(menuRow!.connectionId).toBe('homelab');
    expect(menuRow!.isRemote).toBe(true);
    // 菜单读到的置顶态必须来自被点的那一行
    expect(menuRow!.entry.pinned).toBe(false);
  });

  it('对照：旧的 `find(profile)` 写法确实会命中本机（这就是 bug）', () => {
    const rows = twoConnections();
    const wrong = rows.find((r) => r.entry.profile === 'coder');
    expect(wrong!.connectionId).toBe(LOCAL_CONNECTION_ID);
    expect(wrong).not.toBe(findRosterRowByKey(rows, rosterRowKey(rows[1])));
  });

  it('null / 找不到 → null（行随花名册刷新消失时菜单自会收起）', () => {
    const rows = twoConnections();
    expect(findRosterRowByKey(rows, null)).toBeNull();
    expect(findRosterRowByKey(rows, undefined)).toBeNull();
    expect(findRosterRowByKey(rows, 'homelab::missing')).toBeNull();
  });
});

/**
 * 🔴 round-111b：房间成员（profile 键，无 connectionId）→ 路由真值行。
 * 真实路由是 `is_local(profile)` 分流 ⇒ 本机行才是真值；此前两处消费点靠
 * "花名册本机行排在最前"的隐式顺序，顺序一变语义就静默反。
 */
describe('findMemberRoutingRow — 显式优先本机行（不依赖数组顺序）', () => {
  it('本机 + 远端同名 → 取本机行（数组顺序无关）', () => {
    const rows = twoConnections(); // [local, remote]
    const m = { handle: 'coder', profile: 'coder' };
    expect(findMemberRoutingRow(rows, m)).toBe(rows[0]);
    expect(findMemberRoutingRow([rows[1], rows[0]], m)).toBe(rows[0]);
  });

  it('只有远端同名 → 取该远端行', () => {
    const rows = [remote('homelab', { profile: 'coder' })];
    expect(findMemberRoutingRow(rows, { handle: 'coder', profile: 'coder' })).toBe(rows[0]);
  });

  it('handle 不中则按 profile 回落；查无此人 → undefined', () => {
    const rows = [local({ profile: 'p1', handle: 'h1' })];
    expect(findMemberRoutingRow(rows, { handle: 'nope', profile: 'p1' })).toBe(rows[0]);
    expect(findMemberRoutingRow(rows, { handle: 'nope', profile: 'nope' })).toBeUndefined();
  });
});

describe('菜单动作的路由 —— 由解出的行派生，跨连接同名不串台', () => {
  /** 与 `BotsPane.setBotPrefs` / `runDuplicateAgent` 同式的 route 派生：
   *  远端行骑 owner 连接，本机行 route=null（走主连接）。 */
  const routeOf = (row: UnionRosterRow) =>
    row.isRemote ? { connectionId: row.connectionId, profile: 'default' } : null;

  it('对远端行置顶/隐藏 → route 指向远端连接', () => {
    const rows = twoConnections();
    const menuRow = findRosterRowByKey(rows, rosterRowKey(rows[1]))!;
    expect(routeOf(menuRow)).toEqual({ connectionId: 'homelab', profile: 'default' });
  });

  it('对远端行复制 → 名占用集按**同一连接**过滤（同名本机 profile 不挡复制）', () => {
    const rows: UnionRosterRow[] = [
      local(),
      remote('homelab', { profile: 'coder' }),
      remote('homelab', { profile: 'coder-2' }),
      remote('other', { profile: 'writer' }),
    ];
    const menuRow = findRosterRowByKey(rows, 'homelab::coder')!;
    const taken = rows.filter((r) => r.connectionId === menuRow.connectionId).map((r) => r.entry.profile);
    expect(taken).toEqual(['coder', 'coder-2']);
    // 另一连接的 writer 与另一条连接的同名行都不参与占用集
    expect(taken).not.toContain('writer');
  });

  it('本机行 → route=null（不误骑远端 socket）', () => {
    const rows = twoConnections();
    const menuRow = findRosterRowByKey(rows, rosterRowKey(rows[0]))!;
    expect(routeOf(menuRow)).toBeNull();
    expect(menuRow.entry.pinned).toBe(true);
  });
});

describe('pickableMembers — 与唯一键同源', () => {
  it('成员选择行的 key 与 rosterRowKey 一致且两行不撞', () => {
    const rows = twoConnections();
    const picks = pickableMembers(rows);
    expect(picks.map((p) => p.key)).toEqual(rows.map(rosterRowKey));
    expect(new Set(picks.map((p) => p.key)).size).toBe(2);
  });
});

/**
 * 🔴 round-111b（自查修复）：路由冲突的行**不可选**。
 *
 * 房间成员身份是 profile 键的（`RoomMember{member_id,profile,handle}` 无
 * connectionId；driver 按 `is_local(profile)` 分流），所以"选远端同名那个"
 * 会静默投给**本机**同名者；全远端同名则 `resolve_remote_target` 判 Ambiguous、
 * 每轮硬失败。原则同 round-111：不给必然选错人的入口，**但不误伤合法能力**。
 */
describe('pickableMembers — 跨连接同名的路由冲突', () => {
  it('本机行保留可选，远端同名行被禁用并给出原因', () => {
    const picks = pickableMembers(twoConnections());
    const local = picks.find((p) => !p.isRemote)!;
    const remote = picks.find((p) => p.isRemote)!;
    expect(local.disabled).toBe(false);
    expect(remote.disabled).toBe(true);
    expect(remote.disabledReason).toContain('本机也有');
    expect(remote.disabledReason).toContain('投给本机');
  });

  it('全远端同名（无本机）→ 两行都禁用（按 profile 解析必然歧义）', () => {
    const picks = pickableMembers([remote('homelab', { profile: 'coder' }), remote('other', { profile: 'coder' })]);
    expect(picks.every((p) => p.disabled)).toBe(true);
    expect(picks[0].disabledReason).toContain('无法消歧');
  });

  it('唯一 profile 不受影响（本机独有 / 远端独有都可选）', () => {
    const picks = pickableMembers([
      local({ profile: 'local-only' }),
      remote('homelab', { profile: 'remote-only' }),
    ]);
    expect(picks.every((p) => !p.disabled)).toBe(true);
  });

  it('不可达的远端行仍然被禁用（round-95 的原有语义不被覆盖）', () => {
    const picks = pickableMembers([
      { ...remote('homelab', { profile: 'solo' }), reachable: false },
    ]);
    expect(picks[0].disabled).toBe(true);
    expect(picks[0].disabledReason).toContain('不可达');
  });
});
