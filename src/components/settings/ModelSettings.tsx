import { Plus, X } from 'lucide-react';
import { CollapseIcon, ExpandIcon } from '../Icons';
import { AUX_TASKS, getProviderModels } from '../../utils/settings-store';
import type { AuxTaskEntry } from '../../utils/settings-store';
import type { ProviderEntry } from '../../utils/settings-store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * ModelSettings — main model, fallback chain, auxiliary tasks, delegation
 *
 * All model-related configuration extracted from the original SettingsPanel.
 */
export default function ModelSettings({
  // Main model
  mainProvider, mainModel, handleMainProviderChange, setMainModel,
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
}: {
  mainProvider: string;
  mainModel: string;
  handleMainProviderChange: (v: string) => void;
  setMainModel: (v: string) => void;
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
}) {
  const mainModels = getProviderModels(providers, mainProvider);
  const delModels = getProviderModels(providers, delProvider);

  const SectionHeader = ({ title, section }: { title: string; section: string }) => (
    <button
      className="flex items-center w-full gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer transition-colors rounded"
      onClick={() => setExpanded(expanded === section ? null : section)}
      type="button"
    >
      <span className="font-medium">{title}</span>
      <span className="ml-auto">
        {expanded === section ? <CollapseIcon /> : <ExpandIcon />}
      </span>
    </button>
  );

  return (
    <div>
      {/* ══════════ 主模型配置 ══════════ */}
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        <span className="font-medium">主模型（对话使用）</span>
      </div>
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">提供商</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={mainProvider}
          onChange={e => handleMainProviderChange(e.target.value)}
        >
          <option value="">选择提供商</option>
          {providerOptions.map((op: { value: string; label: string }) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
      </div>
      <div className="mb-3">
        <label className="block text-xs text-muted-foreground mb-1">模型</label>
        <select
          className="flex h-8 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={mainModel} onChange={e => setMainModel(e.target.value)} disabled={!mainProvider}
        >
          <option value="">选择模型</option>
          {mainModels.map((m: string) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="border-t border-border my-4" />

      {/* ══════════ Fallback 链 ══════════ */}
      <SectionHeader title="Fallback 链" section="fallback" />
      {expanded === 'fallback' && (
        <div className="ml-1 pl-2 border-l-2 border-border/50 space-y-3 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">主模型不可用时自动切换的备用提供商列表。</p>
          {fallbackList.map((fb: { providerId: string; model: string }, idx: number) => (
            <div key={idx} className="border border-border rounded-lg p-3 bg-card">
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
      <SectionHeader title="Auxiliary 任务" section="auxiliary" />
      {expanded === 'auxiliary' && (
        <div className="ml-1 pl-2 border-l-2 border-border/50 space-y-3 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">非对话类辅助任务使用的模型配置。</p>
          {AUX_TASKS.filter((t: AuxTaskEntry) => !t.deprecated).map((t: AuxTaskEntry) => (
            <div key={t.key} className="border border-border rounded-lg p-3 bg-card">
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
      <SectionHeader title="子 Agent 委派" section="delegation" />
      {expanded === 'delegation' && (
        <div className="ml-1 pl-2 border-l-2 border-border/50 space-y-3 mt-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">子 Agent（delegate_task）使用的模型与参数。</p>
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
      )}
    </div>
  );
}
