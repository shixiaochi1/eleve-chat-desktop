import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { fetchModels, fetchConfig, setModel } from '../utils/api';
import { ModelIcon, CheckIcon } from './Icons';

interface ModelSelectorProps {
  portReady?: boolean;
  portVersion?: string;
  onModelChange?: (modelId: string) => void;
}

/**
 * 模型选择器 — 输入区上方下拉菜单
 */
export default function ModelSelector({ portReady, portVersion, onModelChange }: ModelSelectorProps) {
  const [models, setModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const FALLBACK_MODELS: string[] = [
    'cmcc/cm-code-latest',
    'bailian/qwen-plus',
    'bailian/qwen-max',
    'bailian/qwen-turbo',
    'eleve-agent',
  ];

  const loadModels = useCallback(async () => {
    if (!portReady) return;
    setLoading(true);
    setError(null);
    try {
      let modelList: string[] = [];
      try {
        const resp: { object?: string; data?: Array<{id?: string}> } = await fetchModels();
        if (resp?.object === 'list' && Array.isArray(resp.data) && resp.data.length > 0) {
          modelList = resp.data.map((m: {id?: string}) => m.id ?? '');
        }
      } catch { /* ignore */ }

      let activeModel = '';
      try {
        const config: Record<string, unknown> = await fetchConfig();
        if (config?.model && typeof config.model === 'string') {
          activeModel = config.model;
        }
      } catch { /* ignore */ }

      if (modelList.length <= 1 && modelList[0] === 'eleve-agent') {
        modelList = FALLBACK_MODELS;
      }

      if (!activeModel && modelList.length > 0) {
        activeModel = modelList[0];
      }

      setModels(modelList);
      setCurrentModel(activeModel || '');
    } catch (err: unknown) {
      setError((err as Error).message);
      setModels(FALLBACK_MODELS);
      if (!currentModel) setCurrentModel(FALLBACK_MODELS[0]);
    } finally {
      setLoading(false);
    }
  }, [portReady]);

  useEffect(() => {
    loadModels();
  }, [loadModels, portVersion]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelect = useCallback(async (modelId: string) => {
    if (modelId === currentModel) {
      setOpen(false);
      return;
    }
    setOpen(false);
    setCurrentModel(modelId);
    try {
      await setModel(modelId);
      onModelChange?.(modelId);
    } catch (err: unknown) {
      setError((err as Error).message);
      loadModels();
    }
  }, [currentModel, onModelChange, loadModels]);

  const displayName = currentModel
    ? currentModel.includes('/')
      ? currentModel.split('/').pop()
      : currentModel
    : '选择模型';

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm text-foreground transition-all',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          'disabled:pointer-events-none disabled:opacity-50',
          open && 'ring-2 ring-ring/40'
        )}
        onClick={() => setOpen(o => !o)}
        disabled={loading}
        title={`当前模型: ${currentModel || '未设置'}`}
      >
        <span className="inline-flex shrink-0 items-center text-muted-foreground">
          <ModelIcon size={14} />
        </span>
        <span className="flex-1 truncate text-left">
          {loading ? '加载中…' : displayName}
        </span>
        <span className="inline-flex shrink-0 items-center text-[10px] text-muted-foreground">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className={cn(
          'absolute left-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden',
          'rounded-lg border bg-popover text-popover-foreground shadow-md'
        )}>
          <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
            选择模型
          </div>
          {models.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              暂无可用模型
            </div>
          )}
          {models.map((m) => (
            <div
              key={m}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                m === currentModel && 'bg-accent text-accent-foreground'
              )}
              onClick={() => handleSelect(m)}
            >
              <span className="flex-1 truncate font-medium">
                {m.includes('/') ? m.split('/').pop() : m}
              </span>
              <span className="hidden truncate text-xs text-muted-foreground group-hover:block">
                {m}
              </span>
              {m === currentModel && (
                <span className="inline-flex shrink-0 items-center text-primary">
                  <CheckIcon size={12} />
                </span>
              )}
            </div>
          ))}
          {error && (
            <div className="border-t border-border px-3 py-1.5 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
