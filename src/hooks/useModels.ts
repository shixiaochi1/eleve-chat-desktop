/**
 * useModels — Provider + Model discovery hook
 *
 * 数据源：全局 Provider 池（listPoolProviders，唯一权威源）。
 * 选中模型 → update_config 写 config.yaml model.ref（持久化默认模型）。
 * 会话级即时生效 = selectModel 的 provider.switch（override_client）+ config 热更新
 * （watcher → update_llm_client_v2）；发送链不再携带 model（per-profile 权威，
 * 🔴 M-2 修复：宫格各 Agent 用自己 session 的 client，不再共用全局 model）。
 * 🔴 M-1 修复：selectedModel 为「当前焦点 profile」的模型，切换 profile 重载；
 * selectModel 支持显式 targetProfile/targetSessionId（宫格卡片 per-Agent 选择）。
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



export default function useModels({ enabled = true, sessionId = '', currentProfile = 'default' }: { enabled?: boolean; sessionId?: string; currentProfile?: string } = {}) {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [grouped, setGrouped] = useState<GroupedModels>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const mountedRef = useRef(true);

  const refresh = useCallback(async (force = false) => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    // Use cache if valid（force=true 跳过缓存：下拉展开/池变更时强制拉取）
    if (!force && isCacheValid()) {
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
   * 选中模型 = 设默认（老大 2026-07-26 决策）— 双写闭环：
   *
   * 1. update_config 写目标 profile 的 config.yaml model.ref — 持久默认（重启生效）。
   *    config 热更新触发该 profile engine LlmClient 刷新（bootstrap 双源 select）。
   *    targetProfile 显式传入时覆盖 sendRpc 的 activeProfile 章（bridge 透传）。
   * 2. provider.switch — 目标 session 即时生效（per-session 显式覆盖，
   *    后端解析链守卫保证显式参数不被 model_ref 默认劫持）。
   *
   * 🔴 M-1/M-2 修复：targetProfile/targetSessionId 支持宫格卡片 per-Agent 选择
   * （写该卡片 profile 的 config + 切该卡片的 session）；单视图省略 → 盖 activeProfile
   * 章 + 用 App 级 session。
   */
  const selectModel = useCallback(async (modelId: string, targetProfile?: string, targetSessionId?: string) => {
    if (!modelId) return;
    setSelectedModel(modelId);
    try {
      const slashIdx = modelId.indexOf('/');
      const provider = slashIdx > 0 ? modelId.slice(0, slashIdx) : modelId;
      const model = slashIdx > 0 ? modelId.slice(slashIdx + 1) : '';
      // ① 持久默认：写目标 profile 的 config.yaml model.ref（新旧字段同写，兼容解析链两个读取点）
      await call('update_config', {
        config: {
          model: {
            ref: modelId,
            provider,
            default: model,
          },
        },
        ...(targetProfile ? { profile: targetProfile } : {}),
      });
      // ② 目标会话即时生效：per-session override（无会话时仅靠 ①，下次 session.create 带过去）
      const effectiveSessionId = targetSessionId ?? sessionId;
      if (effectiveSessionId) {
        await call('provider_switch', {
          session_id: effectiveSessionId,
          provider_id: provider,
          model,
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

  // 🔴 M-1 修复：依赖 currentProfile — 切换 profile 时重载该 profile 的 config.model
  // （get_config 经 sendRpc 盖 activeProfile 章，读的是当前焦点 profile）
  useEffect(() => {
    if (!enabled) return;
    refresh();
    loadCurrentModel();

    // 冷启动兖底：池加载需要时间（providers.yaml 读取 + watcher 初始化）
    const coldTimer = setTimeout(() => {
      if (mountedRef.current && _cachedModels === null) refresh();
    }, 3000);

    // 事件驱动：后端池变更（upsert/remove/save_key/disconnect）→ 立即刷新。
    // 后端经 ws_conns 连接广播表推送（连接建立即注册，不依赖 session_id）。
    // 下方 empty 轮询保留为二道保险（网络抖动/事件丢失兜底）。
    const ws = getWsClient();
    const unsubscribe = ws.addEventListener((eventName) => {
      if (eventName === 'provider.pool_changed' && mountedRef.current) {
        _cachedModels = null; // 清除缓存，强制重新拉取
        refresh(true);
      }
    });

    return () => {
      clearTimeout(coldTimer);
      unsubscribe();
    };
  }, [enabled, refresh, loadCurrentModel, currentProfile]);

  // 兜底轮询：池空（error='empty'）时每 5s 重试，直到拿到模型。
  // 主路径是 provider.pool_changed 事件（后端 ws_conns 广播）；此轮询为二道保险。
  // empty 不写缓存，故轮询每次都会真实请求；拿到模型后 error 清除、轮询自停。
  useEffect(() => {
    if (!enabled || error !== 'empty') return;
    const timer = setInterval(() => {
      if (mountedRef.current) refresh(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [enabled, error, refresh]);

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
