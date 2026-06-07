/**
 * useModels — Model auto-discovery hook
 *
 * Fetches available models from GET /v1/models (OpenAI-compatible).
 * Groups by provider, caches for 5 minutes, falls back to settings-store.
 *
 * Returns: { models, grouped, loading, error, refresh, selectedModel, selectModel }
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchModels, setModel as apiSetModel } from '../utils/api';
import { loadSettings } from '../utils/settings-store';
import type { ModelOptionProvider } from '@/types/hermes';

interface ModelItem {
  id: string;
  owned_by?: string;
  providerName?: string;
}

interface ModelGroup {
  providerId: string;
  providerName: string;
  models: ModelItem[];
}

interface GroupedModels {
  [providerId: string]: ModelGroup;
}

interface ProviderConfig extends Partial<ModelOptionProvider> {
  id: string;
}

interface SettingsStore {
  providers?: ProviderConfig[];
}

// ── Cache ──
let _cachedModels: ModelItem[] | null = null;
let _cachedGrouped: GroupedModels | null = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isCacheValid(): boolean {
  return !!(_cachedModels && (Date.now() - _cacheTime) < CACHE_TTL);
}

/**
 * Group raw model objects by provider (owned_by)
 */
function groupModelsByProvider(models: ModelItem[]): GroupedModels {
  const grouped: GroupedModels = {};
  for (const m of models) {
    const provider = m.owned_by || 'unknown';
    if (!grouped[provider]) {
      grouped[provider] = {
        providerId: provider,
        providerName: provider.charAt(0).toUpperCase() + provider.slice(1),
        models: [],
      };
    }
    grouped[provider].models.push(m);
  }
  return grouped;
}

/**
 * Parse models from API response (handles OpenAI-compatible and flat formats)
 */
interface ApiModelsResponse {
  object?: string;
  data?: ModelItem[];
  models?: (ModelItem | string)[];
}

function parseModelsResponse(resp: ApiModelsResponse | null | undefined): ModelItem[] {
  if (!resp) return [];

  // OpenAI-compatible: { object: 'list', data: [{ id, owned_by, ... }] }
  if (resp.object === 'list' && Array.isArray(resp.data) && resp.data.length > 0) {
    return resp.data.filter((m: ModelItem) => m.id && !m.id.startsWith('ft:'));
  }

  // Flat array of model objects
  if (Array.isArray(resp)) {
    return (resp as ModelItem[]).filter((m: ModelItem) => m.id || typeof m === 'string');
  }

  // Array of strings
  if (resp.models && Array.isArray(resp.models)) {
    return resp.models.map((m: ModelItem | string) => typeof m === 'string' ? { id: m, owned_by: 'default' } : m);
  }

  return [];
}

/**
 * Fallback: read models from settings-store providers
 */
function getFallbackModels(): ModelItem[] {
  try {
    const settings: SettingsStore | null = loadSettings();
    if (!settings || !settings.providers) return [];

    const models: ModelItem[] = [];
    for (const p of settings.providers) {
      if (Array.isArray(p.models)) {
        for (const m of p.models) {
          models.push({
            id: m,
            owned_by: p.id,
            providerName: p.name || p.id,
          });
        }
      }
    }
    return models;
  } catch {
    return [];
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
      const resp = await fetchModels();
      const parsed = parseModelsResponse(resp);

      if (parsed.length > 0) {
        const grp = groupModelsByProvider(parsed);
        _cachedModels = parsed;
        _cachedGrouped = grp;
        _cacheTime = Date.now();

        if (mountedRef.current) {
          setModels(parsed);
          setGrouped(grp);
        }
      } else {
        // Fallback to settings-store
        const fallback = getFallbackModels();
        if (fallback.length > 0) {
          const grp = groupModelsByProvider(fallback);
          if (mountedRef.current) {
            setModels(fallback);
            setGrouped(grp);
          }
        } else {
          if (mountedRef.current) {
            setModels([]);
            setGrouped({});
            setError('No models available');
          }
        }
      }
    } catch (err: unknown) {
      console.warn('[useModels] fetch failed, falling back to settings-store:', (err as Error).message);

      // Fallback to settings-store
      const fallback = getFallbackModels();
      if (fallback.length > 0) {
        const grp = groupModelsByProvider(fallback);
        if (mountedRef.current) {
          setModels(fallback);
          setGrouped(grp);
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

  /**
   * Select a model — calls the backend to set it
   */
  const selectModel = useCallback(async (modelId: string) => {
    if (!modelId) return;
    setSelectedModel(modelId);
    try {
      await apiSetModel(modelId);
    } catch (err: unknown) {
      console.warn('[useModels] setModel failed:', (err as Error).message);
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
    }
  }, [enabled, refresh]);

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
