/**
 * Per-model 思考预设 — 对齐 Hermes `store/model-presets.ts`
 *
 * Hermes 为每个模型记住 effort/fast（键 `provider::model`，localStorage 持久化），
 * 切回该模型时恢复——用户不必每次换模型重设档位。
 *
 * ELEVE 只持久化 **effort**：
 * - fast 在本架构里是进程级 `agent.service_tier`（LlmClient 跨会话共享，
 *   见 `AgentEngine.llm_client` 注释），per-model fast 会串台到其它会话；
 * - 档位（reasoning）已支持会话级覆盖（config.set key="reasoning"），可安全按模型记忆。
 */
import { useSyncExternalStore } from 'react';

import { isReasoningEffortValue } from '@/lib/reasoning-efforts';

const STORAGE_KEY = 'eleve.desktop.model-presets';

export interface ModelPreset {
  effort?: string;
  /** 快速模式偏好（活跃行写会话级；非活跃行只记忆，切回时应用） */
  fast?: boolean;
}

/** 稳定键：`provider::model`（对齐 Hermes modelPresetKey） */
export const modelPresetKey = (provider: string, model: string): string => `${provider}::${model}`;

function load(): Record<string, ModelPreset> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, ModelPreset> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const raw = value as { effort?: unknown; fast?: unknown };
      const preset: ModelPreset = {};
      if (typeof raw.effort === 'string' && isReasoningEffortValue(raw.effort)) {
        preset.effort = raw.effort;
      }
      if (typeof raw.fast === 'boolean') preset.fast = raw.fast;
      result[key] = preset;
    }
    return result;
  } catch {
    return {};
  }
}

let presets: Record<string, ModelPreset> = load();

/** 变更订阅（菜单子菜单需要立即反映非活跃行的预设改动，不能只靠下次渲染） */
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeModelPresets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getVersion = (): number => version;

/** 订阅预设变更（返回值仅用于触发重渲染） */
export function useModelPresets(): number {
  return useSyncExternalStore(subscribeModelPresets, getVersion, getVersion);
}

export function getModelPreset(provider: string, model: string): ModelPreset {
  return presets[modelPresetKey(provider, model)] ?? {};
}

/** 合并某模型的预设并持久化（patch 的键覆盖旧值） */
export function setModelPreset(provider: string, model: string, patch: ModelPreset): void {
  const key = modelPresetKey(provider, model);
  const merged: ModelPreset = { ...presets[key], ...patch };
  presets = { ...presets, [key]: merged };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* 隐私模式/配额满：内存内生效即可 */
  }
  emit();
}

/** 测试用：重置内存缓存（不写盘） */
export function __resetModelPresetsForTest(next: Record<string, ModelPreset> = {}): void {
  presets = next;
  emit();
}
