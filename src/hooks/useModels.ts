/**
 * useModels — Provider + Model discovery hook
 *
 * 数据源：全局 Provider 池（listPoolProviders，唯一权威源）。
 * 选中模型 → update_config 写 config.yaml model.ref（持久化默认模型）。
 * 会话级即时生效由 prompt.submit 携带 model 参数完成（usePromptActions）。
 * 当前模型 → get_config 读 model.ref。
 *
 * Returns: { models, grouped, loading, error, refresh, selectedModel, selectModel }
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { call } from '../utils/bridge';
import { listPoolProviders } from '../utils/settings-store';
import type { PoolProvider } from '../utils/settings-store';
import { getWsClient } from '@/services/ws-client';

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



export default function useModels({ enabled = true, sessionId = '' }: { enabled?: boolean; sessionId?: string } = {}) {
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

      // 池是唯一权威源，池空 = 无可用模型（不再兜底 settings.json）

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
          setError('empty'); // 语义化标记：池空（未配置），非连接错误
        }
      }
    } catch (err: unknown) {
      console.warn('[useModels] pool fetch failed:', (err as Error).message);
      if (mountedRef.current) {
        setError((err as Error).message || '无法连接 Provider 池');
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
   * 选中模型 → 调 provider.switch RPC（per-session override，对齐 Hermes 桌面端）
   *
   * 🔴 ModelPill = per-session override，不写 config.yaml。
   * 永久默认模型在 Settings → Model 设置（写 config.yaml model.ref）。
   * 会话级即时生效由 prompt.submit 携带 model 参数完成（usePromptActions）。
   */
  const selectModel = useCallback(async (modelId: string) => {
    if (!modelId) return;
    setSelectedModel(modelId);
    try {
      const slashIdx = modelId.indexOf('/');
      const provider = slashIdx > 0 ? modelId.slice(0, slashIdx) : modelId;
      const model = slashIdx > 0 ? modelId.slice(slashIdx + 1) : '';
      // per-session override：走 provider.switch RPC（后端 v7.1 switch_runtime_inner 统一路径）
      if (sessionId) {
        await call('provider_switch', {
          session_id: sessionId,
          provider_id: provider,
          model,
        });
      } else {
        // 无活跃会话时回退写 config.yaml（下次 session.create 带过去）
        await call('update_config', {
          config: {
            model: {
              ref: modelId,
              provider,
              default: model,
            },
          },
        });
      }
    } catch (err: unknown) {
      console.warn('[useModels] selectModel failed:', (err as Error).message);
      setError((err as Error).message);
    }
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    loadCurrentModel();

    // 冷启动兖底：池加载需要时间（providers.yaml 读取 + watcher 初始化）
    const coldTimer = setTimeout(() => {
      if (mountedRef.current && _cachedModels === null) refresh();
    }, 3000);

    // 事件驱动：后端池变更（upsert/remove/save_key/disconnect）→ 立即刷新
    const ws = getWsClient();
    const unsubscribe = ws.addEventListener((eventName) => {
      if (eventName === 'provider.pool_changed' && mountedRef.current) {
        _cachedModels = null; // 清除缓存，强制重新拉取
        refresh();
      }
    });

    return () => {
      clearTimeout(coldTimer);
      unsubscribe();
    };
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
