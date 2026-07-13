/**
 * 设置数据 v2 存储 — IPC 版
 * 
 * 数据存储在 eleve-app 侧: <eleve_home>/app-data/settings.json
 * API Key 存储在: <eleve_home>/app-data/.keys.enc（加密）
 * 
 * 所有 HTTP 调用已替换为 bridge.call()
 */
import { call } from './bridge';
import * as storage from './storage';

const STORAGE_KEY = 'settings';

// ====== Interfaces ======

export interface ProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  transport?: string; // 协议：auto | openai_chat | anthropic_messages | codex_responses
  models: string[];
}

export interface AuxTaskEntry {
  key: string;
  label: string;
  defaultTimeout: number;
  hasDownloadTimeout?: boolean;
  deprecated?: boolean;
}

export interface SettingsV2 {
  version: number;
  providers: ProviderEntry[];
  main: { providerId: string; model: string; port: number };
  fallback: Array<{ providerId: string; model: string }>;
  auxiliary: Record<string, { providerId: string; model: string; timeout: number; downloadTimeout?: number }>;
  delegation: { providerId: string; model: string; maxIterations: number };
  settingsPasswordHash: string;
}

// ====== 提供商注册表预设（含 Base URL 和模型，无 Key） ======
export const PROVIDER_REGISTRY: ProviderEntry[] = [
  { id: 'zhongguo-yidong', name: '中国移动',   baseUrl: 'https://zhenze-huhehaote.cmecloud.cn/api/coding/v1', models: ['cm-code-latest'] },
  { id: 'aliyun-bailian',  name: '阿里云百炼', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',  models: ['qwen3-coder-plus', 'qwen3.5-plus', 'qwen3-coder-next'] },
];

export const AUX_TASKS: AuxTaskEntry[] = [
  { key: 'vision',            label: '图片分析',     defaultTimeout: 120, hasDownloadTimeout: true },
  { key: 'compression',       label: '上下文压缩',   defaultTimeout: 120 },
  { key: 'web_extract',       label: '网页提取',     defaultTimeout: 360 },
  { key: 'title_generation',  label: '标题生成',     defaultTimeout: 30 },
  { key: 'skills_hub',        label: '技能中心',     defaultTimeout: 30 },
  { key: 'approval',          label: '命令审批',     defaultTimeout: 30 },
  { key: 'mcp',               label: 'MCP 工具',     defaultTimeout: 30 },
  { key: 'triage_specifier',  label: '分类细化',     defaultTimeout: 120 },
  { key: 'kanban_decomposer', label: '看板分解',     defaultTimeout: 180 },
  { key: 'profile_describer', label: '配置描述',     defaultTimeout: 60 },
  { key: 'curator',           label: '技能审查',     defaultTimeout: 600 },
  { key: 'session_search',    label: '会话搜索',     defaultTimeout: 30, deprecated: true },
];

// ====== v2 默认状态 ======
export function defaultSettings(): SettingsV2 {
  return {
    version: 2,
    providers: JSON.parse(JSON.stringify(PROVIDER_REGISTRY)),
    main: { providerId: '', model: '', port: 0 },
    fallback: [],
    auxiliary: {
      vision:            { providerId: 'auto', model: '', timeout: 120, downloadTimeout: 30 },
      compression:       { providerId: 'auto', model: '', timeout: 120 },
      web_extract:       { providerId: 'auto', model: '', timeout: 360 },
      title_generation:  { providerId: 'auto', model: '', timeout: 30 },
      skills_hub:        { providerId: 'auto', model: '', timeout: 30 },
      approval:          { providerId: 'auto', model: '', timeout: 30 },
      mcp:               { providerId: 'auto', model: '', timeout: 30 },
      triage_specifier:  { providerId: 'auto', model: '', timeout: 120 },
      kanban_decomposer: { providerId: 'auto', model: '', timeout: 180 },
      profile_describer: { providerId: 'auto', model: '', timeout: 60 },
      curator:           { providerId: 'auto', model: '', timeout: 600 },
      session_search:    { providerId: 'auto', model: '', timeout: 30 },
    },
    delegation: { providerId: '', model: '', maxIterations: 30 },
    settingsPasswordHash: '',
  };
}

// ====== 内存缓存 ======
let _settingsCache: SettingsV2 | null = null;

// ====== 加载 ======
export function loadSettings(): SettingsV2 {
  if (_settingsCache) return _settingsCache;
  const raw = storage.load(STORAGE_KEY) as unknown as Record<string, unknown> | null;
  if (raw && raw.version === 2) {
    _settingsCache = raw as unknown as SettingsV2;
    return raw as unknown as SettingsV2;
  }
  const defaults = defaultSettings();
  _settingsCache = defaults;
  return defaults;
}

/**
 * 从 AppService 加载设置（异步，启动时调用一次）
 */
export async function loadSettingsFromRust(): Promise<SettingsV2> {
  try {
    const json = await call('get_settings', {});
    if (json) {
      // 后端 get_settings() 返回 { settings: "<json_string>" }
      let settings: SettingsV2;
      if (json && typeof json === 'object' && json.settings && typeof json.settings === 'string') {
        // Tauri invoke 模式：返回 { settings: "<JSON字符串>" }
        settings = JSON.parse(json.settings);
      } else if (typeof json === 'string') {
        // HTTP fallback 模式：直接返回 JSON 字符串
        settings = JSON.parse(json);
      } else if (json && typeof json === 'object' && json.version === 2) {
        // 兜底：已经是正确的 settings 对象
        settings = json as SettingsV2;
      } else {
        // 未知格式，回退默认
        _settingsCache = defaultSettings();
        return _settingsCache;
      }
      if (settings && settings.version === 2) {
        _settingsCache = settings;
        // ❌ 不再 storage.save() — 对齐 Hermes：settings.json 只由 update_settings 写
        // storage.save() 走 set_app_data → 包裹格式 → 覆盖后端写好的正确格式
        // storage.save(STORAGE_KEY, settings);
        return settings;
      }
    }
  } catch (e) {
    console.warn('[settings-store] loadSettingsFromRust failed:', e);
  }
  _settingsCache = defaultSettings();
  return _settingsCache;
}

// ====== 保存 ======
// 🔧 修复：改为 async 并 await，确保 settings.json 写入后再调用 save_api_key
// 根治"首次配置后必须重启"问题：save_api_key 依赖 settings.json 中的 base_url
// 🔧 对齐 Hermes：去掉 storage.save() 双写，只走 update_settings 写 settings.json
// storage.save() 会走 set_app_data → 写成 {"key":"settings","value":"..."} 包裹格式
// 而 save_api_key 期望 {"providers":[...]} → 格式不匹配 → API KEY 丢失
export async function saveSettings(data: SettingsV2): Promise<void> {
  const withVersion = { ...data, version: 2 };
  _settingsCache = withVersion;
  // 🔴 恢复双写：storage.save 供同步 loadSettings() 重启后立即读取
  // 之前删除导致重启后 storage.load() 返回 null → "尚未配置模型" 误弹
  // set_app_data 包裹格式问题只影响后端 settings.json，storage.save 本身安全
  storage.save(STORAGE_KEY, withVersion);
  // 异步持久化到 AppService — 必须等待完成，否则后续 save_api_key 读不到 base_url
  try {
    await call('update_settings', withVersion);
  } catch (e) {
    console.warn('[settings-store] update_settings failed:', e);
  }
}

// ====== API Key 安全存储（加密） ======

export async function saveApiKey(providerId: string, apiKey: string): Promise<void> {
  await call('save_api_key', { provider_id: providerId, api_key: apiKey });
}

export async function loadApiKey(providerId: string): Promise<string | null> {
  try {
    return await call('load_api_key', { provider_id: providerId });
  } catch {
    return null;
  }
}

// ====== 查找 provider ======
export function findProvider(providers: ProviderEntry[], id: string): ProviderEntry | null {
  return providers.find(p => p.id === id) || null;
}

export function getProviderModels(providers: ProviderEntry[], id: string): string[] {
  const p = findProvider(providers, id);
  return p ? p.models : [];
}


// ====== Slugify & Models.dev API ======

/** 调后端 slugify_provider_name — 中文显示名 → 英文配置ID */
export async function slugifyProviderName(name: string): Promise<{ slug: string; key_env: string }> {
  const res = await call('slugify', { name });
  return res as { slug: string; key_env: string };
}

/** 查询 models.dev 获取模型能力参数 */
export async function lookupModelCapabilities(provider: string, model: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await call('models_dev_query', { provider, model });
    return res as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 列出指定 provider 在 models.dev 上的所有模型 */
export async function listProviderModels(provider: string): Promise<string[]> {
  try {
    const res = await call('models_dev_list', { provider });
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}
