import { Plus } from 'lucide-react';
import ProviderCard from '../ProviderCard';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ModelOptionProvider } from '@/types/eleve';

/**
 * ProviderSettings — API provider management section
 *
 * Displays provider cards, add-provider form, and provider-level operations.
 * All state lives in the parent (SettingsPanel); this is purely presentational.
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
  providers: (Partial<ModelOptionProvider> & { id: string; name: string; apiKey?: string; baseUrl?: string; models: string[] })[];
  expandedProvider: string | null;
  onToggleProvider: (id: string) => void;
  updateProvider: (id: string, field: string, value: string) => void;
  addProviderModel: (id: string, model: string) => void;
  removeProviderModel: (id: string, model: string) => void;
  requestDelete: (id: string) => void;
  requestUnlock: (id: string) => void;
  keyUnlocked: boolean;
  handleSave: () => void;
  addProviderOpen: boolean;
  setAddProviderOpen: (v: boolean) => void;
  newProvider: { name: string; slug: string; keyEnv: string; apiKey: string; baseUrl: string; transport: string; modelsRaw: string };
  setNewProvider: (v: { name: string; slug: string; keyEnv: string; apiKey: string; baseUrl: string; transport: string; modelsRaw: string }) => void;
  handleAddProvider: () => void;
  onProviderNameChange: (name: string) => void;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground/70 leading-relaxed mb-3">
        API 提供商集中注册，后续区块只需选择厂商和模型即可。
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

      {/* 添加提供商 */}
      {!addProviderOpen ? (
        <Button
          className="w-full mt-3"
          onClick={() => setAddProviderOpen(true)}
        >
          <Plus size={15} strokeWidth={2} /> 添加提供商
        </Button>
      ) : (
        <div className="flex flex-col gap-2 p-3 mt-2 border border-border rounded-lg bg-muted/20">
          <Input
            className="h-7 text-xs"
            placeholder="厂商名称（如：阿里云百炼）"
            value={newProvider.name}
            onChange={e => onProviderNameChange(e.target.value)}
          />
          {newProvider.slug && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>配置ID:</span>
              <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{newProvider.slug}</code>
              <span className="text-muted-foreground/50">|</span>
              <span>密钥:</span>
              <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{newProvider.keyEnv}</code>
            </div>
          )}
          <Input
            className="h-7 text-xs"
            type="password"
            placeholder="API Key"
            value={newProvider.apiKey}
            onChange={e => setNewProvider({ ...newProvider, apiKey: e.target.value })}
            autoComplete="off"
          />
          <Input
            className="h-7 text-xs"
            placeholder="Base URL"
            value={newProvider.baseUrl}
            onChange={e => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
          />
          <select
            className="flex h-7 w-full items-center rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50"
            value={newProvider.transport || 'auto'}
            onChange={e => setNewProvider({ ...newProvider, transport: e.target.value })}
          >
            <option value="auto">自动推断协议</option>
            <option value="openai_chat">OpenAI 兼容</option>
            <option value="anthropic_messages">Anthropic 兼容</option>
            <option value="codex_responses">Codex Responses</option>
          </select>
          <Input
            className="h-7 text-xs"
            placeholder="模型列表（逗号分隔）"
            value={newProvider.modelsRaw}
            onChange={e => setNewProvider({ ...newProvider, modelsRaw: e.target.value })}
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setAddProviderOpen(false)}>取消</Button>
            <Button variant="default" size="sm" onClick={handleAddProvider} disabled={!newProvider.name.trim() || !newProvider.slug.trim()}>添加</Button>
          </div>
        </div>
      )}
    </div>
  );
}
