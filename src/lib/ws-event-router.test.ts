/**
 * ws-event-router.test.ts — 2b 路由器合并的回归网（🔴 用例先行的"用例"）
 *
 * 锁定三件套语义（均为历次串台事故修复沉淀，合并时不得漂移）：
 * 1. normalizeWsEvent —— payload 展开 + 顶层 session_id/run_id 兜底提升
 * 2. admitByCurrentSession —— 单视图三分支守卫（useSSE 串台绝对闭环）
 * 3. admitBySlotGuard —— 宫格 slot 守卫（#10 过期流 + 新鲜发送兼容 + P2 脏指针防御）
 */
import { describe, it, expect } from 'vitest';
import { normalizeWsEvent, admitByCurrentSession, admitBySlotGuard } from './ws-event-router';

describe('normalizeWsEvent', () => {
  it('null/非对象 → null（调用方 early return）', () => {
    expect(normalizeWsEvent(null)).toBeNull();
    expect(normalizeWsEvent(undefined)).toBeNull();
  });

  it('Hermes _emit 格式：业务数据在 payload 下，顶层 session_id/run_id 提升', () => {
    const n = normalizeWsEvent({
      session_id: 's1',
      run_id: 's1',
      payload: { seq: 3, text: 'hi' },
    })!;
    expect(n.raw.session_id).toBe('s1');
    expect(n.chunk.seq).toBe(3);
    expect(n.chunk.text).toBe('hi');
    // 顶层提升仅在 payload 缺失该字段时生效（payload 优先，不覆盖业务字段）
    expect(n.chunk.session_id).toBe('s1');
    expect(n.chunk.run_id).toBe('s1');
  });

  it('无顶层字段的事件（payload 内自带 session_id）不注入', () => {
    const n = normalizeWsEvent({ payload: { session_id: 'inner' } })!;
    expect(n.chunk.session_id).toBe('inner');
  });

  it('无 payload 包装的裸事件原样归一化', () => {
    const n = normalizeWsEvent({ session_id: 's2', delta: 'x' })!;
    expect(n.chunk.delta).toBe('x');
    expect(n.chunk.session_id).toBe('s2');
  });

  it('payload 业务字段优先（两者都有时不被顶层覆盖——顶层仅兜底）', () => {
    const n = normalizeWsEvent({ session_id: 'outer', payload: { session_id: 'inner' } })!;
    expect(n.chunk.session_id).toBe('inner'); // chunkBase 已有 session_id → 不被顶层覆盖
  });
});

describe('admitByCurrentSession（单视图三分支）', () => {
  it('无 session_id = 全局广播 → 放行', () => {
    expect(admitByCurrentSession(undefined, 's1', false)).toBe('accept');
    expect(admitByCurrentSession(undefined, null, true)).toBe('accept');
    expect(admitByCurrentSession(undefined, undefined, false)).toBe('accept');
  });

  it('无过滤 ref（currentSessionIdRef 未传）→ 不过滤模式放行', () => {
    expect(admitByCurrentSession('s9', undefined, false)).toBe('accept');
  });

  it('已锁定：本会话事件放行', () => {
    expect(admitByCurrentSession('s1', 's1', false)).toBe('accept');
  });

  it('已锁定：外来会话事件丢弃（串台主防线）', () => {
    expect(admitByCurrentSession('s2', 's1', false)).toBe('drop');
    expect(admitByCurrentSession('s2', 's1', true)).toBe('drop');
  });

  it('current=null + 本人刚发送新建会话 → 缓冲（不丢自己的早期事件）', () => {
    expect(admitByCurrentSession('s1', null, true)).toBe('buffer');
  });

  it('current=null + 非本人发送（切到空白 Agent）→ 丢弃外来流式（串台根因修复）', () => {
    expect(admitByCurrentSession('s1', null, false)).toBe('drop');
  });
});

describe('admitBySlotGuard（宫格 slot 守卫）', () => {
  const BELONGS = true;

  it('事件无 session_id → 放行（全局事件）', () => {
    expect(admitBySlotGuard(undefined, 'p-s1', BELONGS, false)).toBe('accept');
  });

  it('slot 无指针（新鲜发送兼容：新会话未拿到 id）→ 放行', () => {
    expect(admitBySlotGuard('p-s1', null, false, false)).toBe('accept');
    expect(admitBySlotGuard('p-s1', undefined, false, false)).toBe('accept');
  });

  it('slotSid 脏指针（前缀不归属本 profile）→ 视同 null 放行（P2 自含防御）', () => {
    expect(admitBySlotGuard('p-s1', 'other-s9', false, false)).toBe('accept');
  });

  it('事件与 slot 当前 session 一致 → 放行', () => {
    expect(admitBySlotGuard('p-s1', 'p-s1', BELONGS, false)).toBe('accept');
  });

  it('不一致（切会话后迟到）：普通累加事件丢弃（防旧流 delta 注入新会话）', () => {
    expect(admitBySlotGuard('p-old', 'p-s1', BELONGS, false)).toBe('drop');
  });

  it('不一致：交互类事件放行（后台会话并发轮的审批/澄清必须可见，丢弃=工具挂到超时）', () => {
    expect(admitBySlotGuard('p-old', 'p-s1', BELONGS, true)).toBe('accept');
  });
});
