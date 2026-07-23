import { useState, useEffect, useCallback, useRef } from 'react';
import { call } from '../utils/bridge';
import { loadSettings, saveSettings, saveApiKey, slugifyProviderName, AUX_TASKS, findProvider } from '../utils/settings-store';
import type { ProviderEntry, AuxTaskEntry } from '../utils/settings-store';
import { notifySuccess, notifyError } from '../utils/notifications';
import { AlertTriangle, Upload, Download } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';
import PasswordDialog from './PasswordDialog';
import SettingsNav from './settings/SettingsNav';
import SettingsLayout from './settings/SettingsLayout';
import ProviderSettings from './settings/ProviderSettings';
import ModelSettings from './settings/ModelSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import WorkspaceSettings from './settings/WorkspaceSettings';
import MemorySettings from './settings/MemorySettings';
import SecuritySettings from './settings/SecuritySettings';
import ChatSettings from './settings/ChatSettings';
import SafetySettings from './settings/SafetySettings';
import VoiceSettings from './settings/VoiceSettings';
import AdvancedSettings from './settings/AdvancedSettings';
import MCPSettings from './settings/MCPSettings';
import GatewaySettings from './settings/GatewaySettings';
import SystemSettings from './settings/SystemSettings';

interface Provider extends ProviderEntry {
  apiKey?: string;
  keyEnv?: string;
}

interface FallbackEntry {
  providerId: string;
  model: string;
}

interface AuxEntry {
  providerId: string;
  model: string;
  timeout: number;
  temperature?: number | null;
  extraBody?: string | null;
  downloadTimeout?: number;
}

interface NewProviderForm {
  name: string;
  slug: string;      // 配置ID（自动从name生成，可编辑）
  keyEnv: string;    // 环境变量名（自动生成）
  apiKey: string;
  baseUrl: string;
  transport: string; // 协议：auto | openai_chat | anthropic_messages | codex_responses
  modelsRaw: string;
}

interface DeleteConfirm {
  providerId: string;
  name: string;
  references: string[];
}

interface SettingsPanelProps {
  onBack?: () => void;
}

// ====== 常量 ======

/**
 * 对齐 Eleve determine_api_mode (providers.py L502-548)
 * URL 启发式推断 transport 协议
 */
function inferTransport(providerId: string, baseUrl?: string): string {
  if (!baseUrl) return 'openai_chat';
  const url = baseUrl.replace(/\/+$/, '').toLowerCase();
  // URL-based heuristics — 对齐 Eleve
  if (url.includes('api.kimi.com/coding')) return 'anthropic_messages';
  if (url.endsWith('/anthropic') || url.includes('api.anthropic.com')) return 'anthropic_messages';
  if (url.includes('api.openai.com')) return 'openai_chat';
  // provider name fallback
  if (providerId === 'anthropic' || providerId === 'claude') return 'anthropic_messages';
  return 'openai_chat';
}
const KEY_VISIBLE_DURATION = 60_000; // 60 秒

export default function SettingsPanel({ onBack }: SettingsPanelProps) {
  // ── 核心数据 ──
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mainProvider, setMainProvider] = useState('');
  const [mainModel, setMainModel] = useState('');
  const [fallbackList, setFallbackList] = useState<FallbackEntry[]>([]);
  const [auxConfig, setAuxConfig] = useState<Record<string, AuxEntry>>({});
  const [delProvider, setDelProvider] = useState('');
  const [delModel, setDelModel] = useState('');
  const [delMaxIterations, setDelMaxIterations] = useState(30);

  // ── UI 状态 ──
  const [status, setStatus] = useState<{ text: string; className: string }>({ text: '', className: 'text-muted-foreground text-xs' });
  const [gatewayOnline, setGatewayOnline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('providers');
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [modelSectionExpanded, setModelSectionExpanded] = useState<string | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  // ── 安全 ──
  const [passwordHash, setPasswordHash] = useState('');
  const [keyUnlocked, setKeyUnlocked] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<{ mode: 'create' | 'unlock'; onSuccess?: (hash?: string) => void } | null>(null);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 系统设置 ──
  const [autoStart, setAutoStart] = useState(false);

  // ── 删除确认 ──
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  // ── 搜索 + 导入导出 ──
  const [searchQuery, setSearchQuery] = useState('');

  const handleExportConfig = async () => {
    try {
      const cfg = await call('get_config', {});
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'eleve-config.json';
      a.click();
      URL.revokeObjectURL(url);
      notifySuccess('配置已导出');
    } catch (err: unknown) {
      notifyError((err as Error).message || err, '导出失败');
    }
  };

  const handleImportConfig = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const cfg = JSON.parse(text);
        await call('update_config', { config: cfg });
        notifySuccess('配置已导入，刷新后生效');
        loadBackendConfig();
      } catch (err: unknown) {
        notifyError((err as Error).message || err, '导入失败：文件格式不正确');
      }
    };
    input.click();
  };

  // ── 新建提供商表单 ──
  const [newProvider, setNewProvider] = useState<NewProviderForm>({ name: '', slug: '', keyEnv: '', apiKey: '', baseUrl: '', transport: 'auto', modelsRaw: '' });

  // ====== 加载 ======
  useEffect(() => {
    const settings = loadSettings();
    setProviders(settings.providers || []);
    setMainProvider(settings.main?.providerId || '');
    setMainModel(settings.main?.model || '');
    setFallbackList(settings.fallback || []);
    setAuxConfig(settings.auxiliary || {});
    setDelProvider(settings.delegation?.providerId || '');
    setDelModel(settings.delegation?.model || '');
    setDelMaxIterations(settings.delegation?.maxIterations || 30);
    setPasswordHash(settings.settingsPasswordHash || '');

    // 尝试从后端合并
    loadBackendConfig();

    // 读取开机自启状态
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const enabled = await invoke('get_auto_start');
        setAutoStart(enabled as boolean);
      } catch { /* not in Tauri */ }
    })();
  }, []);

  const loadBackendConfig = async () => {
    try {
      const bc: Record<string, unknown> = await call('get_config', {});
      // ... same logic as original ...
      if (bc.model) {
        if (typeof bc.model === 'object' && bc.model !== null) {
          const modelObj = bc.model as Record<string, string>;
          const cfgProvider = modelObj.provider || '';
          const cfgModel = modelObj.default || '';
          setMainProvider(cfgProvider);
          setMainModel(cfgModel);
          // ── R3 修复：config.yaml 的 provider/model 自动同步到 settings.json ──
          // 如果 settings.json 里 main 为空但 config.yaml 有值，自动保存
          // 否则前端展示选中了但实际没存盘，重启后丢失
          if (cfgProvider || cfgModel) {
            const current = loadSettings();
            if (!current.main?.providerId && !current.main?.model) {
              const merged = {
                ...current,
                main: { providerId: cfgProvider, model: cfgModel, port: 0 },
              };
              saveSettings(merged);
            }
          }
        } else if (typeof bc.model === 'string') {
          setMainModel(bc.model);
        }
      }
    } catch { /* ignore */ }
    checkGateway();
  };

  const checkGateway = useCallback(async () => {
    try {
      const data = await call('list_models', {});
      setGatewayOnline(!!data);
    } catch {
      setGatewayOnline(false);
    }
  }, []);

  // ====== 提供商锁定计时器 ======
  useEffect(() => {
    return () => { if (unlockTimer.current) clearTimeout(unlockTimer.current); };
  }, []);

  const requestUnlock = (providerId: string) => {
    if (keyUnlocked) return;
    if (!passwordHash) {
      setPasswordDialog({ mode: 'create', onSuccess: (hash) => {
        setPasswordHash(hash || '');
        unlockKeys(hash);
      }});
    } else {
      setPasswordDialog({ mode: 'unlock', onSuccess: () => unlockKeys() });
    }
  };

  const requestSetPassword = () => {
    setPasswordDialog({ mode: passwordHash ? 'unlock' : 'create', onSuccess: (hash) => {
      if (hash) setPasswordHash(hash);
      setPasswordDialog(null);
    }});
  };

  const unlockKeys = (newHash?: string) => {
    if (newHash) setPasswordHash(newHash);
    setKeyUnlocked(true);
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => setKeyUnlocked(false), KEY_VISIBLE_DURATION);
    setPasswordDialog(null);
  };

  // ====== Provider 操作 ======
  const updateProvider = (id: string, field: string, value: string) => {
    setProviders(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const addProviderModel = (id: string, modelName: string) => {
    setProviders(prev => prev.map(p =>
      p.id === id ? { ...p, models: [...p.models, modelName] } : p
    ));
  };

  const removeProviderModel = (id: string, modelName: string) => {
    setProviders(prev => prev.map(p =>
      p.id === id ? { ...p, models: p.models.filter(m => m !== modelName) } : p
    ));
  };

  // ====== 删除级联检查 ======
  const requestDelete = (providerId: string) => {
    const p = findProvider(providers, providerId);
    if (!p) return;

    const references: string[] = [];
    if (mainProvider === providerId) references.push('主模型');
    fallbackList.forEach((fb, i) => {
      if (fb.providerId === providerId) references.push(`Fallback #${i + 1}`);
    });
    for (const [key, cfg] of Object.entries(auxConfig)) {
      if (cfg?.providerId === providerId) {
        const task = AUX_TASKS.find((t: AuxTaskEntry) => t.key === key);
        references.push(task?.label || key);
      }
    }
    if (delProvider === providerId) references.push('子Agent委派');

    setDeleteConfirm({ providerId, name: p.name, references });
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    const { providerId } = deleteConfirm;
    setProviders(prev => prev.filter(p => p.id !== providerId));
    if (mainProvider === providerId) { setMainProvider(''); setMainModel(''); }
    setFallbackList(prev => prev.filter(fb => fb.providerId !== providerId));
    setAuxConfig(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key]?.providerId === providerId) {
          next[key] = { providerId: 'auto', model: '', timeout: AUX_TASKS.find((t: AuxTaskEntry) => t.key === key)?.defaultTimeout || 120 };
        }
      }
      return next;
    });
    if (delProvider === providerId) { setDelProvider(''); setDelModel(''); }
    setDeleteConfirm(null);
  };

  // ====== 添加提供商 ======
  const handleAddProvider = () => {
    if (!newProvider.name.trim() || !newProvider.slug.trim()) return;
    const models = newProvider.modelsRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    setProviders(prev => [...prev, {
      id: newProvider.slug.trim(),
      name: newProvider.name.trim(),
      apiKey: newProvider.apiKey.trim(),
      baseUrl: newProvider.baseUrl.trim(),
      transport: newProvider.transport,
      models: models.length > 0 ? models : [],
    }]);
    setNewProvider({ name: '', slug: '', keyEnv: '', apiKey: '', baseUrl: '', transport: 'auto', modelsRaw: '' });
    setAddProviderOpen(false);
  };

  // 显示名变化时自动生成 slug（异步调后端）
  const handleProviderNameChange = async (name: string) => {
    setNewProvider(prev => ({ ...prev, name }));
    if (name.trim()) {
      try {
        const result = await slugifyProviderName(name.trim());
        setNewProvider(prev => ({ ...prev, slug: result.slug, keyEnv: result.key_env }));
      } catch {
        // fallback: 简易英文slugify
        const fallback = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        setNewProvider(prev => ({ ...prev, slug: fallback || 'provider', keyEnv: (fallback || 'provider').toUpperCase().replace(/-/g, '_') + '_API_KEY' }));
      }
    }
  };

  // ====== Fallback / Aux / Del 操作 ======
  const addFallback = () => {
    setFallbackList([...fallbackList, { providerId: '', model: '' }]);
  };
  const removeFallback = (idx: number) => {
    setFallbackList(fallbackList.filter((_, i) => i !== idx));
  };
  const updateFallback = (idx: number, field: string, value: string) => {
    const updated = [...fallbackList];
    updated[idx] = { ...updated[idx], [field]: value };
    if (field === 'providerId') updated[idx].model = '';
    setFallbackList(updated);
  };

  const updateAux = (key: string, field: string, value: string | number | null) => {
    setAuxConfig(prev => ({
      ...prev,
      [key]: { ...(prev[key] || { providerId: 'auto', model: '' }), [field]: value },
    }));
  };

  // ====== 主模型切换 ======
  const handleMainProviderChange = (pid: string) => {
    setMainProvider(pid);
    setMainModel('');
  };

  // ====== 保存 ======
  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus({ text: '保存中…', className: 'text-muted-foreground text-xs' });

    const data = {
      version: 2,
      providers,
      main: { providerId: mainProvider, model: mainModel, port: 0 },
      fallback: fallbackList,
      auxiliary: auxConfig,
      delegation: { providerId: delProvider, model: delModel, maxIterations: delMaxIterations },
      settingsPasswordHash: passwordHash,
    };
    await saveSettings(data);

    const keyErrors: string[] = [];
    const isPlaceholder = (k: string) => k.includes('...') || k.includes('••') || k.includes('***') || k.length < 8;
    // 🔧 修复"保存慢"：API Key 并行保存（之前串行每个都 await）
    const keyPromises = providers
      .filter(p => p.apiKey && !isPlaceholder(p.apiKey))
      .map(p => saveApiKey(p.id, p.apiKey!).catch((e: Error) => keyErrors.push(`${p.name || p.id}: ${e.message}`)));
    await Promise.all(keyPromises);
    if (keyErrors.length > 0) {
      setStatus({ text: `密钥保存失败: ${keyErrors.join('; ')}`, className: 'text-destructive text-xs' });
      setSaving(false);
      return;
    }

    const backendCfg: Record<string, unknown> = {};
    if (providers.length > 0) {
      const provObj: Record<string, any> = {};
      for (const p of providers) {
        // V5.1: 优先用户手动指定 transport，否则 URL 启发式推断
        const transport = (p.transport && p.transport !== 'auto')
          ? p.transport
          : inferTransport(p.id, p.baseUrl);
        // models: HashMap<String, ModelEntry> 格式（对齐 Rust ProviderConfig.models）
        const modelsMap: Record<string, Record<string, unknown>> = {};
        for (const m of p.models) { modelsMap[m] = {}; }
        provObj[p.id] = {
          name: p.name,
          base_url: p.baseUrl,
          // 🔴 不设 model 字段：用户选择的模型走 config.model.default（上面 L433），
          // provider.model 会覆盖 model.default → 导致重启后模型不对
          transport,
          models: modelsMap,
        };
        // api_key 不写入 config.yaml——真实 key 只走 save_api_key 专用通道
        // config.yaml 只保留 key_env 引用，避免脱敏值污染
        // key_env: 优先用已有值，否则从 id 自动生成
        provObj[p.id].key_env = p.keyEnv || `${p.id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
      }
      if (Object.keys(provObj).length) backendCfg.providers = provObj;
    }

    if (mainProvider) {
      backendCfg.model = { provider: mainProvider, default: mainModel };
    }

    const fbFiltered = fallbackList.filter(f => f.providerId);
    if (fbFiltered.length) {
      backendCfg.fallback = {
        providers: fbFiltered.map(f => ({ provider: f.providerId, model: f.model || undefined })),
      };
    }

    try {
      await call('update_config', { config: backendCfg });
    } catch (e: unknown) {
      setStatus({ text: `配置保存失败: ${(e as Error).message}`, className: 'text-destructive text-xs' });
      setSaving(false);
      return;
    }

    try {
      const d = await call('list_models', {});
      if (d) {
        setStatus({ text: '✓ 配置已生效', className: 'text-success text-xs' });
        setGatewayOnline(true);
        setTimeout(() => onBack?.(), 1500);
      } else {
        throw new Error('异常');
      }
    } catch {
      setStatus({ text: '配置已保存，重启后生效', className: 'text-destructive text-xs' });
      setGatewayOnline(false);
    }
    setSaving(false);
  }, [providers, mainProvider, mainModel, fallbackList, auxConfig, delProvider, delModel, delMaxIterations, passwordHash, onBack]);

  // ====== 下拉筛选 ======
  const providerOptions = providers.map(p => ({ value: p.id, label: `${p.name} (${p.id})` }));

  // ====== 渲染内容区 ======
  const renderContent = () => {
    switch (activeSection) {
      case 'providers':
        return (
          <ProviderSettings
            providers={providers}
            expandedProvider={expandedProvider}
            onToggleProvider={(id: string | null) => setExpandedProvider(expandedProvider === id ? null : id)}
            updateProvider={updateProvider}
            addProviderModel={addProviderModel}
            removeProviderModel={removeProviderModel}
            requestDelete={requestDelete}
            requestUnlock={requestUnlock}
            keyUnlocked={keyUnlocked}
            handleSave={handleSave}
            addProviderOpen={addProviderOpen}
            setAddProviderOpen={setAddProviderOpen}
            newProvider={newProvider}
            setNewProvider={setNewProvider}
            handleAddProvider={handleAddProvider}
            onProviderNameChange={handleProviderNameChange}
          />
        );
      case 'models':
        return (
          <ModelSettings
            mainProvider={mainProvider}
            mainModel={mainModel}
            handleMainProviderChange={handleMainProviderChange}
            setMainModel={setMainModel}
            fallbackList={fallbackList}
            addFallback={addFallback}
            removeFallback={removeFallback}
            updateFallback={updateFallback}
            auxConfig={auxConfig}
            updateAux={updateAux}
            delProvider={delProvider}
            setDelProvider={setDelProvider}
            delModel={delModel}
            setDelModel={setDelModel}
            delMaxIterations={delMaxIterations}
            setDelMaxIterations={setDelMaxIterations}
            providers={providers}
            providerOptions={providerOptions}
            expanded={modelSectionExpanded}
            setExpanded={setModelSectionExpanded}
          />
        );
      case 'appearance':
        return <AppearanceSettings onSaved={() => {}} />;
      case 'workspace':
        return <WorkspaceSettings onSaved={() => {}} />;
      case 'memory':
        return <MemorySettings onSaved={() => {}} />;
      case 'chat':
        return <ChatSettings onSaved={() => {}} />;
      case 'safety':
        return <SafetySettings onSaved={() => {}} />;
      case 'voice':
        return <VoiceSettings onSaved={() => {}} />;
      case 'mcp':
        return <MCPSettings />;
      case 'gateway':
        return <GatewaySettings />;
      case 'security':
        return (
          <SecuritySettings
            passwordHash={passwordHash}
            keyUnlocked={keyUnlocked}
            onSetPassword={requestSetPassword}
          />
        );
      case 'system':
        return (
          <SystemSettings
            autoStart={autoStart}
            setAutoStart={setAutoStart}
          />
        );
      case 'advanced':
        return <AdvancedSettings onSaved={() => {}} />;
      default:
        return null;
    }
  };

  return (
    <main className="h-full overflow-hidden bg-background">
      <SettingsLayout
        nav={
          <SettingsNav
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        }
      >
        {/* 搜索栏 + 导入导出 */}
        <div className="flex items-center gap-2 mb-4">
          <Input
            type="text"
            placeholder="搜索设置项… (Ctrl+P)"
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <Button variant="ghost" size="icon-sm" title="导入配置" onClick={handleImportConfig}>
            <Upload />
          </Button>
          <Button variant="ghost" size="icon-sm" title="导出配置" onClick={handleExportConfig}>
            <Download />
          </Button>
        </div>

        {/* 保存状态 */}
        {status.text && (
          <div className="mb-4">
            <span className={status.className}>{status.text}</span>
          </div>
        )}

        {renderContent()}

        {/* ══════════ 保存按钮 ══════════ */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-border">
          <span className="text-xs text-muted-foreground">{status.text}</span>
          <Button disabled={saving} onClick={handleSave}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </SettingsLayout>

      {/* ══════════ 密码对话框 ══════════ */}
      {passwordDialog && (
        <PasswordDialog
          mode={passwordDialog.mode}
          storedHash={passwordHash}
          onSuccess={passwordDialog.mode === 'create' ? (hash) => unlockKeys(hash) : () => unlockKeys()}
          onCancel={() => setPasswordDialog(null)}
        />
      )}

      {/* ══════════ 删除确认弹窗 ══════════ */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-overlay/50 flex items-center justify-center" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-card text-card-foreground rounded-xl shadow-lg p-6 max-w-md w-full mx-4" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <h3 className={cn("text-lg font-semibold flex items-center gap-2 mb-2")}>
              <AlertTriangle size={16} strokeWidth={1.5} color="var(--ui-red)" />
              确认删除
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              确定要删除 <strong>{deleteConfirm.name}</strong> 吗？
            </p>
            {deleteConfirm.references.length > 0 && (
              <div className="bg-muted rounded-lg p-3 mb-4 text-sm text-muted-foreground">
                <p>该厂商正被以下配置引用，删除后将被清空：</p>
                <ul>
                  {deleteConfirm.references.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)}>取消</Button>
              <Button variant="destructive" onClick={confirmDelete}>确认删除</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
