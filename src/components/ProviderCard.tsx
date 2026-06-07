import { useState, useEffect } from 'react';
import { Eye, EyeOff, Trash2, Plus, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface Provider {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  models: string[];
}

interface ProviderCardProps {
  provider: Provider;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (id: string, field: string, value: string) => void;
  onAddModel: (id: string, modelName: string) => void;
  onRemoveModel: (id: string, modelName: string) => void;
  onDelete: (id: string) => void;
  onRequestUnlock: (id: string) => void;
  onSave?: () => void;
  keyVisible: boolean;
}

/**
 * 提供商卡片 — 展示/编辑单个 API 提供商
 *
 * Props:
 *   provider:     { id, name, apiKey, baseUrl, models }
 *   expanded:     boolean — 是否展开详情
 *   onToggle:     () => void — 切换展开
 *   onUpdate:     (id, field, value) => void — 更新字段
 *   onAddModel:   (id, modelName) => void
 *   onRemoveModel:(id, modelName) => void
 *   onDelete:     (id) => void
 *   onRequestUnlock: (id) => void — 请求密码解锁以查看 Key
 *   keyVisible:   boolean — 当前 Key 是否可见
 */
export default function ProviderCard({
  provider,
  expanded,
  onToggle,
  onUpdate,
  onAddModel,
  onRemoveModel,
  onDelete,
  onRequestUnlock,
  onSave,
  keyVisible,
}: ProviderCardProps) {
  const [newModel, setNewModel] = useState('');
  const [selectedModel, setSelectedModel] = useState('');

  // models 变化时重置选中（比如删除后）
  useEffect(() => {
    if (provider.models.length === 0) {
      setSelectedModel('');
    } else if (!provider.models.includes(selectedModel)) {
      setSelectedModel(provider.models[0]);
    }
  }, [provider.models]);

  const handleAddModel = () => {
    const name = newModel.trim();
    if (name && !provider.models.includes(name)) {
      onAddModel(provider.id, name);
      setNewModel('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddModel();
  };

  const selectClasses = cn(
    'flex h-7 w-full items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none',
    'transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50',
    'disabled:cursor-not-allowed disabled:opacity-50'
  );

  return (
    <div className={cn('border border-border rounded-lg mb-2 bg-card overflow-hidden')}>
      {/* 卡片头部 */}
      <button className={cn('flex items-center justify-between w-full px-3 py-2 cursor-pointer bg-transparent border-none text-left hover:bg-muted/30 transition-colors')} onClick={onToggle} type="button">
        <div className={cn('flex items-center gap-2 min-w-0')}>
          <span className={cn('text-sm font-medium text-foreground truncate')}>{provider.name}</span>
          <span className={cn('text-xs text-muted-foreground shrink-0')}>({provider.id})</span>
        </div>
        <span className={cn('text-xs text-muted-foreground shrink-0')}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className={cn('border-t border-border px-3 py-3 space-y-3')}>
          {/* API Key */}
          <div className={cn('space-y-1.5')}>
            <label className={cn('block text-xs text-muted-foreground')}>API Key</label>
            <div className={cn('flex items-center gap-1')}>
              <Input
                type={keyVisible ? 'text' : 'password'}
                className={cn('h-7 text-xs')}
                value={provider.apiKey || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(provider.id, 'apiKey', e.target.value)}
                placeholder="输入 API Key"
                autoComplete="off"
              />
              <button
                className={cn('inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors bg-transparent border-none cursor-pointer shrink-0')}
                title={keyVisible ? '隐藏' : '显示'}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRequestUnlock(provider.id); }}
                type="button"
              >
                {keyVisible
                  ? <EyeOff size={14} strokeWidth={1.5} />
                  : <Eye size={14} strokeWidth={1.5} />}
              </button>
            </div>
          </div>

          {/* Base URL */}
          <div className={cn('space-y-1.5')}>
            <label className={cn('block text-xs text-muted-foreground')}>Base URL</label>
            <Input
              type="text"
              className={cn('h-7 text-xs')}
              value={provider.baseUrl || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(provider.id, 'baseUrl', e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          {/* 模型列表 */}
          <div className={cn('space-y-1.5')}>
            <label className={cn('block text-xs text-muted-foreground')}>模型列表</label>
            <div className={cn('flex items-center gap-1')}>
              <select
                className={selectClasses}
                value={selectedModel}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedModel(e.target.value)}
              >
                <option value="" disabled>选择模型</option>
                {provider.models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {provider.models.length > 0 && (
                <button
                  className={cn('inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors bg-transparent border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0')}
                  onClick={() => {
                    if (selectedModel) {
                      onRemoveModel(provider.id, selectedModel);
                      setSelectedModel('');
                    }
                  }}
                  disabled={!selectedModel}
                  title="删除选中模型"
                  type="button"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className={cn('flex items-center gap-1 mt-2')}>
              <Input
                type="text"
                className={cn('h-7 text-xs')}
                placeholder="添加模型名"
                value={newModel}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewModel(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className={cn('inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors bg-transparent border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0')}
                onClick={handleAddModel}
                disabled={!newModel.trim()}
                title="添加模型"
                type="button"
              >
                <Plus size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* 删除按钮 + 保存按钮 */}
          <div className={cn('flex items-center justify-between pt-3 border-t border-border')}>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDelete(provider.id)}
              type="button"
            >
              <Trash2 size={13} strokeWidth={1.5} />
              删除厂商
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onSave}
              type="button"
            >
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
