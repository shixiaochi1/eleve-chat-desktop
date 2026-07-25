/**
 * useModels — Provider + Model discovery hook
 *
 * 数据源：全局 Provider 池（listPoolProviders）→ settings.json providers 兜底。
 * 选中模型 → update_config 写 config.yaml model.ref（与设置面板同逻辑）。
 * 当前模型 → get_config 读 model.ref。
 *
 * Returns: { models, grouped, loading, error, refresh, selectedModel, selectModel }
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { call } from '../utils/bridge';
import { loadSettings, listPoolProviders } from '../utils/settings-store';
import type { PoolProvider } from '../utils/settings-store';

export interface ModelItem {
  /** 完整 ref: "provider_id/model_name" */
  id: string;
  owned_by?: string;
  providerName?: string;
}

export interface ModelGroup {
  providerId: string;
  providerName: string;
  models: ModelItem[];
}

export interface GroupedModels {
  [providerId: string]: ModelGroup;
}

// ── Cache ──
let _cachedModels: ModelItem[] | null = null;
let _cachedGrouped: GroupedModels | null = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isCacheValid(): boolean {
  return !!(_cachedModels && (Date.now() - _cacheTime) < CACHE_TTL);
}

/** 从全局池 Provider 构建分组模型列表 */
function buildFromPool(providers: PoolProvider[]): { models: ModelItem[]; grouped: GroupedModels } {
  const models: ModelItem[] = [];
  const grouped: GroupedModels = {};
  for (const p of providers) {
    const group: ModelGroup = {
      providerId: p.id,
      providerName: p.name || p.id,
      models: [],
    };
    for (const m of p.models) {
      const ref = `${p.id}/${m.name}`;
      const item: ModelItem = { id: ref, owned_by: p.id, providerName: p.name || p.id };
      models.push(item);
      group.models.push(item);
    }
    if (group.models.length > 0) {
      grouped[p.id] = group;
    }
  }
  return { models, grouped };
}

/** 兜底：从 settings.json providers 构建 */
function buildFromSettings(): { models: ModelItem[]; grouped: GroupedModels } {
  try {
    const settings = loadSettings();
    if (!settings?.providers) return { models: [], grouped: {} };
    const models: ModelItem[] = [];
    const grouped: GroupedModels = {};
    for (const p of settings.providers) {
      const group: ModelGroup = {
        providerId: p.id,
        providerName: p.name || p.id,
        models: [],
      };
      if (Array.isArray(p.models)) {
        for (const m of p.models) {
          const ref = `${p.id}/${m}`;
          const item: ModelItem = { id: ref, owned_by: p.id, providerName: p.name || p.id };
          models.push(item);
          group.models.push(item);
        }
      }
      if (group.models.length > 0) {
        grouped[p.id] = group;
      }
    }
    return { models, grouped };
  } catch {
    return { models: [], grouped: {} };
  }
}

export default function useModels({ enabled = true }: { enabled?: boolean } = {}) {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [grouped, setGrouped] = useState<GroupedModels>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    // Use cache if valid
    if (isCacheValid()) {
      setModels(_cachedModels!);
      setGrouped(_cachedGrouped!);
      setLoading(false);
      return;
    }

    try {
      // Primary: 全局 Provider 池
      const poolProviders = await listPoolProviders();
      let result = buildFromPool(poolProviders);

      // Fallback: settings.json providers
      if (result.models.length === 0) {
        result = buildFromSettings();
      }

      if (result.models.length > 0) {
        _cachedModels = result.models;
        _cachedGrouped = result.grouped;
        _cacheTime = Date.now();
        if (mountedRef.current) {
          setModels(result.models);
          setGrouped(result.grouped);
        }
      } else {
        if (mountedRef.current) {
          setModels([]);
          setGrouped({});
          setError('No models available');
        }
      }
    } catch (err: unknown) {
      console.warn('[useModels] pool fetch failed, falling back to settings:', (err as Error).message);
      const result = buildFromSettings();
      if (result.models.length > 0) {
        if (mountedRef.current) {
          setModels(result.models);
          setGrouped(result.grouped);
        }
      } else {
        if (mountedRef.current) {
          setError((err as Error).message);
        }
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled]);

  /** 从 config.yaml 读取当前主模型 */
  const loadCurrentModel = useCallback(async () => {
    try {
      const config: Record<string, unknown> = await call('get_config', {});
      if (config?.model) {
        if (typeof config.model === 'string') {
          if (mountedRef.current) setSelectedModel(config.model);
        } else if (typeof config.model === 'object' && config.model !== null) {
          const modelObj = config.model as Record<string, string>;
          const ref = modelObj.ref || '';
          if (ref) {
            if (mountedRef.current) setSelectedModel(ref);
          } else if (modelObj.provider && modelObj.default) {
            if (mountedRef.current) setSelectedModel(`${modelObj.provider}/${modelObj.default}`);
          }
        }
      }
    } catch { /* ignore */ }
  }, []);

  /**
   * 选中模型 → 写 config.yaml model.ref（与设置面板 handleSave 同逻辑）
   */
  const selectModel = useCallback(async (modelId: string) => {
    if (!modelId) return;
    setSelectedModel(modelId);
    try {
      const slashIdx = modelId.indexOf('/');
      const provider = slashIdx > 0 ? modelId.slice(0, slashIdx) : modelId;
      const model = slashIdx > 0 ? modelId.slice(slashIdx + 1) : '';
      await call('update_config', {
        config: {
          model: {
            ref: modelId,
            provider,
            default: model,
          },
        },
      });
    } catch (err: unknown) {
      console.warn('[useModels] selectModel failed:', (err as Error).message);
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (enabled) {
      refresh();
      loadCurrentModel();
      // 🔴 修复时序竞态：portReady 后后端可能还未完全就绪，首次失败后延迟重试
      const retryTimer = setTimeout(() => {
        if (mountedRef.current && _cachedModels === null) {
          refresh();
        }
      }, 1500);
      return () => clearTimeout(retryTimer);
    }
  }, [enabled, refresh, loadCurrentModel]);

  return {
    models,
    grouped,
    loading,
    error,
    refresh,
    selectedModel,
    selectModel,
  };
}
