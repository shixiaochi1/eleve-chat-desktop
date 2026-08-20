/**
 * 设置数据 v2 存储 — IPC 版
 * 
 * 数据存储在 eleve-app 侧: <eleve_home>/app-data/settings.json
 * API Key 存储在全局池: <eleve_home>/providers.yaml（凭证单一权威源；.keys.enc 为已废弃遗留文件，后端已主动清理）
 * 
 * 所有 HTTP 调用已替换为 bridge.call()
 */
import { call } from './bridge';
import * as storage from './storage';

const STORAGE_KEY = 'settings';

// ====== Interfaces ======

/**
 * 单个模型条目（对齐后端 ModelEntry：per-model 上下文/输出能力参数）
 * 🔴 2026-08-10 重构：models 从 string[] 升级为带能力参数的结构化条目，
 * 对齐 Hermes CustomEndpoint.context_length 手动输入语义（Hermes 是 endpoint 级，
 * ELEVE 是 per-model 级，落在 ModelEntry 上）
 */
export interface ProviderModel {
  name: string;
  context_length: number;
  max_output: number;
  /** 🔴 P-4：能力字段回传（前端不编辑，加载/保存时保留，防保存后丢失） */
  supports_vision?: boolean | null;
  use_prompt_caching?: boolean | null;
}

export interface ProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  /** 凭证环境变量名（对齐 Hermes api_key_env_vars 首个；添加服务商时自动填入） */
  keyEnv?: string;
  transport?: string; // 协议：auto | openai_chat | anthropic_messages | codex_responses
  models: ProviderModel[];
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
  main?: { providerId: string; model: string; port: number };
  fallback: Array<{ providerId: string; model: string }>;
  auxiliary: Record<string, { providerId: string; model: string; timeout: number; downloadTimeout?: number }>;
  delegation: { providerId: string; model: string; maxIterations: number };
  settingsPasswordHash: string;
  /**
   * 桌面级默认工作目录（进程级，非 per-profile）。
   * Tauri 壳启动 eleved 时读取（resolve_eleve_cwd → spawn cwd + TERMINAL_CWD）。
   * snake_case = 与 Tauri read_default_project_dir / Hermes settings.json 字段契约一致。
   * 与 per-Agent 的 config.yaml terminal.cwd（WorkspaceSettings）分层：
   * 本字段 = 进程 cwd 种子；terminal.cwd = 会话 cwd 覆盖。
   */
  default_project_dir?: string;
  /**
   * 连接模式（对齐 Hermes connection-config 持久化）：local = Tauri 壳本地
   * spawn eleved；remote = 直连远程 eleved（--listen/--port 部署）。
   * 结构见 lib/connection.ts ConnectionState。
   */
  connection?: { mode: 'local' | 'remote'; baseUrl: string; remoteVersion?: string | null };
}

// ====== 提供商注册表预设（含 Base URL 和模型，无 Key） ======
// 🔴 2026-08-16（R3 修复）：新增本地模型 provider 预设——Ollama / LM Studio
// 默认端点（Hermes 的本地 Ollama 走 detect_local_server_type 自动探测；ELEVE
// 暂未移植探测机制，以"预设卡片 → 保存入池"等效提供入口，用户可改 URL/测试
// 连接发现模型。不进静态 PROVIDER_REGISTRY（避免第二权威源，池=唯一权威源）。
export const PROVIDER_REGISTRY: ProviderEntry[] = [
  { id: 'aliyun-bailian', name: '阿里云百炼', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', keyEnv: 'DASHSCOPE_API_KEY',
    models: [
    { name: 'qwen3.7-plus', context_length: 128000, max_output: 16384 },
    ],
  },
  // 🔴 Hermes 对齐：DeepSeek 官方（api.deepseek.com，OpenAI 兼容）
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY',
    models: [
    { name: 'deepseek-v4-pro', context_length: 0, max_output: 16384 },
    { name: 'deepseek-v4-flash', context_length: 0, max_output: 16384 },
    ],
  },
  // 本地模型：默认端点 + 无 key（Credential::None，本地服务免凭证）
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', keyEnv: '', models: [] },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', keyEnv: '', models: [] },
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
let _settingsReady = false; // 🔴 标记后端 settings 是否加载完成

// ====== 加载 ======
export function isSettingsReady(): boolean {
  return _settingsReady;
}

export function loadSettings(): SettingsV2 {
  if (_settingsCache) return _settingsCache;
  const raw = storage.load(STORAGE_KEY) as unknown as Record<string, unknown> | null;
  if (raw && raw.version === 2) {
    _settingsCache = raw as unknown as SettingsV2;
    _settingsReady = true;
    return raw as unknown as SettingsV2;
  }
  const defaults = defaultSettings();
  _settingsCache = defaults;
  // 🔴 storage 也无数据时，不算 ready — 等后端 loadSettingsFromRust 完成
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
        _settingsReady = true; // 🔴 后端 settings 加载完成
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
  _settingsReady = true; // 🔴 保存后立即标记 ready
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

// ====== 查找 provider ======
export function findProvider(providers: ProviderEntry[], id: string): ProviderEntry | null {
  return providers.find(p => p.id === id) || null;
}

export function getProviderModels(providers: ProviderEntry[], id: string): string[] {
  const p = findProvider(providers, id);
  return p ? p.models.map(m => m.name) : [];
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

// ====== Toolset 模型目录（对齐 Hermes getToolsetModels / selectToolsetModel）======

export interface ToolsetModelEntry {
  id: string;
  display: string;
  supports_edit?: boolean;
  max_reference_images?: number;
  upscale?: boolean;
}

export interface ToolsetModelsResponse {
  name: string;
  has_models: boolean;
  provider?: string | null;
  plugin?: string | null;
  models: ToolsetModelEntry[];
  current?: string | null;
  default?: string | null;
}

/** 获取 toolset 后端模型目录（WS toolset.models；profile 由 sendRpc 自动盖章） */
export async function getToolsetModels(toolset: string): Promise<ToolsetModelsResponse | null> {
  try {
    const res = await call('toolset_models', { toolset });
    return res as ToolsetModelsResponse;
  } catch {
    return null;
  }
}

/** 选择并持久化 toolset 模型（WS toolset.model.select；profile 由 sendRpc 自动盖章） */
export async function selectToolsetModel(toolset: string, model: string): Promise<{ ok: boolean; name: string; model: string }> {
  const res = await call('toolset_model_select', { toolset, model });
  return res as { ok: boolean; name: string; model: string };
}

// ====== 服务商聚合目录（2026-08-20：LLM 池 + 生图 + 生视频 三源按域）======

export interface DirectoryModelEntry {
  id: string;
  display?: string;
  available?: boolean;
  supports_edit?: boolean;
  upscale?: boolean;
  context_length?: number;
  max_output?: number;
  supports_vision?: boolean | null;
  modalities?: string[];
}

export interface DirectoryProviderEntry {
  id: string;
  name: string;
  domains: {
    chat: DirectoryModelEntry[];
    image: DirectoryModelEntry[];
    video: DirectoryModelEntry[];
  };
  /** ELEVE 媒体生成预设的 MXAPI 通道分类元数据（卡片展开「能力全览」） */
  mxapi?: { channels: MxapiChannelGroup[] };
}

export interface ProvidersDirectoryResponse {
  providers: DirectoryProviderEntry[];
  current: { image: string; video: string };
}

/** 服务商聚合目录（WS providers.directory；三源按域：chat=LLM 池 / image+video=媒体 registry） */
export async function getProvidersDirectory(): Promise<ProvidersDirectoryResponse | null> {
  try {
    const res = await call('providers.directory', {});
    return res as ProvidersDirectoryResponse;
  } catch {
    return null;
  }
}

/** 媒体 provider 选择（WS media.provider.select；分域写 config image_gen.provider / video_gen.provider） */
export async function selectMediaProvider(
  usage: 'image' | 'video',
  provider: string,
): Promise<{ ok: boolean; usage: string; provider: string }> {
  const res = await call('media.provider.select', { usage, provider });
  return res as { ok: boolean; usage: string; provider: string };
}

// =============================================================================
// 媒体 provider 子配置读写（2026-08-20：ELEVE 媒体生成卡片展开设置）
// 读：config.get（key 点号 → JSON pointer）；写：config.set（单键 update_value）
// 键示例：image_gen.mxapi.model / image_gen.mxapi.channel / image_gen.mxapi.base_url
// =============================================================================

/** 读取媒体 provider 子配置（如 image_gen.mxapi.model；返回 JSON 值或 null） */
export async function getMediaConfigValue(key: string): Promise<unknown> {
  try {
    return await call('config.get', { key });
  } catch {
    return null;
  }
}

/** 写入媒体 provider 子配置（单键原子更新：内存 + 磁盘 + notify） */
export async function setMediaConfigValue(
  key: string,
  value: unknown,
): Promise<{ ok: boolean; key: string }> {
  const res = await call('config.set', { key, value });
  return res as { ok: boolean; key: string };
}

/** MXAPI 通道分类（directory 附加元数据，卡片展开「能力全览」） */
export interface MxapiChannelGroup {
  group: string;
  models: { id: string; display: string; apiPath: string; implemented: boolean }[];
}

// =============================================================================
// Phase P5: 全局 Provider 池 CRUD（经 WS RPC，对齐 P3 后端端点）
// =============================================================================

export interface PoolProvider {
  id: string;
  name: string | null;
  base_url: string;
  transport: string;
  timeout: number;
  default_max_output: number;
  has_key: boolean;
  credential_type: string;
  models: { name: string; context_length: number; max_output: number; supports_vision?: boolean | null; use_prompt_caching?: boolean | null }[];
  source?: string;
}

/** 从全局池列出所有 Provider（脱敏） */
export async function listPoolProviders(): Promise<PoolProvider[]> {
  try {
    const res = await call('provider_list', {}) as { providers?: PoolProvider[] };
    return res.providers || [];
  } catch {
    return [];
  }
}

/** 创建/更新 Provider（F3：失败抛错，调用方 toast 提示） */
export async function upsertPoolProvider(entry: Record<string, unknown>): Promise<PoolProvider | null> {
  const res = await call('provider_upsert', entry) as { provider?: PoolProvider };
  return res.provider || null;
}

/** 删除 Provider（F3：失败抛错，调用方 toast 提示） */
export async function removePoolProvider(providerId: string): Promise<{ removed: boolean; warnings: string[] }> {
  const res = await call('provider_remove', { provider_id: providerId }) as { removed?: boolean; warnings?: string[] };
  return { removed: res.removed || false, warnings: res.warnings || [] };
}

/** 保存 Provider API Key（F3：失败抛错，调用方 toast 提示） */
export async function savePoolProviderKey(providerId: string, apiKey: string): Promise<boolean> {
  await call('provider_save_key', { provider_id: providerId, api_key: apiKey });
  return true;
}

/** 清除 Provider 凭证（F3：失败抛错，调用方 toast 提示） */
export async function disconnectPoolProvider(providerId: string): Promise<boolean> {
  await call('provider_disconnect', { provider_id: providerId });
  return true;
}

// =============================================================================
// provider.test — 测试端点连通性 + 发现模型（对齐 Hermes validate_custom_endpoint）
// =============================================================================

export interface ProviderTestResult {
  ok: boolean;
  reachable: boolean;
  message: string;
  models: string[];
}

/** 探测端点 {base_url}/models：可达性 + key 有效性 + 发现模型目录 */
export async function testProviderConnection(baseUrl: string, apiKey?: string): Promise<ProviderTestResult> {
  try {
    const res = await call('provider_test', {
      base_url: baseUrl,
      ...(apiKey ? { api_key: apiKey } : {}),
    }) as ProviderTestResult;
    return res;
  } catch (e) {
    return { ok: false, reachable: false, message: (e as Error).message || '测试失败', models: [] };
  }
}
