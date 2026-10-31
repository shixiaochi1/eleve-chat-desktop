/**
 * 思考档位语义测试（2026-10-31 对齐 Hermes `lib/reasoning-effort.ts`）。
 *
 * 要害：`none` 不是阶梯档位，是「思考关闭」；阶梯是 minimal → ultra 共 7 档。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORTS,
  REASONING_EFFORT_OPTIONS,
  isReasoningEffort,
  isThinkingEnabled,
  reasoningEffortLabel,
  resolveReasoningEffort,
} from './reasoning-efforts';

describe('思考档位集合（对齐 Hermes）', () => {
  it('阶梯 = minimal→ultra 七档，顺序与 Hermes 一致', () => {
    expect(REASONING_EFFORTS.map((e) => e.value)).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
  });

  it('none 不在阶梯里，只出现在完整选项集合首位', () => {
    expect(REASONING_EFFORTS.some((e) => (e.value as string) === 'none')).toBe(false);
    expect(REASONING_EFFORT_OPTIONS[0].value).toBe('none');
    expect(REASONING_EFFORT_OPTIONS).toHaveLength(8);
  });

  it('中文标签对齐 Hermes zh modelOptions', () => {
    expect(REASONING_EFFORTS.map((e) => e.label)).toEqual([
      '最小',
      '低',
      '中',
      '高',
      '极高',
      '最高',
      '超高',
    ]);
  });

  it('默认档位 medium', () => {
    expect(DEFAULT_REASONING_EFFORT).toBe('medium');
  });
});

describe('思考开关语义（none ≠ 档位）', () => {
  it('none 关闭、空值继承默认（开启）、档位开启', () => {
    expect(isThinkingEnabled('none')).toBe(false);
    expect(isThinkingEnabled('')).toBe(true);
    expect(isThinkingEnabled(undefined)).toBe(true);
    expect(isThinkingEnabled('high')).toBe(true);
  });

  it('空值继承显式 fallback', () => {
    expect(isThinkingEnabled('', 'none')).toBe(false);
  });
});

describe('阶梯当前值解析', () => {
  it('none → 空（阶梯无选中项）', () => {
    expect(resolveReasoningEffort('none')).toBe('');
  });

  it('空/未知 → 默认 medium', () => {
    expect(resolveReasoningEffort('')).toBe('medium');
    expect(resolveReasoningEffort('bogus')).toBe('medium');
  });

  it('大小写/空白归一 + max/ultra 保留', () => {
    expect(resolveReasoningEffort('  HIGH ')).toBe('high');
    expect(resolveReasoningEffort('MAX')).toBe('max');
    expect(resolveReasoningEffort('ultra')).toBe('ultra');
  });

  it('isReasoningEffort 不含 none', () => {
    expect(isReasoningEffort('none')).toBe(false);
    expect(isReasoningEffort('max')).toBe(true);
  });
});

describe('档位中文名', () => {
  it('关闭态与各档位', () => {
    expect(reasoningEffortLabel('none')).toBe('关闭');
    expect(reasoningEffortLabel('medium')).toBe('中');
    expect(reasoningEffortLabel('xhigh')).toBe('极高');
    expect(reasoningEffortLabel('ultra')).toBe('超高');
  });
});
