/**
 * IPC 桥接层 — WS JSON-RPC 优先，Kanban 走 HTTP（对齐 Hermes）
 * 
 * 桌面模式：主通道 WS JSON-RPC，Kanban 走 REST API
 * 浏览器模式（dev）：fallback 到 HTTP fetch()
 * 
 * Phase 5: 删除非 Kanban HTTP fallback，主通道 100% WS
 */

// ====== 环境检测 ======

let _isDesktop: boolean | null = null;

/**
 * 检测是否运行在 Tauri 桌面环境
 * 优先检测 __TAURI_INTERNALS__（Tauri v2 标准注入）
 */
export function isDesktop(): boolean {
  if (_isDesktop !== null) return _isDesktop;
  _isDesktop = typeof window !== 'undefined' && 
    ((window as any).__TAURI_INTERNALS__ !== undefined || (window as any).__TAURI__ !== undefined);
  return _isDesktop;
}

// ====== HTTP Base URL（仅 Kanban 使用） ======

let _httpBase = 'http://127.0.0.1:3001';
let _httpBaseSet = false;

/**
 * 设置 HTTP base URL
 */
export function setHttpBase(url: string): void {
  _httpBase = url;
  _httpBaseSet = true;
}

/**
 * 获取当前 HTTP base URL
 */
export function getHttpBase(): string {
  return _httpBase;
}

/**
 * 通过 Tauri IPC 发现网关端口，设置 _httpBase
 * 桌面模式启动时调用一次（Kanban HTTP 需要）
 */
export async function discoverPort(maxRetries = 50, delayMs = 200): Promise<boolean> {
  if (!isDesktop()) return true;
  const { invoke } = await import('@tauri-apps/api/core');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const port = await invoke('get_gateway_port') as number;
      if (port && typeof port === 'number' && port > 0) {
        _httpBase = `http://127.0.0.1:${port}`;
        _httpBaseSet = true;
        console.log('[bridge] Gateway port discovered:', port);
        return true;
      }
    } catch (err) {
      console.warn(`[bridge] discoverPort attempt ${i + 1}/${maxRetries} failed:`, err);
    }
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error('[bridge] discoverPort failed after', maxRetries, 'retries');
  return false;
}

// ====== 核心调用 ======

/**
 * command → WS JSON-RPC method 映射（不含 Kanban，Kanban 走 HTTP 对齐 Hermes）
 */
const COMMAND_TO_WS_METHOD: Record<string, string> = {
  // A类：已有 WS 方法（16个）
  steer_session:          'session.steer',
  abort_chat:             'session.interrupt',
  sudo_respond:           'sudo.respond',
  secret_respond:         'secret.respond',
  list_sessions:          'session.list',
  create_session:         'session.create',
  delete_session:         'session.delete',
  activate_session:       'session.activate',
  set_session_title:      'session.title',
  get_config:             'config.get',
  update_config:          'config.set.raw',
  list_models:            'model.options',
  save_api_key:           'model.save_key',
  list_commands:          'commands.catalog',
  execute_command:        'command.dispatch',
  submit_clarify_response:'clarify.respond',

  // B类：后端已新增 WS 方法
  list_jobs:              'jobs.list',
  create_job:             'jobs.create',
  update_job:             'jobs.update',
  delete_job:             'jobs.delete',
  pause_job:              'jobs.pause',
  resume_job:             'jobs.resume',
  run_job:                'jobs.run',
  list_skills:            'skills.list',
  toggle_skill:           'skills.toggle',
  search_skills_hub:      'skills.hub.search',
  install_skill:          'skills.hub.install',
  list_hub_skills:        'skills.hub.list',
  list_hub_taps:          'skills.hub.taps',
  manage_hub_tap:         'skills.hub.tap.manage',
  list_tools:             'tools.list',
  list_toolsets:          'tools.toolsets',
  list_memories:          'memory.list',
  delete_memory:          'memory.delete',
  get_settings:           'settings.get',
  update_settings:        'settings.update',
  reload_mcp:             'mcp.reload',
  get_app_data:           'app_data.get',
  set_app_data:           'app_data.set',
  delete_app_data:        'app_data.delete',
  analytics_usage:        'analytics.usage',

  // C类：Session 补充 + Config 补充 + Gateway + Auth + Utils
  get_session_context:    'session.context.get',
  set_session_context:    'session.context.set',
  get_session_messages:   'session.history',
  search_sessions:        'session.search',
  export_session:         'session.export',
  rename_session:         'session.rename',
  archive_session:        'session.archive',
  unarchive_session:      'session.unarchive',
  reset_session:          'session.reset',
  get_config_defaults:    'config.defaults',
  get_config_schema:      'config.schema',
  get_config_raw:         'config.raw',
  update_config_raw:      'config.set.raw',
  gateway_status:         'gateway.status',
  restart_service:        'gateway.restart',
  open_logs:              'gateway.open_logs',
  test_connection:        'gateway.test_connection',
  hash_password:          'auth.hash_password',
  verify_password:        'auth.verify_password',
  load_api_key:           'model.load_key',
  slugify:                'utils.slugify',
  models_dev_query:       'models_dev.query',
  models_dev_list:        'models_dev.list',
  resolve_media:          'media.resolve',
  migrate_app_data:       'app_data.migrate',
  files_list:             'files.list',
  projects_tree:          'projects.tree',
  projects_project_sessions: 'projects.project_sessions',
};

/**
 * 参数适配器 — HTTP 命令参数 → WS 方法参数
 */
function adaptParams(command: string, args: Record<string, any>): Record<string, any> {
  switch (command) {
    case 'update_config':
      // HTTP: {config: {...}} 或 {yaml_text} → WS config.set.raw: {yaml_text}
      // config.set 只支持单 key+value，嵌套对象需转 yaml_text 走 config.set.raw
      if (args.yaml_text) return { yaml_text: args.yaml_text };
      if (args.config) return { yaml_text: JSON.stringify(args.config) };
      return { yaml_text: JSON.stringify(args) };
    case 'execute_command':
      // HTTP: {command} → WS: {name, arg, session_id}
      return { name: args.command, arg: '', session_id: '' };
    case 'submit_clarify_response':
      // HTTP: {clarify_id, response} → WS: {request_id, answer}
      return { request_id: args.clarify_id, answer: args.response };
    case 'save_api_key':
      // HTTP: {provider_id, api_key} → WS: {slug, api_key}
      return { slug: args.provider_id, api_key: args.api_key };
    default:
      return args;
  }
}

/**
 * 调用后端命令（Phase 5: WS-only，Kanban 走 HTTP 对齐 Hermes）
 */
export async function call(command: string, args: Record<string, any> = {}): Promise<any> {
  const wsMethod = COMMAND_TO_WS_METHOD[command];

  if (wsMethod) {
    // 参数适配
    const adapted = adaptParams(command, args);
    // A类/B类/C类：走 WS JSON-RPC
    const { getWsClient } = await import('../services/ws-client');
    const wsClient = getWsClient();
    return wsClient.sendRpc(wsMethod, adapted);
  }

  // Kanban 命令：走 HTTP REST API（对齐 Hermes，不走 WS JSON-RPC）
  if (KANBAN_HTTP_MAP[command]) {
    if (isDesktop() && !_httpBaseSet) {
      const ok = await discoverPort();
      if (!ok) {
        throw new Error('[bridge] Gateway port not discovered. Backend may not be running.');
      }
    }
    return kanbanHttpFallback(command, args);
  }

  // 无映射：报错
  throw new Error(`[bridge] No WS method mapping for command: ${command}`);
}

// ====== Kanban HTTP（对齐 Hermes：Kanban 走 REST API 不走 WS） ======

interface KanbanMapping {
  method: string;
  path: string | ((args: Record<string, any>) => string);
}

const KANBAN_HTTP_MAP: Record<string, KanbanMapping> = {
  // Board
  get_kanban_board:       { method: 'GET',  path: (a) => `/api/kanban/board?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_boards:      { method: 'GET',  path: '/api/kanban/boards' },
  create_kanban_board:    { method: 'POST', path: '/api/kanban/boards' },
  update_kanban_board:    { method: 'PATCH', path: (a) => `/api/kanban/boards/${a.slug}` },
  delete_kanban_board:    { method: 'DELETE', path: (a) => `/api/kanban/boards/${a.slug}?delete_permanently=${a.delete_permanently || false}` },
  switch_kanban_board:    { method: 'POST', path: (a) => `/api/kanban/boards/${a.slug}/switch` },

  // Task CRUD
  get_kanban_task:        { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}?board=${encodeURIComponent(a.board || 'default')}` },
  create_kanban_task:     { method: 'POST', path: '/api/kanban/tasks' },
  update_kanban_task:     { method: 'PATCH', path: (a) => `/api/kanban/tasks/${a.task_id}` },
  delete_kanban_task:     { method: 'DELETE', path: (a) => `/api/kanban/tasks/${a.task_id}?board=${encodeURIComponent(a.board || 'default')}` },
  bulk_update_kanban_tasks: { method: 'POST', path: '/api/kanban/tasks/bulk' },

  // Task operations
  get_kanban_stats:       { method: 'GET',  path: (a) => `/api/kanban/stats?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_assignees:   { method: 'GET',  path: (a) => `/api/kanban/assignees?board=${encodeURIComponent(a.board || 'default')}` },
  dispatch_kanban_tasks:  { method: 'POST', path: '/api/kanban/dispatch' },
  reclaim_kanban_task:    { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/reclaim` },
  add_kanban_comment:     { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/comments` },
  create_kanban_link:     { method: 'POST', path: '/api/kanban/links' },
  delete_kanban_link:     { method: 'DELETE', path: (a) => `/api/kanban/links?parent_id=${a.parent_id}&child_id=${a.child_id}&board=${encodeURIComponent(a.board || 'default')}` },
  reassign_kanban_task:   { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/reassign` },

  // Task log / events
  get_kanban_task_log:    { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}/log?tail=${a.tail || ''}&board=${encodeURIComponent(a.board || 'default')}` },
  poll_kanban_events:     { method: 'GET',  path: (a) => `/api/kanban/events?since=${a.since || ''}&board=${encodeURIComponent(a.board || 'default')}` },

  // Attachments
  get_kanban_attachments:     { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}/attachments?board=${encodeURIComponent(a.board || 'default')}` },
  upload_kanban_attachment:   { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/attachments` },
  download_kanban_attachment: { method: 'GET',  path: (a) => `/api/kanban/attachments/${a.attachment_id}` },
  delete_kanban_attachment:   { method: 'DELETE', path: (a) => `/api/kanban/attachments/${a.attachment_id}` },

  // Workers / runs / diagnostics
  get_kanban_diagnostics:     { method: 'GET',  path: (a) => `/api/kanban/diagnostics?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_active_workers:  { method: 'GET',  path: (a) => `/api/kanban/workers/active?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_run:             { method: 'GET',  path: (a) => `/api/kanban/runs/${a.run_id}` },
  terminate_kanban_run:       { method: 'POST', path: (a) => `/api/kanban/runs/${a.run_id}/terminate` },

  // Decompose / specify / orchestration
  decompose_kanban_task:      { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/decompose` },
  specify_kanban_task:        { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/specify` },
  get_kanban_orchestration:   { method: 'GET',  path: '/api/kanban/orchestration' },
  set_kanban_orchestration:   { method: 'PUT',  path: '/api/kanban/orchestration' },

  // Profiles / home channels / config
  get_kanban_profiles:        { method: 'GET',  path: '/api/kanban/profiles' },
  get_kanban_home_channels:   { method: 'GET',  path: (a) => `/api/kanban/home-channels?task_id=${a.task_id || ''}&board=${encodeURIComponent(a.board || 'default')}` },
  subscribe_kanban_home:      { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/home-subscribe/${a.platform}` },
  unsubscribe_kanban_home:    { method: 'DELETE', path: (a) => `/api/kanban/tasks/${a.task_id}/home-subscribe/${a.platform}` },
  get_kanban_config:          { method: 'GET',  path: '/api/kanban/config' },
};

/**
 * Kanban HTTP fallback（仅 Kanban 命令使用，对齐 Hermes REST API）
 */
async function kanbanHttpFallback(command: string, args: Record<string, any>): Promise<any> {
  const mapping = KANBAN_HTTP_MAP[command];
  if (!mapping) {
    throw new Error(`[bridge] Unknown Kanban command: ${command}`);
  }

  const path = typeof mapping.path === 'function' ? mapping.path(args) : mapping.path;
  const url = `${_httpBase}${path}`;

  const options: RequestInit = {
    method: mapping.method,
    headers: { 'Content-Type': 'application/json' } as Record<string, string>,
  };

  // GET/DELETE 不带 body
  if (!['GET', 'DELETE'].includes(mapping.method) && Object.keys(args).length > 0) {
    options.body = JSON.stringify(args);
  }

  const resp = await fetch(url, options);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }

  // 204 No Content
  if (resp.status === 204) return null;

  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ====== 就绪状态 ======

/**
 * 检查 AppService 是否已初始化就绪
 * HTTP health check
 */
export async function isReady(): Promise<boolean> {
  try {
    const resp = await fetch(`${_httpBase}/v1/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}
