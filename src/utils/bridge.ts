/**
 * IPC 桥接层 — 统一 Tauri invoke() 和 HTTP fallback
 * 
 * 桌面模式：所有调用走 HTTP API（通过 discoverPort 动态获取端口）
 * 浏览器模式（dev）：fallback 到 HTTP fetch()
 * 
 * Phase 3 核心模块 — 替代 api.js 的所有 HTTP 调用
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

// ====== HTTP Base URL ======

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
 * 桌面模式启动时调用一次
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
 * 调用后端 API（桌面和浏览器模式统一走 HTTP）
 */
export async function call(command: string, args: Record<string, any> = {}): Promise<any> {
  if (isDesktop() && !_httpBaseSet) {
    // 端口未发现，自动重试一次
    const ok = await discoverPort();
    if (!ok) {
      throw new Error('[bridge] Gateway port not discovered. Backend may not be running.');
    }
  }
  return httpFallback(command, args);
}

// ====== HTTP Fallback ======

/**
 * command → HTTP 端点映射
 */
interface CommandMapping {
  method: string;
  path: string | ((args: Record<string, any>) => string);
}

const COMMAND_HTTP_MAP: Record<string, CommandMapping> = {
  // 会话
  list_sessions:          { method: 'GET',  path: '/v1/sessions' },
  create_session:         { method: 'POST', path: '/v1/sessions' },
  delete_session:         { method: 'DELETE', path: (a) => `/v1/sessions/${a.session_id}` },
  activate_session:       { method: 'POST', path: (a) => `/v1/sessions/${a.session_id}/activate` },
  reset_session:          { method: 'POST', path: '/v1/sessions/reset' },
  get_session_detail:     { method: 'GET',  path: (a) => `/api/sessions/${a.session_id}` },
  get_session_context:    { method: 'GET',  path: (a) => `/api/sessions/${a.session_id}/context` },
  get_session_messages:   { method: 'GET',  path: (a) => `/api/sessions/${a.session_id}/messages` },
  set_session_context:    { method: 'POST', path: (a) => `/v1/sessions/${a.session_id}/context` },
  set_session_title:      { method: 'POST', path: (a) => `/v1/sessions/${a.session_id}/title` },
  search_sessions:        { method: 'GET',  path: (a) => `/api/sessions/search?q=${encodeURIComponent(a.query || '')}` },
  steer_session:          { method: 'POST', path: (a) => `/api/sessions/${a.session_id}/steer` },
  rename_session:         { method: 'PUT',  path: (a) => `/api/sessions/${a.session_id}/rename` },
  archive_session:        { method: 'POST', path: (a) => `/api/sessions/${a.session_id}/archive` },
  unarchive_session:      { method: 'POST', path: (a) => `/api/sessions/${a.session_id}/unarchive` },
  export_session:         { method: 'GET',  path: (a) => `/api/sessions/${a.session_id}/export` },

  // 配置
  get_config:             { method: 'GET',  path: '/api/config' },
  get_config_defaults:    { method: 'GET',  path: '/api/config/defaults' },
  get_config_schema:      { method: 'GET',  path: '/api/config/schema' },
  update_config:          { method: 'PUT',  path: '/api/config' },
  get_config_raw:         { method: 'GET',  path: '/api/config/raw' },
  update_config_raw:      { method: 'PUT',  path: '/api/config/raw' },

  // 技能
  list_skills:            { method: 'GET',  path: '/api/skills' },
  toggle_skill:           { method: 'PUT',  path: '/api/skills/toggle' },
  search_skills_hub:      { method: 'GET',  path: (a) => `/api/skills/hub/search?q=${encodeURIComponent(a.query || '')}` },
  install_skill:          { method: 'POST', path: '/api/skills/hub/install' },
  list_hub_skills:        { method: 'GET',  path: '/api/skills/hub/list' },
  list_hub_taps:          { method: 'GET',  path: '/api/skills/hub/taps' },
  manage_hub_tap:         { method: 'POST', path: '/api/skills/hub/taps' },

  // 工具
  list_tools:             { method: 'GET',  path: '/api/tools' },
  list_toolsets:          { method: 'GET',  path: '/api/tools/toolsets' },

  // 作业
  list_jobs:              { method: 'GET',  path: '/api/jobs' },
  create_job:             { method: 'POST', path: '/api/jobs' },
  get_job:               { method: 'GET',  path: (a) => `/api/jobs/${a.job_id}` },
  update_job:             { method: 'PATCH', path: (a) => `/api/jobs/${a.job_id}` },
  delete_job:             { method: 'DELETE', path: (a) => `/api/jobs/${a.job_id}` },
  pause_job:              { method: 'POST', path: (a) => `/api/jobs/${a.job_id}/pause` },
  resume_job:             { method: 'POST', path: (a) => `/api/jobs/${a.job_id}/resume` },
  run_job:                { method: 'POST', path: (a) => `/api/jobs/${a.job_id}/run` },

  // 设置
  get_settings:           { method: 'GET',  path: '/api/settings' },
  update_settings:        { method: 'PUT',  path: '/api/settings' },
  save_api_key:           { method: 'PUT',  path: (a) => `/api/api-key/${a.provider_id}` },
  load_api_key:           { method: 'GET',  path: (a) => `/api/api-key/${a.provider_id}` },
  slugify:                { method: 'POST', path: '/api/slugify' },
  models_dev_query:       { method: 'GET',  path: (a) => `/api/models-dev?provider=${a.provider}&model=${a.model}` },
  models_dev_list:        { method: 'GET',  path: (a) => `/api/models-dev/list?provider=${a.provider}` },

  // 存储
  get_app_data:           { method: 'GET',  path: (a) => `/api/app-data/${a.key}` },
  set_app_data:           { method: 'PUT',  path: (a) => `/api/app-data/${a.key}` },
  delete_app_data:        { method: 'DELETE', path: (a) => `/api/app-data/${a.key}` },
  migrate_app_data:       { method: 'POST', path: '/api/app-data/migrate' },

  // 中断/澄清
  abort_chat:            { method: 'POST', path: (a) => `/api/sessions/${a.session_id}/interrupt` },
  resolve_clarify:       { method: 'POST', path: '/api/clarify-response' },

  // 审批（旧接口，保留兼容）
  approve:                { method: 'POST', path: '/api/approve' },
  deny:                   { method: 'POST', path: '/api/deny' },
  // 🔴 对齐 Hermes: POST /v1/runs/{run_id}/approval — 路径传 run_id
  run_approval:           { method: 'POST', path: (a) => `/v1/runs/${a.run_id}/approval` },
  get_approval_status:    { method: 'GET',  path: '/api/approval-status' },
  submit_clarify_response:{ method: 'POST', path: '/api/clarify-response' },

  // 记忆（对齐后端 GET /api/memory?target= / DELETE /api/memory + body）
  list_memories:          { method: 'GET',  path: (a) => `/api/memory?target=${encodeURIComponent(a.target || '')}` },
  delete_memory:          { method: 'DELETE', path: '/api/memory' },

  // 环境变量
  get_env:                { method: 'GET',  path: '/api/env' },
  set_env:                { method: 'PUT',  path: '/api/env' },
  delete_env:             { method: 'DELETE', path: '/api/env' },
  reveal_env:             { method: 'POST', path: '/api/env/reveal' },

  // 网关
  gateway_status:         { method: 'GET',  path: '/api/gateway/status' },
  test_connection:        { method: 'POST', path: '/api/gateway/test-connection' },
  restart_service:        { method: 'POST', path: '/api/gateway/restart' },
  open_logs:              { method: 'POST', path: '/api/logs/open' },

  // MCP
  reload_mcp:             { method: 'POST', path: '/api/mcp/reload' },

  // Kanban
  get_kanban_board:       { method: 'GET',  path: (a) => `/api/kanban/board?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_task:        { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}?board=${encodeURIComponent(a.board || 'default')}` },
  create_kanban_task:     { method: 'POST', path: '/api/kanban/tasks' },
  update_kanban_task:     { method: 'PATCH', path: (a) => `/api/kanban/tasks/${a.task_id}` },
  delete_kanban_task:     { method: 'DELETE', path: (a) => `/api/kanban/tasks/${a.task_id}?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_stats:       { method: 'GET',  path: (a) => `/api/kanban/stats?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_assignees:   { method: 'GET',  path: (a) => `/api/kanban/assignees?board=${encodeURIComponent(a.board || 'default')}` },
  dispatch_kanban_tasks:  { method: 'POST', path: '/api/kanban/dispatch' },
  reclaim_kanban_task:    { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/reclaim` },

  // New kanban commands
  add_kanban_comment:        { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/comments` },
  create_kanban_link:        { method: 'POST', path: '/api/kanban/links' },
  delete_kanban_link:        { method: 'DELETE', path: (a) => `/api/kanban/links?parent_id=${a.parent_id}&child_id=${a.child_id}&board=${encodeURIComponent(a.board || 'default')}` },
  bulk_update_kanban_tasks:  { method: 'POST', path: '/api/kanban/tasks/bulk' },
  reassign_kanban_task:      { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/reassign` },
  get_kanban_boards:         { method: 'GET',  path: '/api/kanban/boards' },
  create_kanban_board:       { method: 'POST', path: '/api/kanban/boards' },
  update_kanban_board:       { method: 'PATCH', path: (a) => `/api/kanban/boards/${a.slug}` },
  delete_kanban_board:       { method: 'DELETE', path: (a) => `/api/kanban/boards/${a.slug}?delete_permanently=${a.delete_permanently || false}` },
  switch_kanban_board:       { method: 'POST', path: (a) => `/api/kanban/boards/${a.slug}/switch` },
  get_kanban_task_log:       { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}/log?tail=${a.tail || ''}&board=${encodeURIComponent(a.board || 'default')}` },
  poll_kanban_events:        { method: 'GET',  path: (a) => `/api/kanban/events?since=${a.since || ''}&board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_attachments:    { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}/attachments?board=${encodeURIComponent(a.board || 'default')}` },
  upload_kanban_attachment:  { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/attachments` },
  download_kanban_attachment:{ method: 'GET',  path: (a) => `/api/kanban/attachments/${a.attachment_id}` },
  delete_kanban_attachment:  { method: 'DELETE', path: (a) => `/api/kanban/attachments/${a.attachment_id}` },
  get_kanban_diagnostics:    { method: 'GET',  path: (a) => `/api/kanban/diagnostics?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_active_workers: { method: 'GET',  path: (a) => `/api/kanban/workers/active?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_run:            { method: 'GET',  path: (a) => `/api/kanban/runs/${a.run_id}` },
  terminate_kanban_run:      { method: 'POST', path: (a) => `/api/kanban/runs/${a.run_id}/terminate` },
  decompose_kanban_task:     { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/decompose` },
  specify_kanban_task:       { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/specify` },
  get_kanban_orchestration:  { method: 'GET',  path: '/api/kanban/orchestration' },
  set_kanban_orchestration:  { method: 'PUT',  path: '/api/kanban/orchestration' },
  get_kanban_profiles:       { method: 'GET',  path: '/api/kanban/profiles' },
  get_kanban_home_channels:  { method: 'GET',  path: (a) => `/api/kanban/home-channels?task_id=${a.task_id || ''}&board=${encodeURIComponent(a.board || 'default')}` },
  subscribe_kanban_home:     { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/home-subscribe/${a.platform}` },
  unsubscribe_kanban_home:   { method: 'DELETE', path: (a) => `/api/kanban/tasks/${a.task_id}/home-subscribe/${a.platform}` },
  get_kanban_config:         { method: 'GET',  path: '/api/kanban/config' },

  // 文件浏览
  files_list:               { method: 'GET',  path: (a) => `/api/files/list?path=${encodeURIComponent(a.path)}` },

  // sudo / secret 响应
  sudo_respond:             { method: 'POST', path: '/api/sudo-respond' },
  secret_respond:           { method: 'POST', path: '/api/secret-respond' },

  // 其他
  list_models:            { method: 'GET',  path: '/v1/models' },

  // 用量分析
  analytics_usage:        { method: 'GET',  path: (a) => `/api/analytics/usage?days=${a.days || 30}` },
  list_commands:          { method: 'GET',  path: '/v1/commands' },
  execute_command:        { method: 'POST', path: '/v1/command' },
  parse_messages:         { method: 'POST', path: '/api/parse-messages' },
  resolve_media:          { method: 'GET',  path: (a) => `/api/resolve-media?text=${encodeURIComponent(a.text || '')}` },
  hash_password:          { method: 'POST', path: '/api/hash-password' },
  verify_password:        { method: 'POST', path: '/api/verify-password' },
};

/**
 * HTTP fallback 实现
 */
async function httpFallback(command: string, args: Record<string, any>): Promise<any> {
  const mapping = COMMAND_HTTP_MAP[command];
  if (!mapping) {
    throw new Error(`[bridge] Unknown command: ${command}`);
  }

  const path = typeof mapping.path === 'function' ? mapping.path(args) : mapping.path;
  const url = `${_httpBase}${path}`;

  const options: RequestInit = {
    method: mapping.method,
    headers: { 'Content-Type': 'application/json' } as Record<string, string>,
  };

  // GET/DELETE 不带 body
  if (!['GET', 'DELETE'].includes(mapping.method) && Object.keys(args).length > 0) {
    // save_api_key 特殊处理：body 是纯文本
    if (command === 'save_api_key') {
      options.body = args.api_key || '';
      (options.headers as Record<string, string>)['Content-Type'] = 'text/plain';
    } else {
      options.body = JSON.stringify(args);
    }
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
