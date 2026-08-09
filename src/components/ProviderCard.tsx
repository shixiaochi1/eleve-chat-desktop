import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff, Trash2, Plus, X, KeyRound, Globe, Cpu } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { lookupModelCapabilities } from '@/utils/settings-store';
import type { ProviderModel } from '@/utils/settings-store';

interface Provider {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  transport?: string;
  models: ProviderModel[];
  // Phase P5: 全局池状态
  hasKey?: boolean;
  credentialType?: string;
  source?: string;
}

interface ProviderCardProps {
  provider: Provider;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (id: string, field: string, value: string) => void;
  onAddModel: (id: string, model: ProviderModel) => void;
  onRemoveModel: (id: string, modelName: string) => void;
  onDelete: (id: string) => void;
  onRequestUnlock: (id: string) => void;
  onSave?: () => void;
  keyVisible: boolean;
}

/** 数字格式化：128000 → 128K */
function fmtTokens(n: number | undefined | null): string {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/**
 * 服务商卡片 — 展示/编辑单个 API 服务商
 *
 * 🔴 2026-08-10 UI 重构（对齐 Hermes custom-endpoints-settings）：
 * - 模型列表表格化（模型名 + 上下文/输出徽章 + 行删除），取代原 select 下拉
 * - 添加模型支持手动输入上下文大小 / 最大输出（对齐 Hermes CustomEndpoint.context_length）
 * - models.dev 命中时自动填充能力参数，仍可手改
 * - 添加按钮不再被查询状态锁死（查询仅是提示）
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
  const [newCtx, setNewCtx] = useState('');
  const [modelHint, setModelHint] = useState<string | null>(null);
  const [modelLooking, setModelLooking] = useState(false);
  // 🔴 2026-08-10：添加成功后的明显提示（独立于查询 hint，防 debounce 覆盖）
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  // 输入模型名时异步查询 models.dev 参数 → 命中自动填充 ctx（可手改）
  const lookupModel = useCallback(
    async (name: string) => {
      if (!name.trim()) { setModelHint(null); return; }
      setModelLooking(true);
      try {
        const caps = await Promise.race([
          lookupModelCapabilities(provider.id, name.trim()),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 3000)),
        ]);
        if (caps) {
          const parts: string[] = [];
          if (caps.context_length) parts.push(`ctx ${fmtTokens(caps.context_length as number)}`);
          if (caps.supports_vision) parts.push('vision');
          if (caps.reasoning) parts.push('reasoning');
          if (caps.tool_call) parts.push('tools');
          setModelHint(parts.length > 0 ? `✓ ${parts.join(' · ')}` : '✓ found');
          // 自动填充上下文（仅当用户还没手填过）
          if (!newCtx && (caps.context_length as number) > 0) setNewCtx(String(caps.context_length));
        } else {
          setModelHint('— not in models.dev，可手动填写参数');
        }
      } catch {
        setModelHint(null);
      } finally {
        setModelLooking(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider.id],
  );

  // 输入变化时 debounce 查询
  useEffect(() => {
    const t = setTimeout(() => lookupModel(newModel), 400);
    return () => clearTimeout(t);
  }, [newModel, lookupModel]);

  const handleAddModel = () => {
    const name = newModel.trim();
    if (!name) return;
    if (provider.models.some(m => m.name === name)) {
      setModelHint('⚠ 该模型已在列表中');
      return;
    }
    const ctx = parseInt(newCtx, 10);
    onAddModel(provider.id, {
      name,
      context_length: Number.isFinite(ctx) && ctx > 0 ? ctx : 128000,
      // UI 不暴露输出字段（老大 2026-08-10）：后端保留默认 16384
      max_output: 16384,
    });
    setNewModel('');
    setNewCtx('');
    setModelHint(null);
    // 🔴 明显成功提示（3s 后自动消失）
    setAddSuccess(`✓ 已添加「${name}」，点底部「保存」后生效`);
    setTimeout(() => setAddSuccess(null), 3000);
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
    <div className={cn('border border-border rounded-xl bg-card overflow-hidden transition-colors hover:border-border/80')}>
      {/* ── 卡片头部 ── */}
      <button
        className={cn('flex items-center justify-between w-full px-3.5 py-2.5 cursor-pointer bg-transparent border-none text-left hover:bg-muted/30 transition-colors')}
        onClick={onToggle}
        type="button"
      >
        <div className={cn('flex items-center gap-2 min-w-0')}>
          <span className={cn('text-sm font-medium text-foreground truncate')}>{provider.name}</span>
          <span className={cn('text-[11px] font-mono text-muted-foreground/70 shrink-0')}>{provider.id}</span>
          {/* 状态徽章 */}
          {provider.source === 'global_pool' && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0 font-medium')}>池</span>
          )}
          {provider.source === 'preset' && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0 font-medium')}>预设</span>
          )}
          {provider.hasKey !== undefined && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium',
              provider.hasKey ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
            )}>
              {provider.hasKey ? '已配 Key' : '未配 Key'}
            </span>
          )}
        </div>
        <span className={cn('text-xs text-muted-foreground shrink-0 transition-transform', expanded && 'rotate-180')}>
          ▾
        </span>
      </button>

      {/* ── 展开详情 ── */}
      {expanded && (
        <div className={cn('border-t border-border/60 px-3.5 py-3.5 space-y-3.5')}>
          {/* API Key */}
          <div className={cn('grid gap-1.5')}>
            <label className={cn('flex items-center gap-1.5 text-xs text-muted-foreground')}>
              <KeyRound size={12} strokeWidth={1.5} /> API Key
            </label>
            <div className={cn('flex items-center gap-1')}>
              <Input
                type={keyVisible ? 'text' : 'password'}
                className={cn('h-7.5 text-xs')}
                value={provider.apiKey || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(provider.id, 'apiKey', e.target.value)}
                placeholder="输入 API Key"
                autoComplete="off"
              />
              <button
                className={cn('inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors bg-transparent border-none cursor-pointer shrink-0')}
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
          <div className={cn('grid gap-1.5')}>
            <label className={cn('flex items-center gap-1.5 text-xs text-muted-foreground')}>
              <Globe size={12} strokeWidth={1.5} /> Base URL
            </label>
            <Input
              type="text"
              className={cn('h-7.5 text-xs')}
              value={provider.baseUrl || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(provider.id, 'baseUrl', e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          {/* 协议/传输方式 */}
          <div className={cn('grid gap-1.5')}>
            <label className={cn('flex items-center gap-1.5 text-xs text-muted-foreground')}>
              <Cpu size={12} strokeWidth={1.5} /> 协议
            </label>
            <select
              className={selectClasses}
              value={provider.transport || 'auto'}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onUpdate(provider.id, 'transport', e.target.value)}
            >
              <option value="auto">自动推断</option>
              <option value="openai_chat">OpenAI 兼容</option>
              <option value="anthropic_messages">Anthropic 兼容</option>
              <option value="codex_responses">Codex Responses</option>
            </select>
            <p className={cn('text-[11px] text-muted-foreground/60')}>
              {provider.transport && provider.transport !== 'auto'
                ? `手动指定：${provider.transport}`
                : '根据 Base URL 和 Provider 自动推断协议'}
            </p>
          </div>

          {/* 模型列表 */}
          <div className={cn('grid gap-1.5')}>
            <label className={cn('flex items-center justify-between text-xs text-muted-foreground')}>
              <span className={cn('flex items-center gap-1.5')}>模型列表</span>
              <span className={cn('text-[11px] text-muted-foreground/50')}>{provider.models.length} 个模型</span>
            </label>

            {/* 模型行 */}
            <div className={cn('rounded-lg border border-border/60 divide-y divide-border/40 bg-muted/10')}>
              {provider.models.length === 0 ? (
                <div className={cn('px-3 py-2.5 text-xs text-muted-foreground/60')}>暂无模型，请在下方添加</div>
              ) : (
                provider.models.map(m => (
                  <div key={m.name} className={cn('flex items-center gap-2 px-2.5 py-1.5 group/row')}>
                    <span className={cn('flex-1 min-w-0 truncate text-xs text-foreground')}>{m.name}</span>
                    <span className={cn('shrink-0 rounded-md bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary')} title={`上下文窗口 ${m.context_length} tokens`}>
                      ctx {fmtTokens(m.context_length)}
                    </span>
                    <button
                      className={cn('shrink-0 inline-flex items-center justify-center size-5.5 rounded text-muted-foreground/50 opacity-0 group-hover/row:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all bg-transparent border-none cursor-pointer')}
                      onClick={() => onRemoveModel(provider.id, m.name)}
                      title={`删除 ${m.name}`}
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 添加模型：名称 + 上下文（🔴 + 号改明显文字按钮，UI 不暴露输出字段） */}
            <div className={cn('flex items-center gap-1.5 mt-1')}>
              <Input
                type="text"
                className={cn('h-7.5 flex-1 text-xs')}
                placeholder="模型名（如 glm-5）"
                value={newModel}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewModel(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Input
                type="text"
                inputMode="numeric"
                className={cn('h-7.5 w-[100px] text-xs')}
                placeholder="上下文"
                title="上下文窗口大小（tokens），留空默认 128000"
                value={newCtx}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCtx(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button
                className={cn('h-7.5 shrink-0 px-3 text-xs')}
                variant="default"
                size="sm"
                onClick={handleAddModel}
                // 添加不依赖查询状态（查询仅是提示，不再锁按钮）
                disabled={!newModel.trim()}
                type="button"
              >
                <Plus size={13} strokeWidth={2} /> 添加
              </Button>
            </div>
            {addSuccess ? (
              <p className={cn('text-[11px] mt-1.5 font-medium text-emerald-600')}>{addSuccess}</p>
            ) : (
              modelHint && (
                <p className={cn('text-[11px] mt-0.5', modelHint.startsWith('✓') ? 'text-emerald-600' : 'text-muted-foreground')}>
                  {modelLooking ? '查询中…' : modelHint}
                </p>
              )
            )}
          </div>

          {/* 删除按钮 + 保存按钮（🔴 2026-08-10 统一尺寸） */}
          <div className={cn('flex items-center justify-between pt-3 border-t border-border/60')}>
            <Button
              variant="destructive"
              size="sm"
              className={cn('h-7.5 px-3 text-xs')}
              onClick={() => onDelete(provider.id)}
              type="button"
            >
              <Trash2 size={13} strokeWidth={1.5} />
              删除厂商
            </Button>
            <Button
              variant="default"
              size="sm"
              className={cn('h-7.5 px-4 text-xs')}
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
