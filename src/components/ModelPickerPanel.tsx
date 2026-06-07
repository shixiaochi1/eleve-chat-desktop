/**
 * ModelPickerPanel — Model auto-discovery panel
 *
 * Fetches available models from GET /v1/models and allows model selection.
 * Features: search filter, grouped by provider, loading skeleton, empty state, refresh.
 */
import { useState, useMemo, useCallback } from 'react';
import { Cpu, Search, RefreshCw, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface ModelPickerPanelProps {
  models?: ModelItem[];
  grouped?: Record<string, ModelGroup>;
  loading?: boolean;
  error?: string | null;
  selectedModel?: string;
  onSelect?: (modelId: string) => void;
  onRefresh?: () => void;
  onClose?: () => void;
}

interface EmptyStateProps {
  onRefresh?: () => void;
  searchQuery?: string;
}

interface ErrorStateProps {
  error?: string;
  onRefresh?: () => void;
}

interface ProviderGroupProps {
  groupKey: string;
  group: ModelGroup;
  selectedModel?: string;
  onSelect: (modelId: string) => void;
  searchQuery?: string;
}

/**
 * Skeleton loader shown while models are being fetched
 */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 animate-pulse">
      <div className="w-4 h-4 rounded bg-muted" />
      <div className="h-3 flex-1 rounded bg-muted" />
      <div className="w-12 h-3 rounded bg-muted" />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-0.5">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

/**
 * Empty state when no models are found
 */
function EmptyState({ onRefresh, searchQuery }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
      <Cpu size={32} strokeWidth={1} className="text-muted-foreground/20" />
      {searchQuery ? (
        <p className="text-xs">No models matching &quot;{searchQuery}&quot;</p>
      ) : (
        <>
          <p className="text-xs">No models available</p>
          <p className="text-[10px] text-muted-foreground/50">Try refreshing or check your provider configuration</p>
          <button className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent text-accent-foreground hover:bg-accent/90 transition-colors" onClick={onRefresh}>
            <RefreshCw size={14} strokeWidth={1.5} />
            Refresh
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Error state
 */
function ErrorState({ error, onRefresh }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
      <p className="text-xs text-destructive">{error}</p>
      <button className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent text-accent-foreground hover:bg-accent/90 transition-colors" onClick={onRefresh}>
        <RefreshCw size={14} strokeWidth={1.5} />
        Retry
      </button>
    </div>
  );
}

/**
 * Provider group section with collapsible header
 */
function ProviderGroup({ groupKey, group, selectedModel, onSelect, searchQuery }: ProviderGroupProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Filter models by search query
  const filteredModels = useMemo(() => {
    if (!searchQuery) return group.models;
    const q = searchQuery.toLowerCase();
    return group.models.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.owned_by?.toLowerCase().includes(q)
    );
  }, [group.models, searchQuery]);

  if (filteredModels.length === 0) return null;

  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={cn(
            'text-muted-foreground/40 transition-transform',
            collapsed && '-rotate-90'
          )}
        />
        <span className="flex-1 text-left font-medium">{group.providerName}</span>
        <span className="text-[10px] text-muted-foreground/50">{filteredModels.length}</span>
      </button>

      {!collapsed && (
        <div className="ml-2 space-y-0.5">
          {filteredModels.map(m => (
            <button
              key={m.id}
              className={cn(
                'flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs transition-colors text-left',
                m.id === selectedModel ? 'bg-accent/10 text-accent' : 'text-foreground hover:bg-accent/30'
              )}
              onClick={() => onSelect(m.id)}
              title={m.id}
            >
              <Cpu size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">
                {m.id.includes('/') ? m.id.split('/').pop() : m.id}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/50 px-1 py-0.5 bg-muted/50 rounded">
                {m.owned_by || m.providerName || groupKey}
              </span>
              <span className="hidden">{m.id}</span>
              {m.id === selectedModel && (
                <Check size={14} strokeWidth={2} className="shrink-0 text-accent" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ModelPickerPanel({
  models = [],
  grouped = {},
  loading = false,
  error = null,
  selectedModel = '',
  onSelect,
  onRefresh,
  onClose,
}: ModelPickerPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelect = useCallback((modelId: string) => {
    onSelect?.(modelId);
    onClose?.();
  }, [onSelect, onClose]);

  // If all models are flat (not grouped), create a single group
  const groups = useMemo(() => {
    const keys = Object.keys(grouped);
    if (keys.length > 0) return grouped;

    // Fallback: create a single "All Models" group
    if (models.length > 0) {
      return {
        all: {
          providerId: 'all',
          providerName: 'Available Models',
          models: models.map(m => typeof m === 'string' ? { id: m, owned_by: '' } : m),
        },
      };
    }
    return {};
  }, [grouped, models]);

  const groupKeys = useMemo(() => Object.keys(groups), [groups]);

  // If loading with no data, show skeleton
  const showSkeleton = loading && models.length === 0;

  return (
    <div className="flex flex-col h-full p-3">
      {/* Search input */}
      <div className="relative mb-2">
        <Search size={14} strokeWidth={1.5} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="w-full h-7 pl-8 pr-7 text-xs bg-muted/50 rounded border border-border focus:border-accent focus:outline-none placeholder:text-muted-foreground/50"
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          autoFocus
        />
        {searchQuery && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSearchQuery('')}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Refresh + header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">
          {loading ? 'Refreshing...' : `${models.length} model${models.length !== 1 ? 's' : ''}`}
        </span>
        <button
          className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-accent/30 transition-colors"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh model list"
        >
          <RefreshCw size={14} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {showSkeleton ? (
          <LoadingSkeleton />
        ) : error && models.length === 0 ? (
          <ErrorState error={error} onRefresh={onRefresh} />
        ) : groupKeys.length === 0 ? (
          <EmptyState onRefresh={onRefresh} searchQuery={searchQuery} />
        ) : (
          groupKeys.map(key => (
            <ProviderGroup
              key={key}
              groupKey={key}
              group={groups[key]}
              selectedModel={selectedModel}
              onSelect={handleSelect}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>
    </div>
  );
}
