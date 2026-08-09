import { Plus } from 'lucide-react';
import ProviderCard from '../ProviderCard';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import type { ProviderModel } from '../../utils/settings-store';

/** 服务商卡片数据结构（与 SettingsPanel.Provider 对齐，剥离 ModelOptionProvider 的 string[] models 冲突） */
export interface ProviderCardData {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  transport?: string;
  models: ProviderModel[];
  hasKey?: boolean;
  credentialType?: string;
  source?: string;
}

/**
 * ProviderSettings — API provider management section
 *
 * Displays provider cards, add-provider form, and provider-level operations.
 * All state lives in the parent (SettingsPanel); this is purely presentational.
 *
 * 🔴 2026-08-10 UI 重构（对齐 Hermes custom-endpoints-settings）：
 * 添加厂商表单升级为 Hermes 风格（名称/ID/URL/默认模型/Context/Key），
 * models 从 string[] 升级为 ProviderModel[]（带上下文/输出能力参数）。
 */
export default function ProviderSettings({
  providers,
  expandedProvider,
  onToggleProvider,
  updateProvider,
  addProviderModel,
  removeProviderModel,
  requestDelete,
  requestUnlock,
  keyUnlocked,
  handleSave,
  addProviderOpen,
  setAddProviderOpen,
  newProvider,
  setNewProvider,
  handleAddProvider,
  onProviderNameChange,
}: {
  providers: ProviderCardData[];
  expandedProvider: string | null;
  onToggleProvider: (id: string) => void;
  updateProvider: (id: string, field: string, value: string) => void;
  addProviderModel: (id: string, model: ProviderModel) => void;
  removeProviderModel: (id: string, model: string) => void;
  requestDelete: (id: string) => void;
  requestUnlock: (id: string) => void;
  keyUnlocked: boolean;
  handleSave: () => void;
  addProviderOpen: boolean;
  setAddProviderOpen: (v: boolean) => void;
  newProvider: { name: string; slug: string; keyEnv: string; apiKey: string; baseUrl: string; transport: string; modelsRaw: string; contextLength: string };
  setNewProvider: (v: { name: string; slug: string; keyEnv: string; apiKey: string; baseUrl: string; transport: string; modelsRaw: string; contextLength: string }) => void;
  handleAddProvider: () => void;
  onProviderNameChange: (name: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground/70 leading-relaxed mb-3">
        API 服务商集中注册，后续区块只需选择厂商和模型即可。添加的模型可手动配置上下文大小与最大输出。
      </p>

      {providers.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          expanded={expandedProvider === p.id}
          onToggle={() => onToggleProvider(p.id)}
          onUpdate={updateProvider}
          onAddModel={addProviderModel}
          onRemoveModel={removeProviderModel}
          onDelete={requestDelete}
          onRequestUnlock={requestUnlock}
          keyVisible={keyUnlocked}
          onSave={handleSave}
        />
      ))}

      {/* 添加服务商 */}
      {!addProviderOpen ? (
        <Button
          className="w-full mt-3"
          onClick={() => setAddProviderOpen(true)}
        >
          <Plus size={15} strokeWidth={2} /> 添加服务商
        </Button>
      ) : (
        <div className="flex flex-col gap-2.5 p-3.5 mt-2 border border-border rounded-xl bg-card shadow-sm">
          {/* 名称 + 配置ID（两列，对齐 Hermes Name/Provider ID） */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">厂商名称</label>
              <Input
                className="h-7.5 text-xs"
                placeholder="如：阿里云百炼"
                value={newProvider.name}
                onChange={e => onProviderNameChange(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">配置 ID</label>
              <Input
                className="h-7.5 text-xs font-mono"
                placeholder="自动生成，可修改"
                value={newProvider.slug}
                onChange={e => setNewProvider({ ...newProvider, slug: e.target.value })}
              />
            </div>
          </div>

          {/* API Key + Base URL */}
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">API Key</label>
            <Input
              className="h-7.5 text-xs"
              type="password"
              placeholder="可选"
              value={newProvider.apiKey}
              onChange={e => setNewProvider({ ...newProvider, apiKey: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Base URL</label>
            <Input
              className="h-7.5 text-xs"
              placeholder="https://api.example.com/v1"
              value={newProvider.baseUrl}
              onChange={e => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
            />
          </div>

          {/* 协议 */}
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">协议</label>
            <select
              className="flex h-7.5 w-full items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50"
              value={newProvider.transport || 'auto'}
              onChange={e => setNewProvider({ ...newProvider, transport: e.target.value })}
            >
              <option value="auto">自动推断协议</option>
              <option value="openai_chat">OpenAI 兼容</option>
              <option value="anthropic_messages">Anthropic 兼容</option>
              <option value="codex_responses">Codex Responses</option>
            </select>
          </div>

          {/* 模型列表 + 默认上下文（对齐 Hermes Default Model + Context，UI 不暴露输出） */}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">模型列表（逗号分隔）</label>
              <Input
                className="h-7.5 text-xs"
                placeholder="glm-5, qwen3.7-plus"
                value={newProvider.modelsRaw}
                onChange={e => setNewProvider({ ...newProvider, modelsRaw: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">上下文大小</label>
              <Input
                className="h-7.5 text-xs"
                type="text"
                inputMode="numeric"
                placeholder="128000"
                title="上面所有模型的默认上下文窗口（tokens），留空=128000"
                value={newProvider.contextLength}
                onChange={e => setNewProvider({ ...newProvider, contextLength: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-1">
            <Button variant="outline" size="sm" onClick={() => setAddProviderOpen(false)}>取消</Button>
            <Button variant="default" size="sm" onClick={handleAddProvider} disabled={!newProvider.name.trim() || !newProvider.slug.trim()}>添加</Button>
          </div>
        </div>
      )}
    </div>
  );
}
