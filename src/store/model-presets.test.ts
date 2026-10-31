/**
 * per-model 思考预设（对齐 Hermes store/model-presets.ts）
 *
 * 键 `provider::model`；同一模型后写入覆盖前值；模型间互不影响。
 * 纯内存校验（Node 测试环境无 localStorage，load/save 的 try-catch 兜底）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetModelPresetsForTest,
  getModelPreset,
  modelPresetKey,
  setModelPreset,
} from './model-presets';

describe('per-model 思考预设', () => {
  beforeEach(() => __resetModelPresetsForTest());

  it('键格式与 Hermes 一致：provider::model', () => {
    expect(modelPresetKey('anthropic', 'claude-opus-4.7')).toBe('anthropic::claude-opus-4.7');
  });

  it('未设置返回空预设', () => {
    expect(getModelPreset('anthropic', 'claude-opus-4.7')).toEqual({});
  });

  it('写入后可读回；再次写入覆盖', () => {
    setModelPreset('anthropic', 'claude-opus-4.7', { effort: 'high' });
    expect(getModelPreset('anthropic', 'claude-opus-4.7')).toEqual({ effort: 'high' });
    setModelPreset('anthropic', 'claude-opus-4.7', { effort: 'ultra' });
    expect(getModelPreset('anthropic', 'claude-opus-4.7')).toEqual({ effort: 'ultra' });
  });

  it('关闭态（none）也能记住', () => {
    setModelPreset('openai', 'gpt-5.6', { effort: 'none' });
    expect(getModelPreset('openai', 'gpt-5.6')).toEqual({ effort: 'none' });
  });

  it('模型之间互不影响', () => {
    setModelPreset('openai', 'gpt-5.6', { effort: 'max' });
    setModelPreset('anthropic', 'claude-opus-4.7', { effort: 'low' });
    expect(getModelPreset('openai', 'gpt-5.6')).toEqual({ effort: 'max' });
    expect(getModelPreset('anthropic', 'claude-opus-4.7')).toEqual({ effort: 'low' });
    expect(getModelPreset('openai', 'claude-opus-4.7')).toEqual({});
  });
});
