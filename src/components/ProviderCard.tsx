import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff, Trash2, Plus, X, KeyRound, Globe, Cpu, Check, ChevronDown, Bot, Sparkles, Code2, Cloud } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { lookupModelCapabilities, testProviderConnection } from '@/utils/settings-store';
import { selectCls } from '@/lib/ui-styles';
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
  /** 🔴 P-3：preset 卡禁删（对齐 Hermes direct-config 来源端点不可删） */
  deleteDisabled?: boolean;
  /** 🔴 G-5：断开 API Key（provider.disconnect → Credential::None） */
  onDisconnect?: (id: string) => void;
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
  deleteDisabled = false,
  onDisconnect,
}: ProviderCardProps) {
  const [newModel, setNewModel] = useState('');
  const [newCtx, setNewCtx] = useState('');
  const [modelHint, setModelHint] = useState<string | null>(null);
  const [modelLooking, setModelLooking] = useState(false);
  // 🔴 2026-08-10：添加成功后的明显提示（独立于查询 hint，防 debounce 覆盖）
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  // 🔴 G-1/G-2：测试连接（对齐 Hermes validateCustomEndpoint Test 按钮）
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

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

  // 🔴 2026-08-16（R1 修复）：添加模型即时落池——await onAddModel（内部先 upsert 池），
  // 成功才清输入并提示；失败保留输入可重试（不再有"点底部保存才生效"的中间态）。
  const handleAddModel = async () => {
    const name = newModel.trim();
    if (!name) return;
    if (provider.models.some(m => m.name === name)) {
      setModelHint('⚠ 该模型已在列表中');
      return;
    }
    const ctx = parseInt(newCtx, 10);
    try {
      await onAddModel(provider.id, {
        name,
        // 🔴 2026-08-10 修：留空不再强制 128000（显示 "—" 表示未知/未配置，
        // 运行时上下文由 eleve_model 独立解析链兜底，池值仅信息性展示）
        context_length: Number.isFinite(ctx) && ctx > 0 ? ctx : 0,
        // UI 不暴露输出字段（老大 2026-08-10）：后端保留默认 16384
        max_output: 16384,
      });
      setNewModel('');
      setNewCtx('');
      setModelHint(null);
      // 🔴 R1：即时落池，无需再点底部保存
      setAddSuccess(`✓ 已添加「${name}」`);
      setTimeout(() => setAddSuccess(null), 3000);
    } catch {
      setModelHint('⚠ 保存失败，请重试');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddModel();
  };

  // 🔴 G-1/G-2：测试端点连通性 + 发现模型（对齐 Hermes validateCustomEndpoint）
  // 用当前卡片 baseUrl + 已输入 apiKey 探测 {base_url}/models；成功 → 发现模型
  // 合并进模型列表（ctx=0 未知，可再经 models.dev 或手填）。
  const handleTest = async () => {
    const baseUrl = (provider.baseUrl || '').trim();
    if (!baseUrl) {
      setTestResult({ ok: false, text: '请先填写 Base URL' });
      return;
    }
    setTesting(true);
    try {
      const res = await testProviderConnection(baseUrl, (provider.apiKey || '').trim() || undefined);
      if (res.ok) {
        let added = 0;
        // 🔴 R1：测试发现的模型即时落池（await 串行 upsert；单模型失败跳过不阻塞整体）
        for (const m of res.models) {
          if (!provider.models.some(x => x.name === m)) {
            try {
              await onAddModel(provider.id, { name: m, context_length: 0, max_output: 16384 });
              added++;
            } catch { /* 单个模型落池失败跳过 */ }
          }
        }
        setTestResult({
          ok: true,
          text: res.models.length > 0
            ? `✓ 端点可达，发现 ${res.models.length} 个模型（新增 ${added} 个）`
            : '✓ 端点可达（未发现模型目录）',
        });
      } else {
        setTestResult({ ok: false, text: res.message });
      }
    } catch {
      setTestResult({ ok: false, text: '测试失败（网络异常）' });
    } finally {
      setTesting(false);
    }
  };

  // ── 协议类型 → 图标色块（卡片头部视觉锚点）──
  const { Icon: TransportIcon, bg: iconBg, color: iconColor } = (() => {
    switch (provider.transport) {
      case 'openai_chat': return { Icon: Bot, bg: 'bg-emerald-500/10', color: 'text-emerald-500' };
      case 'anthropic_messages': return { Icon: Sparkles, bg: 'bg-orange-500/10', color: 'text-orange-500' };
      case 'codex_responses': return { Icon: Code2, bg: 'bg-blue-500/10', color: 'text-blue-500' };
      default: return { Icon: Cloud, bg: 'bg-slate-500/10', color: 'text-slate-500' };
    }
  })();

  return (
    <div className={cn('border border-border rounded-xl bg-card overflow-hidden transition-all hover:border-border/80', expanded && 'sm:col-span-2')}>
      {/* ── 卡片头部（紧凑卡片，非长条）── */}
      <button
        className={cn('flex items-center justify-between w-full px-3.5 py-3 gap-3 cursor-pointer bg-transparent border-none text-left hover:bg-muted/30 transition-colors')}
        onClick={onToggle}
        type="button"
      >
        <div className={cn('flex items-center gap-3 min-w-0')}>
          {/* 协议图标块 */}
          <span className={cn('size-9 shrink-0 rounded-lg grid place-items-center', iconBg)}>
            <TransportIcon size={16} strokeWidth={1.8} className={iconColor} />
          </span>
          <div className={cn('min-w-0')}>
            <div className={cn('flex items-center gap-1.5 min-w-0')}>
              <span className={cn('text-sm font-semibold text-foreground truncate')}>{provider.name}</span>
              {/* 来源徽章 */}
              {provider.source === 'global_pool' && (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0 font-medium')}>池</span>
              )}
              {provider.source === 'preset' && (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0 font-medium')}>预设</span>
              )}
            </div>
            <div className={cn('text-[10px] font-mono text-muted-foreground/60 truncate')}>{provider.id}</div>
          </div>
        </div>
        <div className={cn('flex items-center gap-1.5 shrink-0')}>
          {/* 模型数徽章 */}
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full bg-muted/70 text-muted-foreground font-medium')}>
            {provider.models.length} 模型
          </span>
          {/* Key 状态徽章 */}
          {provider.hasKey !== undefined && (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium',
              provider.hasKey ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'
            )}>
              {provider.hasKey ? '已配 Key' : '未配 Key'}
            </span>
          )}
          <ChevronDown size={15} className={cn('text-muted-foreground transition-transform', expanded && 'rotate-180')} />
        </div>
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
                // 🔴 2026-08-21：后端脱敏不返回明文 key——已配 Key 的 provider 显示掩码占位
                // （非空白，用户一眼可见"已配置"）；保存时 isPlaceholder 跳过掩码不覆盖后端凭证。
                value={provider.hasKey && !provider.apiKey ? 'sk-••••••••' : (provider.apiKey || '')}
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

          {/* Base URL + 测试连接（🔴 G-1：对齐 Hermes Test 按钮 — 探测可达性/凭证/发现模型） */}
          <div className={cn('grid gap-1.5')}>
            <label className={cn('flex items-center gap-1.5 text-xs text-muted-foreground')}>
              <Globe size={12} strokeWidth={1.5} /> Base URL
            </label>
            <div className={cn('flex items-center gap-1')}>
              <Input
                type="text"
                className={cn('h-7.5 text-xs flex-1')}
                value={provider.baseUrl || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate(provider.id, 'baseUrl', e.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <Button
                variant="outline"
                size="sm"
                className={cn('h-7.5 shrink-0 px-3 text-xs')}
                onClick={() => void handleTest()}
                disabled={testing}
                type="button"
                title="测试端点连通性 + 发现模型目录"
              >
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
            {testResult && (
              <p className={cn('text-[11px]', testResult.ok ? 'text-emerald-600' : 'text-destructive')}>
                {testResult.text}
              </p>
            )}
          </div>

          {/* 协议/传输方式 */}
          <div className={cn('grid gap-1.5')}>
            <label className={cn('flex items-center gap-1.5 text-xs text-muted-foreground')}>
              <Cpu size={12} strokeWidth={1.5} /> 协议
            </label>
            <select
              className={selectCls}
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
                    <span className={cn('shrink-0 rounded-md bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary')} title={m.context_length > 0 ? `上下文窗口 ${m.context_length} tokens` : '上下文大小未配置（留空时运行时自动探测）'}>
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
                placeholder="上下文大小"
                title="上下文窗口大小（tokens），留空=未知（运行时自动探测）"
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

          {/* 删除按钮 + 保存按钮（🔴 2026-08-10 统一：组件默认高 + min-w 等宽 + 双图标） */}
          <div className={cn('flex items-center justify-between pt-3 border-t border-border/60')}>
            <div className={cn('flex items-center gap-2')}>
              {/* 🔴 P-3：preset 卡禁删（对齐 Hermes direct-config 来源端点隐藏删除按钮）——
                  预设未入池时删除是假删（重开面板复活），需先保存入池才可删 */}
              {!deleteDisabled && (
                <Button
                  variant="destructive"
                  size="sm"
                  className={cn('min-w-24 text-xs')}
                  onClick={() => onDelete(provider.id)}
                  type="button"
                >
                  <Trash2 size={13} strokeWidth={1.5} />
                  删除厂商
                </Button>
              )}
              {deleteDisabled && provider.source === 'preset' && (
                <span className={cn('text-[11px] text-muted-foreground/60')}>预设厂商：保存后入池即可删除</span>
              )}
              {/* 🔴 G-5：断开 API Key（对齐 Hermes 编辑留空 key = 清除语义，ELEVE 用显式断开按钮） */}
              {onDisconnect && provider.hasKey && provider.credentialType !== 'none' && (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn('min-w-24 text-xs')}
                  onClick={() => onDisconnect(provider.id)}
                  type="button"
                >
                  <KeyRound size={13} strokeWidth={1.5} />
                  断开 Key
                </Button>
              )}
            </div>
            <Button
              variant="default"
              size="sm"
              className={cn('min-w-24 text-xs')}
              onClick={onSave}
              type="button"
            >
              <Check size={13} strokeWidth={2} />
              保存
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
