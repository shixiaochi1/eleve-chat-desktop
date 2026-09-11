import { describe, it, expect } from 'vitest';
import {
  REASON_DEADLINE,
  isDeadlineReason,
  isRoomBoundedActivity,
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
