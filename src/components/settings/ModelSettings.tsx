import { useState, useEffect, useCallback } from 'react';
import { Plus, X, GitBranch, Cog, Users, AlertTriangle, GitMerge, Image as ImageIcon, Check, ChevronDown, Trash2, Clapperboard, Music } from 'lucide-react';
import { AUX_TASKS, getProviderModels, lookupModelCapabilities, getToolsetModels, selectToolsetModel } from '../../utils/settings-store';
import type { AuxTaskEntry, ToolsetModelsResponse, ToolsetModelEntry } from '../../utils/settings-store';
import type { ProviderEntry } from '../../utils/settings-store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { REASONING_EFFORTS } from '../../lib/reasoning-efforts';
import { selectCls } from '../../lib/ui-styles';
import { SectionCard } from './SettingBlocks';
import { notifySuccess, notifyError } from '../../utils/notifications';

// 🔴 G-4：MoA 配置类型（对齐后端 MoaConfig / MoaPresetConfig / MoaSlotConfig）
interface MoaSlot {
  model_ref?: string;
  provider: string;
  model: string;
  /** 是否参与参考（对齐 Hermes slot.enabled；false = 跳过该槽） */
  enabled?: boolean;
}
interface MoaPreset {
  enabled?: boolean;
  reference_models: MoaSlot[];
  aggregator: MoaSlot;
  reference_temperature?: number;
  aggregator_temperature?: number;
}
interface MoaConfigShape {
  save_traces?: boolean;
  default_preset?: string;
  presets: Record<string, MoaPreset>;
  [key: string]: unknown;
}

/** 槽位 model_ref 同步（🔴 运行时权威 = model_ref（moa_loop resolve_slot_effective 优先），
 *  UI 编辑 provider/model 后必须重算 ref，否则改动不生效） */
function syncSlotRefs(slot: MoaSlot): MoaSlot {
  const ref = slot.provider && slot.model ? `${slot.provider}/${slot.model}` : undefined;
  return { ...slot, model_ref: ref };
}

function syncPresetRefs(p: MoaPreset): MoaPreset {
  return {
    ...p,
    reference_models: p.reference_models.map(syncSlotRefs),
    aggregator: syncSlotRefs(p.aggregator),
  };
}


/**
 * ModelSettings — main model, fallback chain, auxiliary tasks, delegation
 *
 * All model-related configuration extracted from the original SettingsPanel.
 *
 * 🔴 2026-08-10 UI 重构 v2：5 个区块改为顶部 Tab 切换（不再折叠菜单）——
 *  Fallback 链 → 表格行 / 辅助任务 → 双列网格卡 / 子 Agent → 单行三列 /
 *  MoA → 槽位行网格化 / 图像生成 → 模型卡片墙（对齐 Hermes toolset 模型目录）。
 */
export default function ModelSettings({
  // Fallback
  fallbackList, addFallback, removeFallback, updateFallback,
  // Auxiliary
  auxConfig, updateAux,
  // Delegation
  delProvider, setDelProvider, delModel, setDelModel, delMaxIterations, setDelMaxIterations,
  // Shared data
  providers, providerOptions,
  // 🔴 G-3: stale aux 警告（对齐 Hermes StaleAuxWarning）
  staleAuxSlots, onResetStaleAux,
  // 🔴 G-4: MoA 配置
  moaConfig, setMoaConfig,
  // 🔴 2026-08-10 MoA 即时落盘（对齐 Hermes saveMoa；不依赖底部保存按钮）
  onSaveMoa,
}: {
  fallbackList: Array<{ providerId: string; model: string; reasoningEffort?: string | null }>;
  addFallback: () => void;
  removeFallback: (i: number) => void;
  updateFallback: (i: number, f: string, v: string | null) => void;
  auxConfig: Record<string, { providerId: string; model: string; timeout: number; downloadTimeout?: number; reasoningEffort?: string | null }>;
  updateAux: (key: string, field: string, value: string | number | null) => void;
  delProvider: string;
  setDelProvider: (v: string) => void;
  delModel: string;
  setDelModel: (v: string) => void;
  delMaxIterations: number;
  setDelMaxIterations: (v: number) => void;
  providers: ProviderEntry[];
  providerOptions: Array<{ value: string; label: string }>;
  staleAuxSlots: Array<{ task: string; provider: string; model: string }>;
  onResetStaleAux: () => void;
  moaConfig: Record<string, unknown> | null;
  setMoaConfig: (v: Record<string, unknown> | null) => void;
  /** MoA 变更即时落盘（update_config 加性写 moa 段） */
  onSaveMoa: (moa: Record<string, unknown>) => void;
}) {
  // 🔴 2026-08-10 v2：5 区块 Tab 切换（替代折叠菜单）
  const TABS = [
    { key: 'fallback', label: 'Fallback 链', icon: GitBranch },
    { key: 'aux', label: '辅助任务', icon: Cog },
    { key: 'delegation', label: '子 Agent', icon: Users },
    { key: 'moa', label: 'MoA', icon: GitMerge },
    { key: 'image', label: '媒体生成', icon: ImageIcon },
  ] as const;
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('fallback');

  // 🔴 图像生成（对齐 Hermes ModelCatalogPicker：后端目录 + 点击即存）
  const [imageGen, setImageGen] = useState<ToolsetModelsResponse | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageSaving, setImageSaving] = useState<string | null>(null);
  // 空态自定义创建展开态
  const [showCustomCreate, setShowCustomCreate] = useState(false);
  // 编辑大卡片折叠态（创建预设后的大卡片可收起）
  const [moaCollapsed, setMoaCollapsed] = useState(false);
  // 删除预设确认弹窗
  const [moaDeleteConfirm, setMoaDeleteConfirm] = useState(false);

  const loadImageGen = useCallback(async () => {
    setImageLoading(true);
    const res = await getToolsetModels('image_gen');
    if (res) setImageGen(res);
    setImageLoading(false);
  }, []);

  // 切到图像生成 tab 时加载目录（Hermes 同：进入区块才拉取）
  useEffect(() => {
    if (tab === 'image') void loadImageGen();
  }, [tab, loadImageGen]);

  const pickImageModel = useCallback(async (modelId: string) => {
    setImageSaving(modelId);
    try {
      await selectToolsetModel('image_gen', modelId);
      setImageGen(prev => (prev ? { ...prev, current: modelId } : prev));
      const display = imageGen?.models.find(m => m.id === modelId)?.display || modelId;
      notifySuccess(`图像生成模型已切换：${display}`);
    } catch (e) {
      notifyError(e, '切换失败');
    } finally {
      setImageSaving(null);
    }
  }, [imageGen]);

  const delModels = getProviderModels(providers, delProvider);

  // 🔴 2026-08-10 按模型能力门控思考深度（对齐 Hermes mainCaps.reasoning ?? true）：
  //   单一缓存 capsCache（key = `${provider}/${model}`），aux 任务 + Fallback 行共用，
  //   同模型只查一次；reasoning=false → 禁用（透传不生效）；未知/查询失败 → 不禁用
  //   （Hermes ?? true 语义）。模型变化自动重查。
  const [capsCache, setCapsCache] = useState<Record<string, { reasoning?: boolean }>>({});

  useEffect(() => {
    let cancelled = false;
    const queries: Array<[string, string]> = [];
    // aux 任务（provider 非 auto 且已选模型）
    for (const t of AUX_TASKS.filter((x: AuxTaskEntry) => !x.deprecated)) {
      const p = auxConfig[t.key]?.providerId?.trim();
      const m = auxConfig[t.key]?.model?.trim();
      if (p && p !== 'auto' && m) queries.push([p, m]);
    }
    // Fallback 行
    for (const fb of fallbackList) {
      const p = fb.providerId?.trim();
      const m = fb.model?.trim();
      if (p && m) queries.push([p, m]);
    }
    // 按模型去重后查询
    const seen = new Set<string>();
    for (const [p, m] of queries) {
      const key = `${p}/${m}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lookupModelCapabilities(p, m)
        .then((caps) => {
          if (cancelled || !caps || typeof caps.reasoning !== 'boolean') return;
          setCapsCache(prev => ({ ...prev, [key]: { reasoning: caps.reasoning as boolean } }));
        })
        .catch(() => { /* 查询失败 → 不禁用（Hermes ?? true 语义） */ });
    }
    return () => { cancelled = true; };
  }, [auxConfig, fallbackList]);

  // 🔴 G-4：MoA 本地状态（当前编辑 preset + 新建 preset 名）
  const moa = moaConfig as unknown as MoaConfigShape | null;
  const [moaPresetName, setMoaPresetName] = useState('');
  const [newMoaPreset, setNewMoaPreset] = useState('');
  const moaPresets = moa?.presets || {};
  const currentMoaPresetName = moaPresetName || moa?.default_preset || Object.keys(moaPresets)[0] || '';
  const currentMoaPreset = moaPresets[currentMoaPresetName];
  // 防递归：MoA 槽位禁用 moa 虚拟 provider（对齐 Hermes moaSlotProviderOptions）
  const moaSlotProviderOptions = providerOptions.filter(op => op.value !== 'moa');

  const updateMoaPreset = (updater: (p: MoaPreset) => MoaPreset) => {
    if (!moa || !currentMoaPresetName || !currentMoaPreset) return;
    const next: MoaConfigShape = {
      ...moa,
      presets: {
        ...moaPresets,
        [currentMoaPresetName]: syncPresetRefs(updater(currentMoaPreset)),
      },
    };
    setMoaConfig(next as Record<string, unknown>);
    // 🔴 2026-08-10 即时落盘（对齐 Hermes saveMoa）：MoA 不依赖底部保存按钮
    onSaveMoa(next as Record<string, unknown>);
  };

  const updateMoaSlot = (slot: MoaSlot, patch: Partial<MoaSlot>): MoaSlot => {
    const next = { ...slot, ...patch };
    // 换 provider 清 model（对齐 Hermes updateMoaSlot）
    if (patch.provider && patch.provider !== slot.provider) next.model = '';
    return next;
  };

  const saveMoaPresets = (next: MoaConfigShape) => {
    // 全量同步槽位 ref（default_preset/增删等操作路径也保证 ref 一致）
    const synced: MoaConfigShape = {
      ...next,
      presets: Object.fromEntries(
        Object.entries(next.presets).map(([name, p]) => [name, syncPresetRefs(p)])
      ),
    };
    setMoaConfig(synced as Record<string, unknown>);
    // 🔴 2026-08-10 即时落盘（对齐 Hermes saveMoa）：MoA 不依赖底部保存按钮
    onSaveMoa(synced as Record<string, unknown>);
  };

  // 🔴 2026-08-10 修复：空态下创建首个预设（原实现把整个工具栏藏了 = 死胡同，
  //    用户无法创建第一个 MoA 预设）。工具栏与空态共用同一创建逻辑。
  const createMoaPreset = useCallback(() => {
    const name = newMoaPreset.trim();
    if (!name || !!moaPresets[name]) return;
    saveMoaPresets({
      ...(moa || {}),
      presets: {
        ...moaPresets,
        [name]: {
          enabled: true,
          reference_models: [...(currentMoaPreset?.reference_models || [])],
          aggregator: { ...(currentMoaPreset?.aggregator || { provider: '', model: '' }) },
        },
      },
    } as MoaConfigShape);
    setMoaPresetName(name);
    setNewMoaPreset('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newMoaPreset, moaPresets, moa, currentMoaPreset]);

  return (
    <div>
      {/* 🔴 G-3: stale aux 警告（对齐 Hermes StaleAuxWarning —
          aux 仍 pin 到非主 provider 时提示，防后台调用静默打旧 provider） */}
      {staleAuxSlots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning mb-3">
          <AlertTriangle size={13} strokeWidth={1.5} className="shrink-0" />
          <span className="grow">
            {staleAuxSlots.length} 个辅助任务（{staleAuxSlots.map(s => AUX_TASKS.find(t => t.key === s.task)?.label || s.task).join('、')}）
            仍运行在 <span className="font-mono">{staleAuxSlots[0].provider}</span>，不是当前主模型。
          </span>
          <Button variant="outline" size="sm" onClick={onResetStaleAux}>全部重置为主模型</Button>
        </div>
      )}

      {/* Tab 切换条（分段控件风格：容器内浮起选中卡） */}
      <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-1 mb-4">
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer border-none ${
                active
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-[var(--ui-stroke-tertiary)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
              onClick={() => setTab(t.key)}
            >
              <t.icon size={13} strokeWidth={1.5} className={active ? 'text-primary' : ''} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ══════════ Fallback 链（表格化） ══════════ */}
      {tab === 'fallback' && (
        <div className="space-y-2.5 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">主模型不可用时自动切换的备用链路，按顺序尝试。</p>
          <div className="border border-[var(--ui-stroke-tertiary)] rounded-xl overflow-hidden bg-card">
            {/* 表头 */}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 px-3 py-1.5 bg-muted/40 text-[11px] text-muted-foreground font-medium">
              <span>提供商</span>
              <span>模型</span>
              <span>思考深度</span>
              <span />
            </div>
            {fallbackList.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground/60 text-center border-t border-[var(--ui-stroke-quaternary)]">
                暂无备用链路。主模型不可用时不会自动切换。
                点击下方「添加备用链路」，从已配置的模型中选择替代。
              </div>
            ) : (
              fallbackList.map((fb: { providerId: string; model: string; reasoningEffort?: string | null }, idx: number) => {
                // 思考深度门控（渲染层校验，防缓存残留误禁用）
                const fbProvider = fb.providerId?.trim() || '';
                const fbModel = fb.model?.trim() || '';
                const fbUnsupported =
                  capsCache[`${fbProvider}/${fbModel}`]?.reasoning === false && !!fbProvider && !!fbModel;
                return (
                <div
                  key={idx}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 px-3 py-2 items-center border-t border-[var(--ui-stroke-quaternary)] first:border-t-0 group/row"
                >
                  <select
                    className={selectCls}
                    value={fb.providerId}
                    onChange={e => updateFallback(idx, 'providerId', e.target.value)}
                  >
                    <option value="">选择提供商</option>
                    {providerOptions.map((op: { value: string; label: string }) => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>
                  <select
                    className={selectCls}
                    value={fb.model}
                    onChange={e => updateFallback(idx, 'model', e.target.value)}
                    disabled={!fb.providerId}
                  >
                    <option value="">选择模型</option>
                    {getProviderModels(providers, fb.providerId).map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select
                    className={selectCls}
                    value={fb.reasoningEffort || ''}
                    onChange={e => updateFallback(idx, 'reasoningEffort', e.target.value || null)}
                    disabled={fbUnsupported}
                    title={fbUnsupported ? '该模型不支持思考模式，此设置不会生效' : undefined}
                  >
                    <option value="">跟随模型默认</option>
                    {REASONING_EFFORTS.map(ef => <option key={ef.value} value={ef.value}>{ef.label}</option>)}
                  </select>
                  <button
                    type="button"
                    className="grid place-items-center size-8 rounded-md text-muted-foreground/50 opacity-0 group-hover/row:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all bg-transparent border-none cursor-pointer"
                    onClick={() => removeFallback(idx)}
                    title="移除该备用链路"
                  >
                    <X size={14} />
                  </button>
                </div>
                );
              })
            )}
          </div>
          <button
            className="w-full mt-1.5 inline-flex items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--ui-stroke-tertiary)]text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-accent/30 transition-colors py-2 text-xs font-medium cursor-pointer bg-transparent"
            onClick={addFallback}
          >
            <Plus size={14} strokeWidth={2} /> 添加备用链路
          </button>
        </div>
      )}

      {/* ══════════ Auxiliary 任务（双列网格卡） ══════════ */}
      {/* ══════════ 辅助任务（双列网格卡） ══════════ */}
      {tab === 'aux' && (
        <div className="space-y-2.5 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">非对话类辅助任务使用的模型配置。</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {AUX_TASKS.filter((t: AuxTaskEntry) => !t.deprecated).map((t: AuxTaskEntry) => {
              // 按模型能力门控（渲染层再校验一次，防缓存残留误禁用）
              const auxProvider = auxConfig[t.key]?.providerId?.trim();
              const auxModel = auxConfig[t.key]?.model?.trim();
              const reasoningUnsupported =
                capsCache[`${auxProvider}/${auxModel}`]?.reasoning === false && !!auxProvider && auxProvider !== 'auto' && !!auxModel;
              return (
              <div key={t.key} className="border border-[var(--ui-stroke-tertiary)] rounded-xl p-3 bg-card space-y-2 min-w-0">
                <div className="text-xs font-medium text-foreground truncate" title={t.label}>{t.label}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1 min-w-0">
                    <label className="block text-[11px] text-muted-foreground">提供商</label>
                    <select
                      className={selectCls}
                      value={auxConfig[t.key]?.providerId || 'auto'}
                      onChange={e => updateAux(t.key, 'providerId', e.target.value)}
                    >
                      <option value="auto">auto（跟随主模型）</option>
                      {providerOptions.map((op: { value: string; label: string }) => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                  </div>
                  <div className="grid gap-1 min-w-0">
                    <label className="block text-[11px] text-muted-foreground">模型</label>
                    <select
                      className={selectCls}
                      value={auxConfig[t.key]?.model || ''}
                      onChange={e => updateAux(t.key, 'model', e.target.value)}
                      disabled={!auxConfig[t.key]?.providerId || auxConfig[t.key]?.providerId === 'auto'}
                    >
                      <option value="">跟随 Provider 默认</option>
                      {getProviderModels(providers, auxConfig[t.key]?.providerId).map((m: string) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1 min-w-0">
                    <label className="block text-[11px] text-muted-foreground">超时（秒）</label>
                    <Input type="number" className="h-8 text-xs w-full" value={auxConfig[t.key]?.timeout ?? t.defaultTimeout}
                      min={5} max={3600}
                      onChange={e => updateAux(t.key, 'timeout', Math.min(3600, Math.max(5, parseInt(e.target.value) || t.defaultTimeout)))} />
                  </div>
                  <div className="grid gap-1 min-w-0">
                    <label className="block text-[11px] text-muted-foreground">思考深度</label>
                    <select
                      className={selectCls}
                      value={(auxConfig[t.key]?.reasoningEffort as string) || ''}
                      onChange={e => updateAux(t.key, 'reasoningEffort', e.target.value || null)}
                      disabled={reasoningUnsupported}
                    >
                      <option value="">跟随模型默认</option>
                      {REASONING_EFFORTS.map(ef => <option key={ef.value} value={ef.value}>{ef.label}</option>)}
                    </select>
                    {reasoningUnsupported && (
                      <p className="text-[10px] leading-snug text-warning/80">该模型不支持思考模式，此设置不会生效</p>
                    )}
                  </div>
                  {/* 🔴 温度不在面板暴露（对齐 Hermes：aux temperature 各任务类型有默认值，
                      高级用户 config.yaml 手写；raw patch 保留手写值不抹掉） */}
                  {t.hasDownloadTimeout && (
                    <div className="grid gap-1 min-w-0 col-span-2">
                      <label className="block text-[11px] text-muted-foreground">下载超时（秒）</label>
                      <Input type="number" className="h-8 text-xs w-full" value={auxConfig[t.key]?.downloadTimeout ?? 30}
                        min={5} max={300}
                        onChange={e => updateAux(t.key, 'downloadTimeout', Math.min(300, Math.max(5, parseInt(e.target.value) || 30)))} />
                    </div>
                  )}
                </div>
                {/* 🔴 2026-08-10 移除 Extra Body 裸 JSON 输入框（反用户设计）：
                    对齐 Hermes——aux 高级字段（extra_body/base_url/api_key/language 等）
                    config.yaml 手写，面板不暴露；保存时 raw patch 保留手写值不抹掉 */}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════ 子 Agent 委派（单行三列） ══════════ */}
      {/* ══════════ 子 Agent 委派（单行三列） ══════════ */}
      {tab === 'delegation' && (
        <div className="space-y-2.5 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">子 Agent 执行委派任务时使用的模型与参数。</p>
          <div className="border border-[var(--ui-stroke-tertiary)] rounded-xl p-3 bg-card grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1 min-w-0">
              <label className="block text-[11px] text-muted-foreground">提供商</label>
              <select
                className={selectCls}
                value={delProvider} onChange={e => { setDelProvider(e.target.value); setDelModel(''); }}
              >
                <option value="">跟随主模型</option>
                {providerOptions.map((op: { value: string; label: string }) => <option key={op.value} value={op.value}>{op.label}</option>)}
              </select>
            </div>
            <div className="grid gap-1 min-w-0">
              <label className="block text-[11px] text-muted-foreground">模型</label>
              <select
                className={selectCls}
                value={delModel} onChange={e => setDelModel(e.target.value)} disabled={!delProvider}
              >
                <option value="">选择模型</option>
                {delModels.map((m: string) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="grid gap-1 min-w-0">
              <label className="block text-[11px] text-muted-foreground">最大迭代次数</label>
              <Input type="number" className="h-8 text-xs w-full" value={delMaxIterations} min="5" max="200"
                onChange={e => setDelMaxIterations(parseInt(e.target.value) || 30)} />
            </div>
          </div>
        </div>
      )}

      {/* ══════════ 🔴 G-4: Mixture of Agents（对齐 Hermes model-settings MoA 区块） ══════════ */}
      {/* ══════════ Mixture of Agents ══════════ */}
      {tab === 'moa' && (
        <div className="space-y-2.5 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            多模型协作：多个「参考模型」并行思考同一个问题（顾问角色，不执行工具），再由「聚合器」综合所有回答输出最终回复（执行模型）。
            一套组合就是一个预设，预设会以模型形式出现在模型列表，可配置多套随时切换。
          </p>
          {!moa || Object.keys(moaPresets).length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed border-[var(--ui-stroke-tertiary)]p-4">
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                还没有 MoA 预设。创建默认预设（参考：qwen3.7-plus + deepseek-v4-pro，聚合器：qwen3.7-plus），创建后可自由编辑；或自定义创建空预设。
              </p>
              <div className="flex flex-col items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm" className="min-w-28"
                    disabled={!!moaPresets['default']}
                    onClick={() => {
                      saveMoaPresets({
                        ...(moa || {}),
                        default_preset: 'default',
                        presets: {
                          ...moaPresets,
                          default: {
                            enabled: true,
                            reference_models: [
                              { provider: 'aliyun-bailian', model: 'qwen3.7-plus', enabled: true },
                              { provider: 'deepseek', model: 'deepseek-v4-pro', enabled: true },
                            ],
                            aggregator: { provider: 'aliyun-bailian', model: 'qwen3.7-plus', enabled: true },
                          },
                        },
                      });
                      setMoaPresetName('default');
                      notifySuccess('默认预设已创建，可继续编辑');
                    }}
                  >
                    <Plus size={13} strokeWidth={1.5} /> 默认预设
                  </Button>
                  <Button
                    variant="outline" size="sm" className="min-w-28"
                    onClick={() => setShowCustomCreate(v => !v)}
                  >
                    {showCustomCreate ? '收起' : (<><Plus size={13} strokeWidth={1.5} /> 自定义</>)}
                  </Button>
                </div>
                {showCustomCreate && (
                  <div className="flex items-center gap-2 w-full max-w-xs">
                    <Input
                      className="h-8 text-xs flex-1"
                      placeholder="预设名称（如：团队协作）"
                      value={newMoaPreset}
                      onChange={e => setNewMoaPreset(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newMoaPreset.trim()) {
                          createMoaPreset();
                          setShowCustomCreate(false);
                        }
                      }}
                    />
                    <Button
                      variant="default" size="sm"
                      disabled={!newMoaPreset.trim()}
                      onClick={() => {
                        createMoaPreset();
                        setShowCustomCreate(false);
                      }}
                    >
                      创建
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* 预设切换行：下拉选中的即当前生效预设（自定义菜单 + 跑马灯，醒目） */}
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 h-9 w-56 rounded-lg border border-primary/30 bg-transparent px-2.5 text-xs font-medium text-foreground hover:bg-primary/10 transition-colors cursor-pointer"
                    >
                      <GitMerge size={14} className="text-primary shrink-0" />
                      <span className="flex-1 text-left truncate">{currentMoaPresetName}</span>
                      <ChevronDown size={14} className="shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="start" className="w-56 min-w-0">
                    <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground/70">
                      当前预设
                    </DropdownMenuLabel>
                    {Object.keys(moaPresets).map(name => {
                      const active = name === currentMoaPresetName;
                      return (
                        <DropdownMenuItem
                          key={name}
                          onSelect={() => {
                            // 选择即生效：同步为默认预设并确保启用
                            setMoaPresetName(name);
                            if (moa && moaPresets[name]) {
                              saveMoaPresets({
                                ...moa,
                                default_preset: name,
                                presets: {
                                  ...moaPresets,
                                  [name]: { ...moaPresets[name], enabled: true },
                                },
                              });
                            }
                          }}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                            active ? 'border-primary bg-primary/5 font-medium text-foreground' : 'border-transparent text-muted-foreground'
                          }`}
                        >
                          <span className="truncate">{name}</span>
                          {active && <Check size={13} className="shrink-0 text-primary" />}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost" size="sm"
                  disabled={Object.keys(moaPresets).length <= 1}
                  onClick={() => setMoaDeleteConfirm(true)}
                  title="删除当前预设"
                >
                  <Trash2 size={13} /> 删除预设
                </Button>
              </div>

              {/* 可折叠大卡片（参考模型 + 聚合器；折叠头 = 卡片 header，一体无缝隙） */}
              <div className="rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/30 cursor-pointer transition-colors bg-transparent border-none"
                onClick={() => setMoaCollapsed(v => !v)}
              >
                <ChevronDown size={14} className={`transition-transform shrink-0 ${moaCollapsed ? '-rotate-90' : ''}`} />
                <span className="font-mono">{currentMoaPresetName}</span>
                <span className="text-[10px] text-muted-foreground/60 font-normal">MoA 预设配置</span>
              </button>
              {!moaCollapsed && (
              <div className="border-t border-[var(--ui-stroke-tertiary)] p-3 space-y-3">
              {/* 参考模型槽：并行思考的组员，可多个 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">参考模型</p>
                <p className="text-[11px] text-muted-foreground/60 -mt-1.5">并行思考的模型，可添加多个；各自独立回答，互不干扰。</p>
                <div className="space-y-1.5">
                  {currentMoaPreset.reference_models.map((slot, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card px-3 py-2 ${slot.enabled === false ? 'opacity-60' : ''}`}
                    >
                      {/* 行头：标题 + 启用开关（对齐 Hermes ListRow action） */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">参考 #{idx + 1}</span>
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                          启用
                          <Switch
                            checked={slot.enabled !== false}
                            onCheckedChange={checked => updateMoaPreset(prev => ({
                              ...prev,
                              reference_models: prev.reference_models.map((s, i) =>
                                i === idx ? { ...s, enabled: checked } : s
                              ),
                            }))}
                          />
                        </label>
                      </div>
                      {/* mono 描述（对齐 Hermes ListRow description） */}
                      <div className="text-[10px] font-mono text-muted-foreground/60 truncate mt-0.5">
                        {slot.provider ? `${slot.provider} · ${slot.model || '未选择模型'}` : '未配置提供商与模型'}
                      </div>
                      {/* below：下拉编辑区（对齐 Hermes ListRow below） */}
                      <div className="flex flex-wrap items-center gap-2 mt-2 pt-1">
                        <select
                          className="flex h-8 flex-1 min-w-28 items-center rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground shadow-xs outline-none min-w-0"
                          value={slot.provider}
                          onChange={e => updateMoaPreset(prev => ({
                            ...prev,
                            reference_models: prev.reference_models.map((s, i) =>
                              i === idx ? updateMoaSlot(s, { provider: e.target.value }) : s
                            ),
                          }))}
                        >
                          <option value="">选择提供商</option>
                          {moaSlotProviderOptions.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                        </select>
                        <select
                          className="flex h-8 flex-1 min-w-36 items-center rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground shadow-xs outline-none disabled:opacity-50 min-w-0"
                          value={slot.model}
                          disabled={!slot.provider}
                          onChange={e => updateMoaPreset(prev => ({
                            ...prev,
                            reference_models: prev.reference_models.map((s, i) =>
                              i === idx ? updateMoaSlot(s, { model: e.target.value }) : s
                            ),
                          }))}
                        >
                          <option value="">选择模型</option>
                          {getProviderModels(providers, slot.provider).map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <button
                          type="button"
                          className="grid place-items-center size-8 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors bg-transparent border-none cursor-pointer shrink-0"
                          disabled={currentMoaPreset.reference_models.length <= 1}
                          onClick={() => updateMoaPreset(prev => ({
                            ...prev,
                            reference_models: prev.reference_models.filter((_, i) => i !== idx),
                          }))}
                          title="移除参考模型"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              <div className="flex justify-end">
                <Button
                  variant="outline" size="sm"
                  onClick={() => updateMoaPreset(prev => ({
                    ...prev,
                    reference_models: [...prev.reference_models, { ...prev.aggregator, model_ref: undefined, enabled: true }],
                  }))}
                >
                  <Plus size={13} strokeWidth={1.5} /> 添加参考模型
                </Button>
              </div>
              </div>

              {/* 聚合器：综合所有参考回答的组长，每套一个（对齐 Hermes ListRow：无开关无删除） */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">聚合器（执行模型）</p>
                <p className="text-[11px] text-muted-foreground/60 -mt-1.5">汇总所有参考模型的回答，综合成最终回复的模型。每套预设一个。</p>
                <div className="rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card px-3 py-2">
                  <div className="text-xs font-medium text-foreground">聚合器</div>
                  <div className="text-[10px] font-mono text-muted-foreground/60 truncate mt-0.5">
                    {currentMoaPreset.aggregator.provider
                      ? `${currentMoaPreset.aggregator.provider} · ${currentMoaPreset.aggregator.model || '未选择模型'}`
                      : '未配置提供商与模型'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2 pt-1">
                    <select
                      className="flex h-8 flex-1 min-w-28 items-center rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground shadow-xs outline-none min-w-0"
                      value={currentMoaPreset.aggregator.provider}
                      onChange={e => updateMoaPreset(prev => ({
                        ...prev,
                        aggregator: updateMoaSlot(prev.aggregator, { provider: e.target.value }),
                      }))}
                    >
                      <option value="">选择提供商</option>
                      {moaSlotProviderOptions.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                    <select
                      className="flex h-8 flex-1 min-w-36 items-center rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground shadow-xs outline-none disabled:opacity-50 min-w-0"
                      value={currentMoaPreset.aggregator.model}
                      disabled={!currentMoaPreset.aggregator.provider}
                      onChange={e => updateMoaPreset(prev => ({
                        ...prev,
                        aggregator: updateMoaSlot(prev.aggregator, { model: e.target.value }),
                      }))}
                    >
                      <option value="">选择模型</option>
                      {getProviderModels(providers, currentMoaPreset.aggregator.provider).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              </div>
              )}
              </div>

              {/* 添加预设（卡片外独立区域，不裹在大卡片里） */}
              <div className="rounded-xl border border-dashed border-[var(--ui-stroke-tertiary)]p-3 space-y-1.5">
                <p className="text-[11px] text-muted-foreground/70">添加预设（复制当前预设内容，创建后可编辑）</p>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-44 h-8 text-xs"
                    placeholder="新预设名"
                    value={newMoaPreset}
                    onChange={e => setNewMoaPreset(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newMoaPreset.trim() && !moaPresets[newMoaPreset.trim()]) {
                        createMoaPreset();
                      }
                    }}
                  />
                  <Button
                    variant="default" size="sm"
                    disabled={!newMoaPreset.trim() || !!moaPresets[newMoaPreset.trim()]}
                    onClick={createMoaPreset}
                  >
                    <Plus size={13} strokeWidth={1.5} /> 添加预设
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════ 媒体生成（对齐 Hermes ModelCatalogPicker：后端目录 + 点击即存） ══════════ */}
      {/* 🔴 2026-08-20：ELEVE 媒体生成（MXAPI）分类化目录——按图片/视频/音乐分类，
          取消 FLUX/FAL；implemented=false 的通道灰显「待接入」不可选 */}
      {tab === 'image' && (
        <div className="space-y-3">
          {/* 说明 + 当前生效模型（合并为一张轻量卡） */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card shadow-xs px-4 py-3">
            <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
              Agent 调用<span className="font-medium text-foreground">媒体生成</span>工具时使用的模型（ELEVE 媒体生成后端）。
              点击卡片即切换并保存；标「待接入」的通道后端尚未实现，不可选。
            </p>
            {imageGen?.has_models && (
              <div className="flex shrink-0 items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">当前</span>
                <span className="font-medium text-foreground">
                  {imageGen.models.find((m: any) => m.id === imageGen.current)?.display || imageGen.current}
                </span>
              </div>
            )}
          </div>
          {imageLoading ? (
            <p className="text-xs text-muted-foreground/60">加载模型目录…</p>
          ) : !imageGen || !imageGen.has_models ? (
            <p className="text-xs text-muted-foreground/60">该工具集暂无可用模型目录。</p>
          ) : (
            ['图片', '视频', '音乐'].map((cat, catIdx) => {
              const catModels = (imageGen.models as ToolsetModelEntry[]).filter((m) => m.category === cat);
              if (catModels.length === 0) return null;
              const groups = Array.from(new Set(catModels.map((m) => m.group || ''))).filter(Boolean);
              const implementedCount = catModels.filter((m) => m.implemented !== false).length;
              const CatIcon = cat === '图片' ? ImageIcon : cat === '视频' ? Clapperboard : Music;
              return (
                <SectionCard
                  key={cat}
                  icon={CatIcon}
                  title={cat}
                  desc={`${implementedCount} 个已实现 / ${catModels.length} 个通道${catIdx === 0 ? ' · 点击已实现模型即切换生图模型' : ''}`}
                >
                  {groups.map((g) => (
                    <div key={g} className="px-4 py-3">
                      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{g}</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {/* 已实现模型在前，待接入在后 */}
                        {[...catModels.filter((m) => m.group === g && m.implemented !== false),
                          ...catModels.filter((m) => m.group === g && m.implemented === false)].map((m) => {
                          const implemented = m.implemented !== false;
                          const active = imageGen.current === m.id;
                          const saving = imageSaving === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              disabled={saving || !implemented}
                              onClick={() => void pickImageModel(m.id)}
                              title={implemented ? `${m.display} — ${m.api_path || ''}` : `${m.display}（后端待接入）— ${m.api_path || ''}`}
                              className={cn(
                                'rounded-lg border px-3 py-2.5 text-left transition-colors bg-card',
                                active
                                  ? 'border-primary/60 bg-primary/5'
                                  : implemented
                                    ? 'border-[var(--ui-stroke-tertiary)] hover:border-[var(--ui-stroke-secondary)] hover:bg-accent/20 cursor-pointer'
                                    : 'border-[var(--ui-stroke-quaternary)] opacity-55 cursor-not-allowed',
                                saving && 'opacity-60',
                              )}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className={cn('min-w-0 flex-1 truncate text-xs font-medium', implemented ? 'text-foreground' : 'text-muted-foreground/70 line-through')}>
                                  {m.display}
                                </span>
                                {active && <Check size={13} className="shrink-0 text-primary" />}
                                {saving && <span className="shrink-0 text-[10px] text-muted-foreground">保存中…</span>}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/60">{m.id}</div>
                              {(m.supports_edit || m.max_reference_images || m.api_path) && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {implemented && m.supports_edit && (
                                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">可编辑</span>
                                  )}
                                  {implemented && !!m.max_reference_images && (
                                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">参考图 {m.max_reference_images} 张</span>
                                  )}
                                  {m.api_path && (
                                    <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">{m.api_path}</span>
                                  )}
                                  {!implemented && (
                                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">待接入</span>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </SectionCard>
              );
            })
          )}
        </div>
      )}

      {/* MoA 删除预设确认（portal 渲染，位置无关） */}
      <Dialog open={moaDeleteConfirm} onOpenChange={setMoaDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除预设</DialogTitle>
            <DialogDescription>
              确定删除预设「{currentMoaPresetName}」吗？删除后不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMoaDeleteConfirm(false)}>取消</Button>
            <Button
              variant="destructive" size="sm"
              onClick={() => {
                const next = { ...moaPresets };
                delete next[currentMoaPresetName];
                const first = Object.keys(next)[0] || '';
                saveMoaPresets({
                  ...(moa || {}),
                  presets: next,
                  default_preset: moa?.default_preset === currentMoaPresetName ? first : moa?.default_preset,
                });
                setMoaPresetName(first);
                setMoaDeleteConfirm(false);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
