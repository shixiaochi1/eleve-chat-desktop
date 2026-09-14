import { describe, it, expect } from 'vitest';
import {
  REASON_DEADLINE,
  inflightTurnsOf,
  isDeadlineReason,
  isRoomBoundedActivity,
  turnIdOf,
  turnStatusOf,
  turnToneClass,
} from './bot-turn-status';

/**
 * Hermes 词表铁律（`group-activity.ts:119-131`）：
 *   destructive → failed / timed-out
 *   accent      → working / replied / delivered
 *   quiet       → 其余
 * 这组断言把"档位"钉死——尤其是 round-98 曾被误改的那条（超时 ≠ 静默）。
 */
describe('turnStatusOf — Hermes 档位词表', () => {
  it('failed 与超时同为 destructive（Hermes: failures and timeouts）', () => {
    expect(turnStatusOf('turn.failed')?.tone).toBe('destructive');
    expect(turnStatusOf('turn.deferred', { reason_code: REASON_DEADLINE })?.tone).toBe(
      'destructive',
    );
  });

  it('已回复是 accent（Hermes: accent for real replies）', () => {
    const s = turnStatusOf('turn.settled', { passed: false });
    expect(s).toEqual({ label: '已回复', tone: 'accent', retryable: false });
  });

  it('跳过本轮 / 取消 / 暂停都是 quiet', () => {
    expect(turnStatusOf('turn.settled', { passed: true })?.tone).toBe('quiet');
    expect(turnStatusOf('turn.cancelled')?.tone).toBe('quiet');
    expect(turnStatusOf('turn.held')?.tone).toBe('quiet');
  });

  it('三档映射到 theme class（quiet 是基线）', () => {
    expect(turnToneClass('destructive')).toContain('text-destructive');
    expect(turnToneClass('accent')).toContain('text-foreground');
    expect(turnToneClass('quiet')).toContain('text-muted-foreground');
  });
});

describe('turnStatusOf — 两种缺席的区分', () => {
  it('超时缺席不给重试（会话还在跑，重试会双注入同一成员会话）', () => {
    const s = turnStatusOf('turn.deferred', { reason_code: REASON_DEADLINE });
    expect(s?.retryable).toBe(false);
    expect(s?.label).toContain('超时');
  });

  it('非超时缺席给显式重试（at-least-once 确认）', () => {
    const s = turnStatusOf('turn.deferred', { reason_code: 'runtime_offline' });
    expect(s?.retryable).toBe(true);
    expect(s?.tone).toBe('destructive');
  });

  it('isDeadlineReason 只认精确原因码', () => {
    expect(isDeadlineReason(REASON_DEADLINE)).toBe(true);
    expect(isDeadlineReason('runtime_offline')).toBe(false);
    expect(isDeadlineReason(undefined)).toBe(false);
    // 不能把"缺席"泛化成"超时"——两者收口语义不同
    expect(isDeadlineReason('')).toBe(false);
  });
});

describe('turnStatusOf — 房间级活动（round-99 补回的真缺口）', () => {
  it('bounded 有词条（此前前端零消费 → 讨论为何停止用户无感）', () => {
    const s = turnStatusOf('room.activity', { status: 'bounded', reason_code: 'max_rounds' });
    expect(s).not.toBeNull();
    expect(s?.label).toContain('轮数上限');
    expect(s?.tone).toBe('quiet');
  });

  it('bounded 按原因码区分措辞', () => {
    expect(
      turnStatusOf('room.activity', { status: 'bounded', reason_code: 'max_messages' })?.label,
    ).toContain('消息数上限');
    expect(turnStatusOf('room.activity', { status: 'bounded' })?.label).toContain('达到上限');
  });

  it('settled 标记不渲染（它只是幂等锚，成员级 turn.settled 已表达）', () => {
    expect(turnStatusOf('room.activity', { status: 'settled' })).toBeNull();
  });

  it('isRoomBoundedActivity 只看 bounded', () => {
    expect(isRoomBoundedActivity('room.activity', { status: 'bounded' })).toBe(true);
    expect(isRoomBoundedActivity('room.activity', { status: 'settled' })).toBe(false);
    expect(isRoomBoundedActivity('turn.settled', { status: 'bounded' })).toBe(false);
  });
});

describe('turnStatusOf — 不渲染的 kind', () => {
  it('turn.started 不渲染（round-53：用户实测刷屏）', () => {
    expect(turnStatusOf('turn.started')).toBeNull();
  });

  it('未知 kind 返回 null 而非抛出', () => {
    expect(turnStatusOf('room.created')).toBeNull();
    expect(turnStatusOf('')).toBeNull();
  });

  it('payload 缺失不抛', () => {
    expect(turnStatusOf('turn.failed', null)?.tone).toBe('destructive');
    expect(turnStatusOf('room.activity', undefined)).toBeNull();
  });
});

/**
 * 🔴 2026-09-14 审查 F1/F2 的回归护栏：
 * 后端 r115f 把终态 id 收敛为 `turn:{tid}:terminal`、deferred 带 `:g{gen}` 后，
 * 前端两处内联正则（忙态配对 / retry 取 turnId）同时失效。这组用例把
 * **后端真实 id 形态**逐条钉死——形态再变必须先改 `turnIdOf` 并让用例红。
 */
describe('turnIdOf — 轮事件 id 形态的唯一解析点', () => {
  const TID = 'd1.r0.p0.s1.m1';

  it('新形态：terminal（settled/failed/cancelled 共用同一 id）', () => {
    expect(turnIdOf(`turn:${TID}:terminal`)).toBe(TID);
  });

  it('新形态：deferred 带执行代次（同一 turn 可多次缺席）', () => {
    expect(turnIdOf(`turn:${TID}:deferred:g1`)).toBe(TID);
    expect(turnIdOf(`turn:${TID}:deferred:g12`)).toBe(TID);
  });

  it('开轮 / 扣留 / 历史旧形态都要认（旧日志回看不能瞎）', () => {
    expect(turnIdOf(`turn:${TID}:started`)).toBe(TID);
    expect(turnIdOf(`turn:${TID}:held`)).toBe(TID);
    expect(turnIdOf(`turn:${TID}:settled`)).toBe(TID);
    expect(turnIdOf(`turn:${TID}:failed`)).toBe(TID);
    expect(turnIdOf(`turn:${TID}:cancelled`)).toBe(TID);
  });

  it('轮内中间产物不是生命周期边 → null', () => {
    // 成员发言（中间产物，先落 msg 再落终态）与迟到补投都不参与开/收边
    expect(turnIdOf(`turn:${TID}:msg`)).toBeNull();
    expect(turnIdOf(`turn:${TID}:late`)).toBeNull();
  });

  it('非轮事件 / 脏输入 → null（不抛）', () => {
    expect(turnIdOf('room:activity:user:1:settled')).toBeNull();
    expect(turnIdOf('turn:')).toBeNull();
    expect(turnIdOf('turn::terminal')).toBeNull();
    expect(turnIdOf('')).toBeNull();
    expect(turnIdOf(undefined)).toBeNull();
    expect(turnIdOf(null)).toBeNull();
    expect(turnIdOf(42)).toBeNull();
  });
});

describe('inflightTurnsOf — 忙态配对（"只增不减"回归）', () => {
  const TID = 'd1.r0.p0.s1.m1';
  const started = (tid = TID, mid = 'm1') => ({
    kind: 'turn.started',
    event_id: `turn:${tid}:started`,
    payload: { member_id: mid },
  });

  it('开轮加入、terminal 收口移除（后端 r115f 形态）', () => {
    expect(inflightTurnsOf([started()]).get(TID)).toBe('m1');
    expect(
      inflightTurnsOf([started(), { kind: 'turn.settled', event_id: `turn:${TID}:terminal` }]).size,
    ).toBe(0);
  });

  it('failed / cancelled 与 settled 共用同一 id，同样能收口', () => {
    for (const kind of ['turn.settled', 'turn.failed', 'turn.cancelled']) {
      const m = inflightTurnsOf([started(), { kind, event_id: `turn:${TID}:terminal` }]);
      expect(m.size, `${kind} 必须收口`).toBe(0);
    }
  });

  it('deferred（带代次）必须收口——否则超时轮会把忙态永久锁死', () => {
    const m = inflightTurnsOf([
      started(),
      { kind: 'turn.deferred', event_id: `turn:${TID}:deferred:g1` },
    ]);
    expect(m.size).toBe(0);
  });

  it('历史旧形态 settled 也能收口（旧房间回看）', () => {
    expect(inflightTurnsOf([started(), { kind: 'turn.settled', event_id: `turn:${TID}:settled` }]).size).toBe(0);
  });

  it('成员发言（:msg）与迟到补投（:late）不参与配对', () => {
    expect(inflightTurnsOf([started(), { kind: 'message.member', event_id: `turn:${TID}:msg` }]).size).toBe(1);
    expect(inflightTurnsOf([started(), { kind: 'message.member', event_id: `turn:${TID}:late` }]).size).toBe(1);
  });

  it('多轮交错：各自独立开收，互不误伤', () => {
    const T2 = 'd1.r0.p1.s1.m2';
    const m = inflightTurnsOf([
      started(TID, 'm1'),
      started(T2, 'm2'),
      { kind: 'turn.settled', event_id: `turn:${TID}:terminal` },
    ]);
    expect([...m.keys()]).toEqual([T2]);
    expect(m.get(T2)).toBe('m2');
  });
});
