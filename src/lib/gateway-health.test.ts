import { describe, it, expect } from 'vitest';
import {
  isSessionStoreDegraded,
  sessionStoreDegradedLabel,
  sessionStoreHealth,
} from './gateway-health';

/**
 * 🔴 2026-09-16（对齐 Hermes `gateway/session_db_recovery.py` 的**消费面**）：
 * 后端 `session_store.status` 此前只写进 runtime status、**无人读**（Hermes #88235：
 * *"nothing is persisted, and the user has no indication"*）。本组锁住消费端的判据。
 */
describe('sessionStoreHealth — 后端 session_store 段归一化（判据唯一在后端）', () => {
  it('缺省 / 无 status / 非字符串 ⇒ null（未知不得当故障）', () => {
    expect(sessionStoreHealth(null)).toBeNull();
    expect(sessionStoreHealth(undefined)).toBeNull();
    expect(sessionStoreHealth({})).toBeNull();
    expect(sessionStoreHealth({ status: 42 })).toBeNull();
    expect(sessionStoreHealth({ status: '' })).toBeNull();
    expect(sessionStoreHealth({ status: null })).toBeNull();
  });

  it('degraded_paths 非法 / ≤0 ⇒ 0；正数 ⇒ 向下取整', () => {
    expect(sessionStoreHealth({ status: 'unavailable' })?.degradedPaths).toBe(0);
    expect(sessionStoreHealth({ status: 'unavailable', degraded_paths: -3 })?.degradedPaths).toBe(0);
    expect(
      sessionStoreHealth({ status: 'unavailable', degraded_paths: Number.NaN })?.degradedPaths,
    ).toBe(0);
    expect(sessionStoreHealth({ status: 'unavailable', degraded_paths: 2.7 })?.degradedPaths).toBe(2);
  });
});

describe('isSessionStoreDegraded — ok 之外即降级，未知按 false', () => {
  it('ok ⇒ false；retrying / unavailable ⇒ true；null ⇒ false', () => {
    expect(isSessionStoreDegraded({ status: 'ok', degradedPaths: 0 })).toBe(false);
    expect(isSessionStoreDegraded({ status: 'retrying', degradedPaths: 1 })).toBe(true);
    expect(isSessionStoreDegraded({ status: 'unavailable', degradedPaths: 2 })).toBe(true);
    expect(isSessionStoreDegraded(null)).toBe(false);
  });
});

describe('sessionStoreDegradedLabel — 说清「还能用 / 不会被保存 / 自动重试」', () => {
  it('unavailable：含"不会被保存"、退避区间与降级库数', () => {
    const label = sessionStoreDegradedLabel({ status: 'unavailable', degradedPaths: 2 });
    expect(label).toContain('不会被保存');
    expect(label).toContain('2 个库');
    expect(label).toContain('1s→60s');
    expect(label).toContain('能收发');
  });

  it('retrying 与 unavailable 措辞必须不同（还在重试 ≠ 已不可用）', () => {
    const label = sessionStoreDegradedLabel({ status: 'retrying', degradedPaths: 1 });
    expect(label).toContain('重试中');
    expect(label).not.toContain('不可用');
  });

  it('**纯文本**渲染：不得出现 markdown 星号（界面上会原样显示 `**`）', () => {
    for (const status of ['retrying', 'unavailable']) {
      expect(sessionStoreDegradedLabel({ status, degradedPaths: 1 })).not.toContain('**');
    }
  });

  it('无降级库数 ⇒ 不出现括号计数（不写 "0 个库"）', () => {
    expect(sessionStoreDegradedLabel({ status: 'retrying', degradedPaths: 0 })).not.toContain('个库');
  });
});
