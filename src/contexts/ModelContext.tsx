/**
 * ModelContext — 模型系统全局上下文（消除 prop drilling）
 *
 * App 层 useModels() 持有模型数据单例，经 ModelProvider 下发。
 * ModelPill / GridModeView / 任何需要模型数据的组件直接 useModelContext() 消费，
 * 无需经 GridModeView → AgentChatCard → ModelPill 三层透传。
 */
import { createContext, useContext } from 'react';
import type { GroupedModels } from '@/hooks/useModels';

export interface ModelContextValue {
  currentModel?: string;
  grouped?: GroupedModels;
  loading?: boolean;
  error?: string | null;
  onSelect?: (modelId: string) => void;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
}

const ModelContext = createContext<ModelContextValue>({});

export const ModelProvider = ModelContext.Provider;

export function useModelContext(): ModelContextValue {
  return useContext(ModelContext);
}
