import { useState } from 'react';
import { Plus, X, GitBranch, Cog, Users, AlertTriangle, GitMerge } from 'lucide-react';
import { CollapseIcon, ExpandIcon } from '../Icons';
import { AUX_TASKS, getProviderModels } from '../../utils/settings-store';
import type { AuxTaskEntry } from '../../utils/settings-store';
import type { ProviderEntry } from '../../utils/settings-store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

// 🔴 G-4：MoA 配置类型（对齐后端 MoaConfig / MoaPresetConfig / MoaSlotConfig）
interface MoaSlot {
  model_ref?: string;
  provider: string;
  model: string;
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
  // UI state
  expanded, setExpanded,
  // 🔴 G-3: stale aux 警告（对齐 Hermes StaleAuxWarning）
  staleAuxSlots, onResetStaleAux,
  // 🔴 G-4: MoA 配置
  moaConfig, setMoaConfig,
}: {
  fallbackList: Array<{ providerId: string; model: string }>;
  addFallback: () => void;
  removeFallback: (i: number) => void;
  updateFallback: (i: number, f: string, v: string) => void;
  auxConfig: Record<string, { providerId: string; model: string; timeout: number; downloadTimeout?: number; temperature?: number | null; extraBody?: string | null }>;
  updateAux: (key: string, field: string, value: string | number | null) => void;
  delProvider: string;
  setDelProvider: (v: string) => void;
  delModel: string;
  setDelModel: (v: string) => void;
  delMaxIterations: number;
  setDelMaxIterations: (v: number) => void;
  providers: ProviderEntry[];
  providerOptions: Array<{ value: string; label: string }>;
  expanded: string | null;
  setExpanded: (v: string | null) => void;
  staleAuxSlots: Array<{ task: string; provider: string; model: string }>;
  onResetStaleAux: () => void;
  moaConfig: Record<string, unknown> | null;
  setMoaConfig: (v: Record<string, unknown> | null) => void;
}) {
  const delModels = getProviderModels(providers, delProvider);

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
    setMoaConfig({
      ...moa,
      presets: {
        ...moaPresets,
        [currentMoaPresetName]: syncPresetRefs(updater(currentMoaPreset)),
      },
    } as Record<string, unknown>);
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
  };

  const SectionHeader = ({ title, section, icon: Icon }: { title: string; section: string; icon: typeof GitBranch }) => (
    <button
      className="flex items-center w-full gap-2 px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer transition-colors rounded-lg hover:bg-muted/40"
      onClick={() => setExpanded(expanded === section ? null : section)}
      type="button"
    >
      <Icon size={14} strokeWidth={1.5} className="shrink-0" />
      <span className="font-medium">{title}</span>
      <span className="ml-auto">
        {expanded === section ? <CollapseIcon /> : <ExpandIcon />}
      </span>
    </button>
  );

  return (
    <div>
      {/* ══════════ 🔴 G-3: stale aux 警告（对齐 Hermes StaleAuxWarning —
          aux 仍 pin 到非主 provider 时提示，防后台调用静默打旧 provider） ══════════ */}
      {staleAuxSlots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 mb-3">
          <AlertTriangle size={13} strokeWidth={1.5} className="shrink-0" />
          <span className="grow">
            {staleAuxSlots.length} 个辅助任务（{staleAuxSlots.map(s => AUX_TASKS.find(t => t.key === s.task)?.label || s.task).join('、')}）
            仍运行在 <span className="font-mono">{staleAuxSlots[0].provider}</span>，不是当前主模型。
          </span>
          <Button variant="outline" size="sm" onClick={onResetStaleAux}>全部重置为主模型</Button>
        </div>
      )}

      {/* ══════════ Fallback 链 ══════════ */}
      <SectionHeader title="Fallback 链" section="fallback" icon={GitBranch} />
      {expanded === 'fallback' && (
        <div className="ml-1 pl-2 border-l-2 border-border/50 space-y-3 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">主模型不可用时自动切换的备用提供商列表。</p>
          {fallbackList.map((fb: { providerId: string; model: string }, idx: number) => (
            <div key={idx} className="border border-border/60 rounded-xl p-3 bg-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">Fallback #{idx + 1}</span>
                <Button variant="ghost" size="icon-xs" onClick={() => removeFallback(idx)} title="移除"><X size={14} /></Button>
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">提供商</label>
                <select
                  className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={fb.providerId}
                  onChange={e => updateFallback(idx, 'providerId', e.target.value)}
                >
                  <option value="">选择提供商</option>
                  {providerOptions.map((op: { value: string; label: string }) => <option key={op.value} value={op.value}>{op.label}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">模型</label>
                <select
                  className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={fb.model}
                  onChange={e => updateFallback(idx, 'model', e.target.value)} disabled={!fb.providerId}
                >
                  <option value="">选择模型</option>
                  {getProviderModels(providers, fb.providerId).map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          ))}
          <button
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0"
            onClick={addFallback}
          >
            <Plus size={13} strokeWidth={1.5} /> 添加 Fallback
          </button>
        </div>
      )}

      {/* ══════════ Auxiliary 任务 ══════════ */}
      <SectionHeader title="Auxiliary 任务" section="auxiliary" icon={Cog} />
      {expanded === 'auxiliary' && (
        <div className="ml-1 pl-2 border-l-2 border-border/50 space-y-3 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">非对话类辅助任务使用的模型配置。</p>
          {AUX_TASKS.filter((t: AuxTaskEntry) => !t.deprecated).map((t: AuxTaskEntry) => (
            <div key={t.key} className="border border-border/60 rounded-xl p-3 bg-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">{t.label}</span>
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">提供商</label>
                <select
                  className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={auxConfig[t.key]?.providerId || 'auto'}
                  onChange={e => updateAux(t.key, 'providerId', e.target.value)}
                >
                  <option value="auto">auto（跟随主模型）</option>
                  {providerOptions.map((op: { value: string; label: string }) => <option key={op.value} value={op.value}>{op.label}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">模型</label>
                <select
                  className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={auxConfig[t.key]?.model || ''}
                  onChange={e => updateAux(t.key, 'model', e.target.value)}
                  disabled={!auxConfig[t.key]?.providerId || auxConfig[t.key]?.providerId === 'auto'}
                >
                  <option value="">跟随 Provider 默认</option>
                  {getProviderModels(providers, auxConfig[t.key]?.providerId).map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">超时时间（秒）</label>
                <Input type="number" className="w-[120px]" value={auxConfig[t.key]?.timeout ?? t.defaultTimeout}
                  min={5} max={3600}
                  onChange={e => updateAux(t.key, 'timeout', parseInt(e.target.value) || t.defaultTimeout)} />
              </div>
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">温度</label>
                <Input type="number" className="w-[120px]" value={auxConfig[t.key]?.temperature ?? ''}
                  min={0} max={2} step={0.1} placeholder="默认"
                  onChange={e => updateAux(t.key, 'temperature', e.target.value === '' ? null : parseFloat(e.target.value))} />
              </div>
              {t.hasDownloadTimeout && (
                <div className="mb-3">
                  <label className="block text-xs text-muted-foreground mb-1">下载超时（秒）</label>
                  <Input type="number" className="w-[120px]" value={auxConfig[t.key]?.downloadTimeout ?? 30}
                    min={5} max={300}
                    onChange={e => updateAux(t.key, 'downloadTimeout', parseInt(e.target.value) || 30)} />
                </div>
              )}
              <div className="mb-3">
                <label className="block text-xs text-muted-foreground mb-1">Extra Body（JSON）</label>
                <Input type="text" placeholder='例如 {"reasoning_effort":"low"}' className="w-full"
                  value={typeof auxConfig[t.key]?.extraBody === 'object' ? JSON.stringify(auxConfig[t.key].extraBody) : (auxConfig[t.key]?.extraBody || '')}
                  onChange={e => {
                    const val = e.target.value.trim();
                    if (!val) { updateAux(t.key, 'extraBody', null); return; }
                    try { updateAux(t.key, 'extraBody', JSON.parse(val)); }
                    catch { /* 用户还在输入，不更新 */ }
                  }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════ 子 Agent 委派 ══════════ */}
      <SectionHeader title="子 Agent 委派" section="delegation" icon={Users} />
      {expanded === 'delegation' && (
        <div className="ml-1 pl-2 border-l-2 border-border/50 space-y-3 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">子 Agent（delegate_task）使用的模型与参数。</p>
          <div className="border border-border/60 rounded-xl p-3 bg-card space-y-3">
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">提供商</label>
            <select
              className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              value={delProvider} onChange={e => { setDelProvider(e.target.value); setDelModel(''); }}
            >
              <option value="">跟随主模型</option>
              {providerOptions.map((op: { value: string; label: string }) => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">模型</label>
            <select
              className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              value={delModel} onChange={e => setDelModel(e.target.value)} disabled={!delProvider}
            >
              <option value="">选择模型</option>
              {delModels.map((m: string) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-muted-foreground mb-1">最大迭代次数</label>
            <Input type="number" className="w-full" value={delMaxIterations} min="5" max="200"
              onChange={e => setDelMaxIterations(parseInt(e.target.value) || 30)} />
          </div>
          </div>
        </div>
      )}
      {/* ══════════ 🔴 G-4: Mixture of Agents（对齐 Hermes model-settings MoA 区块） ══════════ */}
      <SectionHeader title="Mixture of Agents" section="moa" icon={GitMerge} />
      {expanded === 'moa' && (
        <div className="ml-1 pl-2 border-l-2 border-border/50 space-y-3 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            多模型协作：参考模型并行生成 → 聚合器综合成最终回复。配置后以 MoA 预设名出现在模型列表。
          </p>
          {!moa || Object.keys(moaPresets).length === 0 ? (
            <p className="text-xs text-muted-foreground/60">暂无 MoA 预设。保存一次配置后即可创建。</p>
          ) : (
            <>
              {/* 预设工具栏 */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="flex h-8 w-40 items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none"
                  value={currentMoaPresetName}
                  onChange={e => setMoaPresetName(e.target.value)}
                >
                  {Object.keys(moaPresets).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  启用
                  <input
                    type="checkbox"
                    className="size-3.5"
                    checked={currentMoaPreset?.enabled !== false}
                    onChange={e => updateMoaPreset(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
                </label>
                <Button
                  variant="outline" size="sm"
                  disabled={moa.default_preset === currentMoaPresetName}
                  onClick={() => saveMoaPresets({ ...moa, default_preset: currentMoaPresetName })}
                >
                  设为默认
                </Button>
                <Button
                  variant="ghost" size="sm"
                  disabled={Object.keys(moaPresets).length <= 1}
                  onClick={() => {
                    const next = { ...moaPresets };
                    delete next[currentMoaPresetName];
                    const first = Object.keys(next)[0] || '';
                    saveMoaPresets({
                      ...moa,
                      presets: next,
                      default_preset: moa.default_preset === currentMoaPresetName ? first : moa.default_preset,
                    });
                    setMoaPresetName(first);
                  }}
                >
                  删除
                </Button>
                <Input
                  className="w-36 h-8 text-xs"
                  placeholder="新预设名"
                  value={newMoaPreset}
                  onChange={e => setNewMoaPreset(e.target.value)}
                />
                <Button
                  variant="default" size="sm"
                  disabled={!newMoaPreset.trim() || !!moaPresets[newMoaPreset.trim()]}
                  onClick={() => {
                    const name = newMoaPreset.trim();
                    saveMoaPresets({
                      ...moa,
                      presets: {
                        ...moaPresets,
                        [name]: {
                          enabled: true,
                          reference_models: [...(currentMoaPreset?.reference_models || [])],
                          aggregator: { ...(currentMoaPreset?.aggregator || { provider: '', model: '' }) },
                        },
                      },
                    });
                    setMoaPresetName(name);
                    setNewMoaPreset('');
                  }}
                >
                  添加预设
                </Button>
              </div>

              {/* 参考模型槽 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">参考模型</p>
                {currentMoaPreset.reference_models.map((slot, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2">
                    <span className="text-[11px] text-muted-foreground/70 w-16 shrink-0">参考 #{idx + 1}</span>
                    <select
                      className="flex h-8 flex-1 min-w-28 items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none"
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
                      className="flex h-8 flex-1 min-w-36 items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none disabled:opacity-50"
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
                    <Button
                      variant="ghost" size="icon-xs"
                      disabled={currentMoaPreset.reference_models.length <= 1}
                      onClick={() => updateMoaPreset(prev => ({
                        ...prev,
                        reference_models: prev.reference_models.filter((_, i) => i !== idx),
                      }))}
                      title="移除参考模型"
                    >
                      <X size={13} />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline" size="sm"
                  onClick={() => updateMoaPreset(prev => ({
                    ...prev,
                    reference_models: [...prev.reference_models, { ...prev.aggregator, model_ref: undefined }],
                  }))}
                >
                  <Plus size={13} strokeWidth={1.5} /> 添加参考模型
                </Button>
              </div>

              {/* 聚合器 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">聚合器（最终输出模型）</p>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2">
                  <select
                    className="flex h-8 flex-1 min-w-28 items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none"
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
                    className="flex h-8 flex-1 min-w-36 items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none disabled:opacity-50"
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
