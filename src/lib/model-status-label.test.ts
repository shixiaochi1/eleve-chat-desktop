/**
 * 模型胶囊状态标签（对齐 Hermes formatModelStatusLabel：`Model · Fast Med`）
 */
import { describe, it, expect } from 'vitest';
import { effortStatusSuffix, formatModelStatusLabel, isFastVariantModel } from './model-status-label';

describe('模型胶囊档位后缀', () => {
  it('档位恒显示；空值按 medium 显示', () => {
    expect(effortStatusSuffix({ effort: 'medium' })).toBe('中');
    expect(effortStatusSuffix({})).toBe('中');
    expect(effortStatusSuffix({ effort: 'none' })).toBe('关闭');
  });

  it('快速开启时 Fast 在前（对齐 Hermes parts 顺序）', () => {
    expect(effortStatusSuffix({ fast: true, effort: 'high' })).toBe('快速 高');
  });

  it('-fast 变体模型也显示快速', () => {
    expect(isFastVariantModel('anthropic/claude-opus-4.7-fast')).toBe(true);
    expect(effortStatusSuffix({ model: 'anthropic/claude-opus-4.7-fast', effort: 'low' })).toBe('快速 低');
  });

  it('非变体模型不带快速', () => {
    expect(isFastVariantModel('openai/gpt-5.6')).toBe(false);
  });

  it('完整标签 = 名称 · 后缀', () => {
    expect(formatModelStatusLabel('Claude Opus', { fast: true, effort: 'xhigh' })).toBe('Claude Opus · 快速 极高');
    expect(formatModelStatusLabel('GPT-5.6', { effort: 'ultra' })).toBe('GPT-5.6 · 超高');
  });

  it('空名称不产标签', () => {
    expect(formatModelStatusLabel('', { effort: 'high' })).toBe('');
  });
});
