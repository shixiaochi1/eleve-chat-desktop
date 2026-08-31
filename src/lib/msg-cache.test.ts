import { describe, it, expect } from 'vitest';
import {
  pruneMsgCache,
  touchAndPruneMsgCache,
  clampCacheTails,
  dropMsgCacheEntry,
  findTouchedKey,
  MSG_CACHE_MAX_SESSIONS,
} from './msg-cache';

// 用独立 key 前缀隔离模块级 lastTouched 状态（测试间互不干扰）
let seq = 0;
const mk = (n: number): Record<string, number[]> => {
  const c: Record<string, number[]> = {};
  for (let i = 0; i < n; i++) c[`t${seq}-k${i}`] = [i];
  seq++;
  return c;
};
const keys = (c: Record<string, number[]>) => Object.keys(c);
const p = (c: Record<string, number[]>) => keys(c)[0]?.split('-')[0];

describe('msg-cache LRU（2026-09-01 内存修复 P0-1）', () => {
  it('容量内原引用返回（零拷贝）', () => {
    const cache = mk(3);
    expect(pruneMsgCache(cache)).toBe(cache);
  });

  it('超限按插入序淘汰最旧（存量未 touch 数据）', () => {
    const cache = mk(MSG_CACHE_MAX_SESSIONS + 3);
    const pruned = pruneMsgCache(cache);
    const ks = keys(pruned);
    expect(ks.length).toBe(MSG_CACHE_MAX_SESSIONS);
    const prefix = p(cache)!;
    // 最先插入的 3 个被淘汰
    expect(pruned[`${prefix}-k0`]).toBeUndefined();
    expect(pruned[`${prefix}-k1`]).toBeUndefined();
    expect(pruned[`${prefix}-k2`]).toBeUndefined();
    // 最新插入的保留
    expect(pruned[`${prefix}-k${MSG_CACHE_MAX_SESSIONS + 2}`]).toBeDefined();
  });

  it('touch 保护最近使用的会话', () => {
    const cache = mk(MSG_CACHE_MAX_SESSIONS + 2);
    const prefix = p(cache)!;
    // touch 最旧的 k0 → 淘汰改为 k1、k2
    const pruned = touchAndPruneMsgCache(cache, `${prefix}-k0`);
    expect(pruned[`${prefix}-k0`]).toBeDefined();
    expect(pruned[`${prefix}-k1`]).toBeUndefined();
    expect(pruned[`${prefix}-k2`]).toBeUndefined();
  });

  it('dropCacheEntry 后条目回归"未 touch"淘汰序', () => {
    const cache = mk(MSG_CACHE_MAX_SESSIONS + 1);
    const prefix = p(cache)!;
    touchAndPruneMsgCache(cache, `${prefix}-k0`); // k0 置顶
    dropMsgCacheEntry(`${prefix}-k0`);
    const pruned = touchAndPruneMsgCache(cache, `${prefix}-k${MSG_CACHE_MAX_SESSIONS}`);
    // k0 已 drop → 不再受保护，被淘汰
    expect(pruned[`${prefix}-k0`]).toBeUndefined();
    expect(pruned[`${prefix}-k${MSG_CACHE_MAX_SESSIONS}`]).toBeDefined();
  });

  it('findTouchedKey 识别引用变更的写入目标', () => {
    const prev: Record<string, number[]> = { a: [1], b: [2] };
    const next = { ...prev, b: [22] }; // b 引用变更
    expect(findTouchedKey(prev, next)).toBe('b');
  });

  it('findTouchedKey 无引用变更返回 null', () => {
    const prev: Record<string, number[]> = { a: [1] };
    expect(findTouchedKey(prev, { a: prev.a })).toBeNull();
  });

  it('clampCacheTails 对超限会话做 tail 截断（保留最新）', () => {
    const big = Array.from({ length: 150 }, (_, i) => i);
    const cache: Record<string, number[]> = { s1: big, s2: [1, 2] };
    const clamped = clampCacheTails(cache);
    expect(clamped.s1.length).toBe(100);
    expect(clamped.s1[0]).toBe(50); // 头部 50 条被裁，保留最新
    expect(clamped.s1[99]).toBe(149);
    expect(clamped.s2).toBe(cache.s2); // 未超限原引用
  });

  it('clampCacheTails 全部未超限返回原引用（零拷贝）', () => {
    const cache: Record<string, number[]> = { s1: [1, 2] };
    expect(clampCacheTails(cache)).toBe(cache);
  });
});
