/**
 * round-116（Agent 面板整合 P1）：私聊分组编排的回归测试。
 *
 * 目的：新面板（群聊 + 私聊区）与旧 `BotsPane` 在迁移期**必须对同一份花名册
 * 给出同一个顺序与同一套可见性**——判据都在 `lib/roster-filter.ts`，本测试锁
 * 的是**编排顺序**（pin → 活动度 → 搜索 → 连接 → 活跃度 → 隐藏展开），
 * 顺序一旦改，这里立刻红。
 */
import { describe, it, expect } from 'vitest';

import type { BotRosterEntry } from '../utils/api';
import { LOCAL_CONNECTION_ID, type UnionRosterRow } from '../services/bot-relay';
import {
  botRowMeta,
  derivePrivateChatRows,
  type PrivateChatFilterState,
} from './useAgentPanelData';

function entry(patch: Partial<BotRosterEntry> = {}): BotRosterEntry {
  return { profile: 'coder', handle: 'coder', display_name: 'Coder', ...patch } as BotRosterEntry;
}

function local(patch: Partial<BotRosterEntry> = {}): UnionRosterRow {
  return {
    entry: entry(patch),
    connectionId: LOCAL_CONNECTION_ID,
    connectionLabel: '本机',
    isRemote: false,
    reachable: true,
  };
}

function remote(profile: string, connectionId: string, label: string): UnionRosterRow {
  return {
    entry: entry({ profile, handle: profile, display_name: profile }),
    connectionId,
    connectionLabel: label,
    isRemote: true,
    reachable: true,
  };
}

const ALL: PrivateChatFilterState = {
  query: '',
  kindFilter: 'all',
  activityFilter: 'all',
  gatewayFilter: 'all',
  showHidden: false,
};

const nowSec = () => Math.floor(Date.now() / 1000);

describe('derivePrivateChatRows — 类型过滤', () => {
  it('「只看群聊」时 Agent 分组为空（但隐藏计数仍如实给出）', () => {
    const bots = [local({ profile: 'a' }), local({ profile: 'b', hidden: true })];
    const res = derivePrivateChatRows(bots, { ...ALL, kindFilter: 'groups' });
    expect(res.rows).toEqual([]);
    expect(res.hiddenCount).toBe(1);
  });
});

describe('derivePrivateChatRows — 搜索', () => {
  it('按 profile / display_name / handle 命中，未命中项排除', () => {
    const bots = [
      local({ profile: 'coder', display_name: 'Coder' }),
      local({ profile: 'writer', display_name: 'Writer' }),
    ];
    const res = derivePrivateChatRows(bots, { ...ALL, query: 'writ' });
    expect(res.rows.map((r) => r.entry.profile)).toEqual(['writer']);
    expect(res.hasConstraint).toBe(true);
  });
});

describe('derivePrivateChatRows — 排序（pin 优先 → 活动度）', () => {
  it('置顶项排在前，即使活动度更低；未置顶按活动度降序', () => {
    const older = nowSec() - 3600;
    const newer = nowSec() - 60;
    const bots = [
      local({ profile: 'fresh', last_active: newer }),
      local({ profile: 'old', last_active: older }),
      local({ profile: 'pinned-old', last_active: older, pinned: true }),
    ];
    const res = derivePrivateChatRows(bots, ALL);
    expect(res.rows.map((r) => r.entry.profile)).toEqual(['pinned-old', 'fresh', 'old']);
  });
});

describe('derivePrivateChatRows — 隐藏项', () => {
  it('无筛选约束时不展示隐藏项；showHidden 打开才展示', () => {
    const bots = [local({ profile: 'shown' }), local({ profile: 'hidden', hidden: true })];
    expect(derivePrivateChatRows(bots, ALL).rows.map((r) => r.entry.profile)).toEqual(['shown']);
    expect(
      derivePrivateChatRows(bots, { ...ALL, showHidden: true }).rows.map((r) => r.entry.profile).sort(),
    ).toEqual(['hidden', 'shown']);
  });

  it('有筛选约束时强制展开（对齐 Hermes showHiddenRows = expanded || hasConstraint）', () => {
    const bots = [local({ profile: 'shown' }), local({ profile: 'hidden', hidden: true })];
    const res = derivePrivateChatRows(bots, { ...ALL, query: 'hidden' });
    expect(res.rows.map((r) => r.entry.profile)).toEqual(['hidden']);
    expect(res.hasConstraint).toBe(true);
  });
});

describe('derivePrivateChatRows — 连接过滤 / 远端行', () => {
  it('gatewayFilter 只留该连接的行（本机与远端同名不串台）', () => {
    const bots = [local({ profile: 'coder' }), remote('coder', 'conn-2', '远端 A')];
    const res = derivePrivateChatRows(bots, { ...ALL, gatewayFilter: 'conn-2' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].connectionId).toBe('conn-2');
    expect(res.rows[0].isRemote).toBe(true);
  });

  it('活动度过滤 active 档只留三路信号之一在场的行', () => {
    const bots = [
      local({ profile: 'hot', last_active: nowSec() - 10 }),
      local({ profile: 'cold', last_active: nowSec() - 30 * 24 * 3600 }),
      local({ profile: 'busy', busy: true }),
    ];
    const res = derivePrivateChatRows(bots, { ...ALL, activityFilter: 'active' });
    expect(res.rows.map((r) => r.entry.profile).sort()).toEqual(['busy', 'hot']);
  });
});

describe('botRowMeta — 活跃三路信号', () => {
  it('last_active 落在 90s 窗内 → active', () => {
    expect(botRowMeta(local({ last_active: nowSec() - 5 })).active).toBe(true);
  });

  it('worker 心跳（150s 窗）也算 active（对齐 Hermes botMood 第二路）', () => {
    expect(
      botRowMeta(local({ worker_session: { last_active: nowSec() - 100 } as never })).active,
    ).toBe(true);
  });

  it('gateway busy 也算 active（round-106/109 起后端透传）', () => {
    expect(botRowMeta(local({ busy: true })).active).toBe(true);
  });

  it('三路都不在 → idle；活动度取 max(created_at, last_active)', () => {
    const meta = botRowMeta(local({ last_active: nowSec() - 9999, created_at: nowSec() - 100 }));
    expect(meta.active).toBe(false);
    expect(meta.activity).toBe((nowSec() - 100) * 1000);
  });
});
