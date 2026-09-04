import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { call } from '../utils/bridge';
import { loadSettings, saveSettings, slugifyProviderName, AUX_TASKS, PROVIDER_REGISTRY, findProvider, listPoolProviders, upsertPoolProvider, removePoolProvider, savePoolProviderKey, disconnectPoolProvider } from '../utils/settings-store';
import type { ProviderEntry, ProviderModel, AuxTaskEntry, PoolProvider } from '../utils/settings-store';
import { notifySuccess, notifyError } from '../utils/notifications';
import { AlertTriangle, Upload, Download } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import PasswordDialog from './PasswordDialog';
import SettingsNav from './settings/SettingsNav';
import SettingsLayout from './settings/SettingsLayout';
import ProviderSettings from './settings/ProviderSettings';
import ModelSettings from './settings/ModelSettings';
import WorkspaceSettings from './settings/WorkspaceSettings';
import MemorySettings from './settings/MemorySettings';
import SecuritySettings from './settings/SecuritySettings';
import ChatSettings from './settings/ChatSettings';
import SafetySettings from './settings/SafetySettings';
import VoiceSettings from './settings/VoiceSettings';
import PluginsSettings from './settings/PluginsSettings';
import AdvancedSettings from './settings/AdvancedSettings';
import MCPSettings from './settings/MCPSettings';
// 🔴 2026-08-10 网关功能已搬入 LOGO 面板（GatewayPanel），GatewaySettings 已移除
import ConnectionSettings from './settings/ConnectionSettings';
import SystemSettings from './settings/SystemSettings';

interface Provider extends ProviderEntry {
  apiKey?: string;
  keyEnv?: string;
  // Phase P5: 全局池状态
  hasKey?: boolean;
  credentialType?: string;
  source?: string; // 'global_pool' | 'preset' | 'config' | undefined
}

interface FallbackEntry {
  providerId: string;
  model: string;
  /** 思考深度（对齐 Hermes fallback reasoning_effort；空 = 模型默认） */
  reasoningEffort?: string | null;
}

interface AuxEntry {
  providerId: string;
  model: string;
  timeout: number;
  downloadTimeout?: number;
  /** 思考深度（对齐 Hermes auxiliary.<task>.reasoning_effort；空 = 模型默认） */
  reasoningEffort?: string | null;
}

interface NewProviderForm {
  name: string;
  slug: string;      // 配置ID（自动从name生成，可编辑）
  keyEnv: string;    // 环境变量名（自动生成）
  apiKey: string;
  baseUrl: string;
  transport: string; // 协议：auto | openai_chat | anthropic_messages | codex_responses
  modelsRaw: string;
  contextLength: string; // 🔴 2026-08-10 对齐 Hermes：新模型上下文大小手动输入（默认留空=128000）
}

interface DeleteConfirm {
  providerId: string;
  name: string;
  references: string[];
}

interface SettingsPanelProps {
  onBack?: () => void;
  /** 当前活动 Agent（记忆数据总览按 per-profile 展示） */
  currentProfile?: string;
}

// ====== 常量 ======

const KEY_VISIBLE_DURATION = 60_000; // 60 秒

/** 导出脱敏：匹配敏感字段名（api_key/token/secret/password/credential 等） */
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|passwd|credential)/i;

/** 递归替换敏感字段值为占位符，防止导出 JSON 泄露明文密钥（对齐 RPC 层脱敏语义） */
function redactSensitive(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = (SENSITIVE_KEY_PATTERN.test(k) && typeof v === 'string' && v !== '')
        ? '***REDACTED***'
        : redactSensitive(v);
    }
    return out;
  }
  return obj;
}

/** 模型列表 → provider.upsert 用 models 映射（能力字段保留；handleSave / 增删模型共用，单一真相源）。
 *  值类型含 null：null = 删除标记（后端 provider.upsert 支持，removeProviderModel 用——
 *  否则 merge 语义把该模型当"UI 外模型"保留 → 假删，BUG-5）。 */
function buildModelsMap(models: ProviderModel[]): Record<string, Record<string, unknown> | null> {
  const map: Record<string, Record<string, unknown> | null> = {};
  for (const m of models) {
    map[m.name] = {
      context_length: m.context_length,
      max_output: m.max_output,
      // 🔴 P-4：能力字段回传（加载时从池保留，保存不丢）
      ...(m.supports_vision !== undefined && m.supports_vision !== null ? { supports_vision: m.supports_vision } : {}),
      ...(m.use_prompt_caching !== undefined && m.use_prompt_caching !== null ? { use_prompt_caching: m.use_prompt_caching } : {}),
    };
  }
  return map;
}

export default function SettingsPanel({ onBack, currentProfile }: SettingsPanelProps) {
  // ── 核心数据 ──
  const [providers, setProviders] = useState<Provider[]>([]);
  const [fallbackList, setFallbackList] = useState<FallbackEntry[]>([]);
  const [auxConfig, setAuxConfig] = useState<Record<string, AuxEntry>>({});
  const [delProvider, setDelProvider] = useState('');
  const [delModel, setDelModel] = useState('');
  const [delMaxIterations, setDelMaxIterations] = useState(30);

  // ── UI 状态 ──
  const [gatewayOnline, setGatewayOnline] = useState(false);
  const [activeSection, setActiveSection] = useState('providers');
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  // ── 安全 ──
  const [passwordHash, setPasswordHash] = useState('');
  const [keyUnlocked, setKeyUnlocked] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<{ mode: 'create' | 'unlock'; onSuccess?: (hash?: string) => void } | null>(null);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 系统设置 ──
  const [autoStart, setAutoStart] = useState(false);

  // 🔴 G-3：主模型 provider（stale_aux 警告用，从 config.model 解析）
  const [mainProvider, setMainProvider] = useState('');
  // 🔴 G-4：MoA 配置（从 config.yaml moa 段加载，保存时随 replace_config 落盘）
  const [moaConfig, setMoaConfig] = useState<Record<string, unknown> | null>(null);
  // 🔴 2026-08-10 修复：原始 sections 快照（aux/fallback/delegation 手写字段保留——
  // replace_config 是整段替换 + 反序列化丢未知字段，直接重建会抹掉 config.yaml 里
  // 面板不暴露的手写字段（base_url/api_key/language/model_ref/api_mode/child_timeout 等），
  // 对齐 Hermes "config block is not owned by this panel" 原则：patch 而非重建）
  const rawSectionsRef = useRef<{ auxiliary?: unknown; fallback?: unknown; delegation?: unknown }>({});

  // ── 删除确认 ──
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  // ── 导入导出 ──

  const handleExportConfig = async () => {
    try {
      const cfg = await call('get_config', {});
      const blob = new Blob([JSON.stringify(redactSensitive(cfg), null, 2)], { type: 'application/json' });
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
  const [newProvider, setNewProvider] = useState<NewProviderForm>({ name: '', slug: '', keyEnv: '', apiKey: '', baseUrl: '', transport: 'auto', modelsRaw: '', contextLength: '' });

  // ====== 加载（F5: 池=provider权威源，config.yaml=aux/fallback/del权威源） ======
  useEffect(() => {
    // settings.json 仅提供 passwordHash（UI 级设置，非 Provider 数据）
    const settings = loadSettings();
    setPasswordHash(settings.settingsPasswordHash || '');

    // 从后端加载 aux/fallback/del + 开机自启
    loadBackendConfig();

    // Provider 列表：全局池（唯一权威源）+ 预设合并（FIX-A）
    // F5 回归修复：纯池加载导致首次配置面板空白（预设消失）。
    // 池中已有的以池为准；未配置的预设显示为建议卡片，保存时一键入池。
    (async () => {
      let fromPool: Provider[] = [];
      try {
        const poolProviders = await listPoolProviders();
        fromPool = poolProviders.map(pp => ({
          id: pp.id,
          name: pp.name || pp.id,
          baseUrl: pp.base_url,
          transport: pp.transport,
          models: pp.models.map(m => ({ name: m.name, context_length: m.context_length, max_output: m.max_output, supports_vision: m.supports_vision, use_prompt_caching: m.use_prompt_caching })),
          hasKey: pp.has_key,
          credentialType: pp.credential_type,
          source: 'global_pool' as const,
        }));
      } catch { /* pool 未初始化时忽略 */ }
      const poolIds = new Set(fromPool.map(p => p.id));
      const presets: Provider[] = PROVIDER_REGISTRY
        .filter(r => !poolIds.has(r.id))
        .map(r => ({
          ...JSON.parse(JSON.stringify(r)),
          source: 'preset' as const,
        }));
      setProviders([...fromPool, ...presets]);
    })();

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
      const bc = await call('get_config', {}) as Record<string, any>;
      if (!bc) return;

      // F5: 从 config.yaml 加载 auxiliary/fallback/delegation（权威源）
      // 后端 Config 结构是 snake_case，前端是 camelCase，需要映射
      if (bc.auxiliary && typeof bc.auxiliary === 'object') {
        const aux: Record<string, AuxEntry> = {};
        for (const [key, val] of Object.entries(bc.auxiliary as Record<string, any>)) {
          if (val && typeof val === 'object') {
            aux[key] = {
              providerId: val.provider || 'auto',
              model: val.model || '',
              timeout: val.timeout ?? 120,
              downloadTimeout: val.download_timeout ?? undefined,
              reasoningEffort: val.reasoning_effort ?? null,
            };
            // 🔴 extra_body 不再入 state：面板不暴露（对齐 Hermes config.yaml 手写），
            // 保存时 rawSectionsRef patch 保留手写值
          }
        }
        if (Object.keys(aux).length > 0) setAuxConfig(aux);
      }

      if (bc.fallback?.providers && Array.isArray(bc.fallback.providers)) {
        const fbs = bc.fallback.providers.map((f: any) => ({
          providerId: f.provider || '',
          model: f.model || '',
          reasoningEffort: f.reasoning_effort ?? null,
        }));
        // 🔴 2026-08-10 默认至少一行：无配置时显示一行可配置的空行（保存时自动过滤）
        setFallbackList(fbs.length > 0 ? fbs : [{ providerId: '', model: '', reasoningEffort: null }]);
      } else {
        setFallbackList([{ providerId: '', model: '', reasoningEffort: null }]);
      }

      if (bc.delegation && typeof bc.delegation === 'object') {
        setDelProvider(bc.delegation.provider || '');
        setDelModel(bc.delegation.model || '');
        setDelMaxIterations(bc.delegation.max_iterations ?? 30);
      }

      // 🔴 G-3：主模型 provider 解析（model.ref 优先，旧形态 provider+default 兜底）
      if (bc.model) {
        if (typeof bc.model === 'string') {
          setMainProvider(bc.model.split('/')[0] || '');
        } else if (typeof bc.model === 'object' && bc.model !== null) {
          const ref = (bc.model as Record<string, unknown>).ref;
          if (typeof ref === 'string' && ref) {
            setMainProvider(ref.split('/')[0] || '');
          } else {
            const p = (bc.model as Record<string, unknown>).provider;
            if (typeof p === 'string' && p) setMainProvider(p);
          }
        }
      }
      // 🔴 2026-08-10：保留原始 sections（保存时 patch，防整段替换抹掉手写字段）
      rawSectionsRef.current = {
        auxiliary: bc.auxiliary,
        fallback: bc.fallback,
        delegation: bc.delegation,
      };

      // 🔴 G-4：MoA 配置加载（后端 MoaConfig，presets/reference_models/aggregator）
      if (bc.moa && typeof bc.moa === 'object') {
        setMoaConfig(bc.moa as Record<string, unknown>);
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

  // 🔴 G-3：stale aux 槽位 — aux 仍 pin 到非主 provider 的任务
  // （对齐 Hermes persistentStaleAux：切换主模型不自动动 aux pin，但必须提示，
  //  防后台调用静默继续打旧 provider）
  const staleAuxSlots = useMemo(() => {
    const mp = mainProvider.trim().toLowerCase();
    if (!mp) return [];
    return Object.entries(auxConfig)
      .filter(([, cfg]) => {
        const p = (cfg?.providerId || '').trim().toLowerCase();
        return p && p !== 'auto' && p !== mp;
      })
      .map(([task, cfg]) => ({ task, provider: cfg?.providerId || '', model: cfg?.model || '' }));
  }, [auxConfig, mainProvider]);

  // 🔴 G-3：一键重置 stale 槽位 → 跟随主模型（即时保存）
  const resetStaleAux = () => {
    if (staleAuxSlots.length === 0) return;
    const next = { ...auxConfig };
    for (const s of staleAuxSlots) {
      next[s.task] = { ...(next[s.task] || { providerId: 'auto', model: '', timeout: 120 }), providerId: 'auto', model: '' };
    }
    setAuxConfig(next);
    saveSectionImmediately('auxiliary', buildAuxSection(next));
    notifySuccess('已重置为跟随主模型');
  };

  // ====== Provider 操作 ======
  const updateProvider = (id: string, field: string, value: string) => {
    setProviders(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  // 🔴 2026-08-10 重构：models 升级为 ProviderModel[]（带上下文/输出能力参数）
  // 🔴 2026-08-16（R1 修复）：添加模型即时落池——先 upsert 池（后端 merge 保留
  // 池中 UI 外模型 + 覆盖同名），成功才更新 state（防幽灵模型，对齐 handleAddProvider
  // F-P1-2 模式）。此前只改内存 state、依赖底部"保存"按钮批量写池，"保存"前
  // 切页签/关面板即丢失（BUG-1），聊天下拉（池数据源）永远看不到。
  const addProviderModel = async (id: string, model: ProviderModel) => {
    const p = findProvider(providers, id);
    if (!p) return;
    if (p.models.some(m => m.name === model.name)) return;
    // 只传新增模型：后端 merge 保留池中已存在的（含此前即时添加的 + CLI/手写 UI 外模型）
    await upsertPoolProvider({
      id,
      base_url: p.baseUrl || 'https://api.openai.com/v1',
      models: buildModelsMap([model]),
    });
    setProviders(prev => prev.map(x =>
      x.id === id && !x.models.some(m => m.name === model.name)
        ? { ...x, models: [...x.models, model] }
        : x
    ));
  };

  // 🔴 2026-08-16（R1 修复）：删除模型即时落池（同添加）。
  // models 里传 null 删除标记（后端 provider.upsert 支持），否则 merge 语义
  // 会把池中该模型当"UI 外模型"保留 → 假删（BUG-5，重开面板复活）。
  const removeProviderModel = async (id: string, modelName: string) => {
    const p = findProvider(providers, id);
    if (!p) return;
    const nextModels = p.models.filter(m => m.name !== modelName);
    const modelsMap = buildModelsMap(nextModels);
    modelsMap[modelName] = null; // null = 删除标记
    try {
      await upsertPoolProvider({
        id,
        base_url: p.baseUrl || 'https://api.openai.com/v1',
        models: modelsMap,
      });
      setProviders(prev => prev.map(x => x.id === id ? { ...x, models: nextModels } : x));
    } catch (e: unknown) {
      notifyError(e, '删除模型失败（池写入）');
    }
  };

  // 🔴 G-5：断开 API Key（provider.disconnect → Credential::None，对齐 Hermes
  // 编辑留空 key = 清除语义）。断开后立即从权威源刷新 hasKey 徽章。
  const handleDisconnectKey = async (providerId: string) => {
    try {
      await disconnectPoolProvider(providerId);
      setProviders(prev => prev.map(p =>
        p.id === providerId ? { ...p, hasKey: false, credentialType: 'none' } : p
      ));
      notifySuccess('已断开 API Key');
    } catch (e: unknown) {
      notifyError(e, '断开失败');
    }
  };

  // ====== 删除级联检查 ======
  const requestDelete = (providerId: string) => {
    const p = findProvider(providers, providerId);
    if (!p) return;

    const references: string[] = [];
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

    // ── 计算删除后的新状态 ──
    const newProviders = providers.filter(p => p.id !== providerId);
    // 🔴 2026-08-10：删除后至少保留一行（老大：默认至少有一个提供商和模型）
    const newFallback = fallbackList.filter(fb => fb.providerId !== providerId);
    const finalFallback = newFallback.length > 0 ? newFallback : [{ providerId: '', model: '', reasoningEffort: null }];
    const newAux = { ...auxConfig };
    for (const key of Object.keys(newAux)) {
      if (newAux[key]?.providerId === providerId) {
        newAux[key] = { providerId: 'auto', model: '', timeout: AUX_TASKS.find((t: AuxTaskEntry) => t.key === key)?.defaultTimeout || 120 };
      }
    }
    const newDelProvider = delProvider === providerId ? '' : delProvider;
    const newDelModel = delProvider === providerId ? '' : delModel;

    // ── 更新内存 state（🔴 2026-08-10：级联变更即时保存）──
    setProviders(newProviders);
    setFallbackList(finalFallback);
    saveSectionImmediately('fallback', buildFallbackSection(finalFallback));
    setAuxConfig(newAux);
    saveSectionImmediately('auxiliary', buildAuxSection(newAux));
    if (delProvider === providerId) {
      setDelProvider('');
      setDelModel('');
      saveSectionImmediately('delegation', buildDelegationSection('', '', delMaxIterations));
    }
    setDeleteConfirm(null);

    // F5: 不再写 settings.json。provider 列表从池加载，删除池条目即永久生效。
    // 级联变更（fallback/aux 重置）已即时保存。

    // 同步从全局池删除（后端 pool.remove 持锁落盘 providers.yaml，持久）
    removePoolProvider(providerId).then(res => {
      if (res.warnings.length > 0) {
        notifySuccess(`已删除，但有引用: ${res.warnings.join('; ')}`);
      }
    }).catch((e: unknown) => {
      notifyError(e, '全局池删除失败');
    });
  };

  // ====== 添加提供商 ======
  const handleAddProvider = () => {
    if (!newProvider.name.trim() || !newProvider.slug.trim()) return;
    const ctx = parseInt(newProvider.contextLength, 10);
    const models: ProviderModel[] = newProvider.modelsRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(name => ({
        name,
        // 🔴 2026-08-10 修：留空不再强制 128000（0 = 未知，前端显示 "—"）
        context_length: Number.isFinite(ctx) && ctx > 0 ? ctx : 0,
        max_output: 16384, // UI 不暴露输出字段（老大 2026-08-10）
      }));
    const provider: Provider = {
      id: newProvider.slug.trim(),
      name: newProvider.name.trim(),
      apiKey: newProvider.apiKey.trim(),
      baseUrl: newProvider.baseUrl.trim(),
      transport: newProvider.transport,
      models,
    };
    setNewProvider({ name: '', slug: '', keyEnv: '', apiKey: '', baseUrl: '', transport: 'auto', modelsRaw: '', contextLength: '' });
    setAddProviderOpen(false);

    // F-P1-2 修复：先写池、成功后才入 UI（防幽灵 Provider）。
    // 旧实现先 setProviders 后异步 upsert，失败不回滚 → 面板残留假卡片，
    // 再点保存会把幽灵带进批量写。池是权威源：入池成功 = 存在，UI 如实反映。
    const transport = (provider.transport && provider.transport !== 'auto') ? provider.transport : undefined;
    // 🔴 F2 修复：key_env 凭证接线 — API Key 为空且填了环境变量名 → 走 Credential::KeyEnv
    // （凭证不落盘明文，运行时从进程 env / per-profile .env 读取）。与 save_key（ApiKey）互斥。
    const keyEnvName = newProvider.keyEnv.trim();
    const apiKeyVal = (provider.apiKey ?? '').trim();
    const useKeyEnv = !apiKeyVal && keyEnvName.length > 0;
    upsertPoolProvider({
      id: provider.id,
      name: provider.name,
      base_url: provider.baseUrl || 'https://api.openai.com/v1',
      transport,
      ...(useKeyEnv ? { credential: { key_env: keyEnvName } } : {}),
      models: Object.fromEntries(provider.models.map(m => [m.name, { context_length: m.context_length, max_output: m.max_output }])),
    }).then(() => {
      setProviders(prev => [...prev, { ...provider, source: 'global_pool' as const }]);
      // 如果有 API key，同步保存到池（Provider 已入池，key 失败不回滚 Provider，可重试）
      if (provider.apiKey && provider.apiKey.length >= 8) {
        savePoolProviderKey(provider.id, provider.apiKey).catch((e: unknown) => {
          notifyError(e, 'API Key 保存失败');
        });
      }
    }).catch((e: unknown) => {
      notifyError(e, '添加失败（池写入）');
    });
  };

  // 显示名变化时自动生成 slug
  // FIX-D：预设厂商直接用预设 ID（aliyun-bailian），不走后端 slugify
  // （后端拼音化会生成 a1-li3-yu2n-ba3i-lia4n 这种带声调的坏 ID），
  // 同时自动填充 baseUrl + 默认模型，省去手动输入。
  // 🔴 R3（2026-08-16）：预设 keyEnv 为空（本地 provider：Ollama/LM Studio）
  // 时**不自动生成** key_env——本地服务免凭证（Credential::None），
  // 自动生成 OLLAMA_API_KEY 会让 useKeyEnv 判定为 true → 要求环境变量 → 报 KeyEnvNotSet。
  const handleProviderNameChange = async (name: string) => {
    setNewProvider(prev => ({ ...prev, name }));
    const trimmed = name.trim();
    if (!trimmed) return;
    const preset = PROVIDER_REGISTRY.find(r => r.name === trimmed || r.id === trimmed);
    if (preset) {
      setNewProvider(prev => ({
        ...prev,
        slug: preset.id,
        // 注册表 keyEnv 优先（Hermes 同源 env 名，如 HF_TOKEN）；本地 provider 保持空
        keyEnv: preset.keyEnv || '',
        baseUrl: preset.baseUrl,
        modelsRaw: preset.models.map(m => m.name).join(', '),
      }));
      return;
    }
    try {
      const result = await slugifyProviderName(trimmed);
      setNewProvider(prev => ({ ...prev, slug: result.slug, keyEnv: result.key_env }));
    } catch {
      // fallback: 简易英文slugify
      const fallback = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      setNewProvider(prev => ({ ...prev, slug: fallback || 'provider', keyEnv: (fallback || 'provider').toUpperCase().replace(/-/g, '_') + '_API_KEY' }));
    }
  };

  // ====== Fallback / Aux / Del 操作（🔴 2026-08-10 全部即时保存） ======
  const removeFallback = (idx: number) => {
    // 🔴 2026-08-10：删除后至少保留一行（老大：默认至少有一个提供商和模型）
    const next = fallbackList.filter((_, i) => i !== idx);
    const final = next.length > 0 ? next : [{ providerId: '', model: '', reasoningEffort: null }];
    setFallbackList(final);
    saveSectionImmediately('fallback', buildFallbackSection(final));
  };
  const addFallback = () => {
    const next = [...fallbackList, { providerId: '', model: '', reasoningEffort: null }];
    setFallbackList(next);
    saveSectionImmediately('fallback', buildFallbackSection(next));
  };
  const updateFallback = (idx: number, field: string, value: string | null) => {
    const updated = [...fallbackList];
    updated[idx] = { ...updated[idx], [field]: value ?? undefined };
    if (field === 'providerId') updated[idx].model = '';
    setFallbackList(updated);
    saveSectionImmediately('fallback', buildFallbackSection(updated));
  };

  const updateAux = (key: string, field: string, value: string | number | null) => {
    const next = {
      ...auxConfig,
      [key]: { ...(auxConfig[key] || { providerId: 'auto', model: '' }), [field]: value },
    };
    setAuxConfig(next);
    saveSectionImmediately('auxiliary', buildAuxSection(next));
  };

  // 🔴 2026-08-10：委派字段变更即时保存（用新值构建段，避免 state 异步旧值）
  const setDelProviderSafe = (v: string) => {
    setDelProvider(v);
    setDelModel('');
    saveSectionImmediately('delegation', buildDelegationSection(v, '', delMaxIterations));
  };
  const setDelModelSafe = (v: string) => {
    setDelModel(v);
    saveSectionImmediately('delegation', buildDelegationSection(delProvider, v, delMaxIterations));
  };
  const setDelMaxIterationsSafe = (v: number) => {
    setDelMaxIterations(v);
    saveSectionImmediately('delegation', buildDelegationSection(delProvider, delModel, v));
  };

  // ====== 保存 ======
  // 🔴 2026-08-10 模型面板全部即时保存（对齐 Hermes）：fallback/aux/delegation/moa
  // 每次变更即落盘，底部保存按钮删除。update_config 加性写单段，不整段替换。
  const saveSectionImmediately = useCallback((section: string, value: unknown) => {
    void call('update_config', { config: { [section]: value } }).catch((e: unknown) => {
      console.warn(`[SettingsPanel] ${section} 即时保存失败:`, (e as Error).message);
    });
  }, []);

  // ── Fallback 段构建（raw patch 保留手写字段：base_url/api_key/context_length/model_ref）──
  const buildFallbackSection = useCallback((list: FallbackEntry[]): Record<string, unknown> => {
    const fbFiltered = list.filter(f => f.providerId && f.model);
    const rawFb = ((rawSectionsRef.current.fallback || {}) as { providers?: Array<Record<string, unknown>> }).providers || [];
    return {
      providers: fbFiltered.map(f => {
        const raw = rawFb.find(r => r.provider === f.providerId && r.model === f.model) || {};
        const entry: Record<string, unknown> = { ...raw, provider: f.providerId, model: f.model };
        // 思考深度：非空写 reasoning_effort（对齐 Hermes fallback reasoning_effort）
        if (f.reasoningEffort) entry.reasoning_effort = f.reasoningEffort;
        return entry;
      }),
    };
  }, []);

  // ── Auxiliary 段构建（raw patch 保留手写字段）──
  const buildAuxSection = useCallback((cfg: Record<string, AuxEntry>): Record<string, Record<string, unknown>> => {
    const rawAux = (rawSectionsRef.current.auxiliary || {}) as Record<string, Record<string, unknown>>;
    const auxObj: Record<string, Record<string, unknown>> = {};
    for (const [key, c] of Object.entries(cfg)) {
      const taskCfg: Record<string, unknown> = {
        provider: c.providerId || 'auto',
        timeout: c.timeout,
      };
      if (c.model) taskCfg.model = c.model;
      if (c.reasoningEffort) taskCfg.reasoning_effort = c.reasoningEffort;
      if (c.downloadTimeout != null) taskCfg.download_timeout = c.downloadTimeout;
      // 手写字段优先保留，前端字段覆盖同名
      auxObj[key] = { ...(rawAux[key] || {}), ...taskCfg };
    }
    return auxObj;
  }, []);

  // ── Delegation 段构建（raw patch 保留手写字段）──
  const buildDelegationSection = useCallback((provider: string, model: string, maxIter: number): Record<string, unknown> => {
    const rawDel = (rawSectionsRef.current.delegation || {}) as Record<string, unknown>;
    return provider
      ? { ...rawDel, provider, model: model || null, max_iterations: maxIter }
      : { ...rawDel, provider: null, model: null };
  }, []);

  // 🔴 2026-08-10：MoA 即时落盘（对齐 Hermes saveMoa）——update_config 加性写 moa 段，
  // 不整段替换（不碰 fallback/aux/delegation），失败不阻断 UI（下次操作重试/底部保存兜底）
  const saveMoaImmediately = useCallback((moa: Record<string, unknown>) => {
    void call('update_config', { config: { moa } }).catch((e: unknown) => {
      console.warn('[SettingsPanel] MoA 即时保存失败:', (e as Error).message);
    });
  }, []);

  const handleSave = useCallback(async () => {

    // 🔴 2026-08-10：fallback/aux/delegation/moa 已全部即时保存（update_config 单段加性写），
    // handleSave 仅剩：settings.json passwordHash + 服务商池同步（ProviderCard 保存按钮用）
    const isPlaceholder = (k: string) => k.includes('...') || k.includes('••') || k.includes('***') || k.length < 8;

    // F5: settings.json 仅存 passwordHash（UI 级设置）
    // Provider/aux/fallback/del 不再写 settings.json，分别走池和 config.yaml
    await saveSettings({
      version: 2,
      providers: [],  // 清空：provider 权威源是池
      fallback: [],
      auxiliary: {},
      delegation: { providerId: '', model: '', maxIterations: 30 },
      settingsPasswordHash: passwordHash,
    }).catch(() => { /* passwordHash 保存失败不阻塞主流程 */ });

    // Phase P5: 同步到全局 Provider 池（池=唯一权威源）
    const poolPromises = providers.map(async (p) => {
      const transport = (p.transport && p.transport !== 'auto') ? p.transport : undefined;
      const modelsMap = buildModelsMap(p.models);
      await upsertPoolProvider({
        id: p.id,
        name: p.name,
        base_url: p.baseUrl || 'https://api.openai.com/v1',
        transport,
        models: modelsMap,
      });
      // API Key 同步到池
      if (p.apiKey && !isPlaceholder(p.apiKey)) {
        await savePoolProviderKey(p.id, p.apiKey);
      }
    });
    // F-P1-1 修复：逐项检查池写入结果。allSettled 永不 reject，
    // 旧实现吞掉所有失败照样显示“✓ 已生效”→ 池里没数据但用户以为成功。
    const poolResults = await Promise.allSettled(poolPromises);
    const poolFailures = poolResults
      .map((r, i) => ({ r, id: providers[i]?.id ?? '?' }))
      .filter(({ r }) => r.status === 'rejected');
    if (poolFailures.length > 0) {
      const msgs = poolFailures
        .map(({ r, id }) => `${id}: ${(r as PromiseRejectedResult).reason?.message ?? '未知错误'}`)
        .join('；');
      notifyError(new Error(msgs), '保存失败（池写入）');
    }

    // 保存成功后立即从权威源（全局池）刷新 hasKey 徽章。
    // pool 列表只在面板挂载时拉一次，若不刷新，即使 key 已写入池，
    // UI 仍显示陈旧的"无key"（必须重开面板才更新）→ 从权威源 re-derive 保证 UI 如实。
    try {
      const fresh = await listPoolProviders();
      if (fresh.length > 0) {
        setProviders(prev => prev.map(p => {
          const pp = fresh.find(f => f.id === p.id);
          if (!pp) return p;
          // FIX-B：从权威源同步回 models + hasKey，预设卡片入池后标记 global_pool
          const poolModels = pp.models.map(m => ({ name: m.name, context_length: m.context_length, max_output: m.max_output, supports_vision: m.supports_vision, use_prompt_caching: m.use_prompt_caching }));
          return {
            ...p,
            models: poolModels.length > 0 ? poolModels : p.models,
            hasKey: pp.has_key,
            credentialType: pp.credential_type,
            source: 'global_pool' as const,
          };
        }));
      }
    } catch { /* 刷新失败不影响保存结果 */ }

    try {
      const d = await call('list_models', {});
      if (d) {
        notifySuccess('服务商配置已保存');
        setGatewayOnline(true);
        setTimeout(() => onBack?.(), 1500);
      } else {
        throw new Error('异常');
      }
    } catch {
      notifySuccess('配置已保存');
      setGatewayOnline(false);
    }
  }, [providers, passwordHash, onBack]);

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
            onDisconnect={handleDisconnectKey}
          />
        );
      case 'models':
        return (
          <ModelSettings
            fallbackList={fallbackList}
            addFallback={addFallback}
            removeFallback={removeFallback}
            updateFallback={updateFallback}
            auxConfig={auxConfig}
            updateAux={updateAux}
            delProvider={delProvider}
            setDelProvider={setDelProviderSafe}
            delModel={delModel}
            setDelModel={setDelModelSafe}
            delMaxIterations={delMaxIterations}
            setDelMaxIterations={setDelMaxIterationsSafe}
            providers={providers}
            providerOptions={providerOptions}
            staleAuxSlots={staleAuxSlots}
            onResetStaleAux={resetStaleAux}
            moaConfig={moaConfig}
            setMoaConfig={setMoaConfig}
            onSaveMoa={saveMoaImmediately}
          />
        );
      case 'workspace':
        return <WorkspaceSettings onSaved={() => {}} />;
      case 'memory':
        return <MemorySettings onSaved={() => {}} currentProfile={currentProfile} />;
      case 'chat':
        return <ChatSettings onSaved={() => {}} />;
      case 'safety':
        return <SafetySettings onSaved={() => {}} />;
      case 'voice':
        return <VoiceSettings onSaved={() => {}} />;
      case 'mcp':
        return <MCPSettings />;
      // 🔴 2026-08-10 网关功能已搬入 LOGO 面板（GatewayPanel），设置里移除重复入口
      case 'connection':
        return <ConnectionSettings />;
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
      case 'plugins':
        return <PluginsSettings />;
      case 'advanced':
        return <AdvancedSettings onSaved={() => {}} />;
      default:
        return null;
    }
  };

  return (
    <main className="h-full overflow-hidden">
      <SettingsLayout
        onClose={onBack}
        nav={
          <SettingsNav
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        }
        footer={
          <div className="flex flex-col gap-0.5">
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm text-left text-[var(--theme-muted-foreground)] transition-colors hover:bg-[var(--theme-accent)]/20 hover:text-[var(--theme-foreground)]"
              onClick={handleImportConfig}
              type="button"
            >
              <Upload size={16} strokeWidth={1.5} />
              <span>导入配置</span>
            </button>
            <button
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm text-left text-[var(--theme-muted-foreground)] transition-colors hover:bg-[var(--theme-accent)]/20 hover:text-[var(--theme-foreground)]"
              onClick={handleExportConfig}
              type="button"
            >
              <Download size={16} strokeWidth={1.5} />
              <span>导出配置</span>
            </button>
          </div>
        }
      >
        {renderContent()}

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
          <div className="bg-card text-card-foreground rounded-xl border border-[var(--ui-stroke-tertiary)] shadow-lg p-6 max-w-md w-full mx-4" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
