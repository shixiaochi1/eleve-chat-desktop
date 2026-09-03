import * as yaml from 'js-yaml';

/**
 * IPC 桥接层 — WS JSON-RPC 统一通道
 *
 * 所有前端操作统一走 WS JSON-RPC（含配置、Provider、Settings）。
 * Kanban 走 HTTP REST API（对齐 Hermes，独立路由）。
 *
 * WS 在 App 启动时即建立，不存在“WS 未连”场景。
 * WS 天然支持 params.profile 多 Profile 路由。
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

// ====== HTTP Base URL（Kanban + 配置类使用） ======

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

/** HTTP base 是否已 discover（2026-08-29 media.ts 相对 URL 拼接用） */
export function isHttpBaseSet(): boolean {
  return _httpBaseSet;
}

/**
 * 🔴 2026-08-20：通用 gateway HTTP 调用（媒体凭据等无 WS 方法的端点走 HTTP）。
 * 自动：桌面端 discoverPort（未发现时抛错）→ profile 前缀（非 default 加 /p/<profile>/）→
 * GET/DELETE 无 body、其余 JSON。返回解析后的 JSON（非 2xx 抛 Error 带后端 message）。
 */
export async function httpJson(path: string, method = 'GET', body?: unknown): Promise<any> {
  if (isDesktop() && !_httpBaseSet) {
    const ok = await discoverPort();
    if (!ok) {
      throw new Error('[bridge] Gateway port not discovered. Backend may not be running.');
    }
  }
  const { getWsActiveProfile } = await import('../services/ws-client');
  const profile = getWsActiveProfile();
  const profilePrefix = profile ? `/p/${profile}` : '';
  const url = `${_httpBase}${profilePrefix}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' } as Record<string, string>,
  };
  if (body !== undefined && !['GET', 'DELETE'].includes(method)) {
    options.body = JSON.stringify(body);
  }
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new Error(err?.error?.message || err?.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

/**
 * 通过 Tauri IPC 发现网关端口，设置 _httpBase
 * 桌面模式启动时调用一次（Kanban + 配置类 HTTP 需要）
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
  // A类：已有 WS 方法
  sudo_respond:           'sudo.respond',
  secret_respond:         'secret.respond',
  list_sessions:          'session.list',
  search_sessions:        'session.search',
  create_session:         'session.create',
  delete_session:         'session.delete',
  activate_session:       'session.activate',
  // 配置类（原 HTTP，已统一迁 WS——WS 天然支持 profile 路由）
  get_config:             'config.get',
  update_config:          'config.set.raw',
  replace_config:         'config.replace',
  // 🔴 2026-08-20 媒体设置单键写入（config.set = update_value 内存+磁盘原子更新，
  //    与 config.set.raw 整段 yaml 不同：key="image_gen.mxapi.model" + value 单键）
  config_set:             'config.set',
  // save_api_key 已删除：与 provider_save_key 重复映射同一 WS 方法，唯一消费方 saveApiKey() 已死
  get_settings:           'settings.get',
  update_settings:        'settings.update',
  list_models:            'model.options',
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
  search_skills_hub:      'skills.hub.search',
  install_skill:          'skills.hub.install',
  list_hub_skills:        'skills.hub.list',
  list_hub_taps:          'skills.hub.taps',
  manage_hub_tap:         'skills.hub.tap.manage',
  list_tools:             'tools.list',
  // 多 Profile 管理（F9+ Profile 选择器）
  list_profiles:          'profiles.list',
  get_active_profile:     'profiles.get_active',
  create_profile:         'profiles.create',
  delete_profile:         'profiles.delete',
  // 🔴 2026-09-04 Bot Mode（bot 联动 + 群聊，对齐 Hermes bot-mode）
  bots_roster:            'bots.roster',
  bot_chat_ensure:        'bot.chat.ensure',
  bot_chats_list:         'bot.chats.list',
  bot_rooms_create:       'bot.rooms.create',
  bot_rooms_list:         'bot.rooms.list',
  bot_rooms_state:        'bot.rooms.state',
  bot_rooms_send:         'bot.rooms.send',
  bot_rooms_events:       'bot.rooms.events',
  bot_rooms_members:      'bot.rooms.members',
  bot_rooms_rename:       'bot.rooms.rename',
  bot_rooms_stop:         'bot.rooms.stop',
  bot_rooms_disband:      'bot.rooms.disband',
  // 🔴 2026-08-02 断线修复：Agent 编辑卡（EditAgentDialog）读/写 SOUL/MEMORY/USER + 主题色/昵称
  // 缺映射 → bridge 抛 "No WS/HTTP mapping" → 用户档案空白、保存失败
  get_soul:               'profiles.get_soul',
  set_soul:               'profiles.set_soul',
  get_memory:             'profiles.get_memory',
  set_memory:             'profiles.set_memory',
  get_user:               'profiles.get_user',
  set_user:               'profiles.set_user',
  set_color:              'profiles.set_color',
  set_avatar:             'profiles.set_avatar',
  set_avatar_key:         'profiles.set_avatar_key',
  get_avatar:             'profiles.get_avatar',
  set_display_name:       'profiles.set_display_name',
  // Phase P5: 全局 Provider 池 CRUD（WS RPC，对齐 P3 后端端点）
  provider_list:          'provider.list',
  provider_upsert:        'provider.upsert',
  provider_remove:        'provider.remove',
  provider_save_key:      'provider.save_key',
  provider_disconnect:    'provider.disconnect',
  provider_switch:        'provider.switch',
  provider_test:          'provider.test',
  // 🔴 2026-08-10 图像生成目录（并行开发者漏注册 → call 抛 No WS/HTTP mapping → 空态）
  toolset_models:         'toolset.models',
  toolset_model_select:   'toolset.model.select',
  // 🔴 2026-08-20 服务商聚合目录 + 媒体 provider 选择（并行开发者漏注册 →
  //    媒体生成区域永远空态 + 设为引擎失败；后端 WS 方法已存在）
  'providers.directory':   'providers.directory',
  'media.provider.select': 'media.provider.select',
  list_memories:          'memory.list',
  delete_memory:          'memory.delete',
  reset_memory:           'memory.reset',
  reload_mcp:             'reload.mcp',
  get_app_data:           'app_data.get',
  set_app_data:           'app_data.set',
  delete_app_data:        'app_data.delete',
  analytics_usage:        'analytics.usage',

  // C类：Session 补充 + Config 补充 + Gateway + Auth + Utils
  // 🔴 2026-08-10 对齐 Hermes：ContextBar 上下文监控改走 session.context_breakdown
  //（context_used = 实测 last_prompt_tokens 优先 + 估算兜底，永不为 0；旧 session.context.get
  // 是累计 input+output 语义，显示 0/虚高）
  get_session_context:    'session.context_breakdown',
  get_session_messages:   'session.history',
  export_session:         'session.export',
  rename_session:         'session.rename',
  archive_session:        'session.archive',
  unarchive_session:      'session.unarchive',
  reset_session:          'session.reset',
  // F1: 会话管理补全（后端已就绪，前端断线）
  branch_session:         'session.branch',
  compress_session:       'session.compress',
  undo_session_turn:      'session.undo',
  get_session_usage:      'session.usage',
  // F2: 进程与委托管理（后端已就绪，前端零消费）
  process_list:           'process.list',
  process_kill:           'process.kill',
  process_stop:           'process.stop',
  delegation_pause:       'delegation.pause',
  delegation_status:      'delegation.status',
  subagent_interrupt:     'subagent.interrupt',
  // 🔴 2026-08-15 编排对齐：向运行中子 Agent 下达指令（步边界注入）
  subagent_steer:         'subagent.steer',
  // 🔴 2026-08-15 前端普查待办①：回读子会话消息历史（对齐 DSH subagent.history）
  subagent_history:       'subagent.history',
  // 🔴 2026-08-15 DSH GoalBar 对齐：会话目标查询/暂停/恢复/清除（goal.* WS RPC）
  goal_status:            'goal.status',
  goal_pause:             'goal.pause',
  goal_resume:            'goal.resume',
  goal_clear:             'goal.clear',
  todo_status:            'todo.status',
  // 🔴 2026-08-16 DSH QueueDock 对齐：会话排队队列（后端权威 Inbox.followup 投影）
  queue_status:           'queue.status',
  queue_remove:           'queue.remove',
  queue_edit:             'queue.edit',
  queue_steer:            'queue.steer',
  // F3: 输入增强（后端已就绪）
  complete_path:          'complete.path',
  // 🔴 2026-08-18 画布 × ELEVE 集成 + 2026-08-19 根治修订：画布按钮 →
  // canvas.toggle RPC（后端 canvas_toggle_intent 切换语义：画布已连 → 推
  // shell.toggle_canvas 帧给壳按可见性隐藏/显示，不新开窗口；未连 → 推
  // shell.open_canvas 帧开窗。单例硬约束在壳，绝不无限开窗）
  canvas_toggle:           'canvas.toggle',
  canvas_open:            'canvas.open',
  // F4: 信息面板（后端已就绪）
  learning_frames:        'learning.frames',
  learning_detail:        'learning.detail',
  learning_delete:        'learning.delete',
  learning_edit:          'learning.edit',
  rollback_list:          'rollback.list',
  rollback_diff:          'rollback.diff',
  rollback_restore:       'rollback.restore',
  update_config_raw:      'config.set.raw',
  // config_delete_provider 已删除：池是唯一权威源，不再写 config.yaml providers段
  gateway_status:         'gateway.status',
  system_home:            'system.home',
  restart_service:        'gateway.restart',
  open_logs:              'gateway.open_logs',
  test_connection:        'gateway.test_connection',
  hash_password:          'auth.hash_password',
  verify_password:        'auth.verify_password',
  slugify:                'utils.slugify',
  models_dev_query:       'models_dev.query',
  resolve_media:          'media.resolve',
  migrate_app_data:       'app_data.migrate',
  files_list:             'files.list',
  files_diff:             'files.diff',
  files_status:           'files.status',
  files_rename:           'files.rename',
  files_delete:           'files.delete',
  projects_tree:          'projects.tree',
  projects_project_sessions: 'projects.project_sessions',
  projects_create:        'projects.create',
  // 🔴 2026-09-04 P0 连线修复：后端 projects.delete（ws/mod.rs:1538）早已就绪，
  // 前端 ProjectTreePanel 删除菜单却调用未注册的 projects_delete → bridge 抛
  // "No WS/HTTP mapping for command: projects_delete"（删除功能全死）。
  projects_delete:        'projects.delete',
  projects_update:        'projects.update',
  projects_add_folder:    'projects.add_folder',
  projects_remove_folder: 'projects.remove_folder',
  projects_set_primary:   'projects.set_primary',
  projects_set_active:    'projects.set_active',
  projects_archive:       'projects.archive',
  // ── git worktree/branch（对齐 Hermes desktop-git worktree/branch 面）──
  git_worktree_list:      'git.worktree_list',
  git_worktree_add:       'git.worktree_add',
  git_worktree_remove:    'git.worktree_remove',
  git_branch_list:        'git.branch_list',
  git_base_branch_list:   'git.base_branch_list',
  git_branch_switch:      'git.branch_switch',
  // ── llm.oneshot（对齐 Hermes llm.oneshot；项目 idea 生成等辅助任务）──
  llm_oneshot:            'llm.oneshot',
};

/**
 * 参数适配器 — HTTP 命令参数 → WS 方法参数
 */
function adaptParams(command: string, args: Record<string, any>): Record<string, any> {
  switch (command) {
    case 'execute_command':
      // HTTP: {command, args?, session_id?} → WS: {name, arg, session_id}
      // 🔴 P1-2.8: 透传 args 和 session_id（旧版硬编码空串 → 终端命令参数静默丢失）
      return { name: args.command, arg: args.args || '', session_id: args.session_id || '' };
    case 'submit_clarify_response':
      // HTTP: {clarify_id, response} → WS: {request_id, answer}
      // 🔴 P0-2: 透传 profile（宫格模式 ClarifyCard 显式传归属 Agent，剥掉会被 sendRpc 盖焦点 Agent 章 → 串台）
      return { request_id: args.clarify_id, answer: args.response, ...(args.profile ? { profile: args.profile } : {}) };
    case 'update_config': {
      // {config:{...}} → {yaml_text: string}（WS config.set.raw 期望 yaml_text）
      // 🔴 M-1/M-2 修复：显式透传 targetProfile（宫格选模型写目标 Agent 的 config）——
      // sendRpc 盖章不覆盖已有 params.profile（ws-client.ts S1），此处不传则盖 activeProfile。
      if (args.yaml_text) return args;
      const obj = args.config ?? args;
      const out: Record<string, unknown> = { yaml_text: yaml.dump(obj, { indent: 2, lineWidth: 120, noRefs: true }) };
      if (args.profile) out.profile = args.profile;
      return out;
    }

    default:
      return args;
  }
}

/**
 * 调用后端命令（统一走 WS JSON-RPC，Kanban 走 HTTP）
 */
/**
 * 重启后端服务（对齐 Hermes /restart detached 语义）
 *
 * 桌面模式（Tauri）：先 mark_restarting（wait 线程见标记 → 自动拉起新 eleved，
 * 托管重启：新进程成为 Tauri child，关窗可杀、不误报"意外退出"），再发 gateway.restart RPC。
 * 后端见 ELEVE_DESKTOP=1 不再 self-spawn，交给 Tauri 重启。
 * 非桌面（CLI/浏览器 dev）：mark_restarting 失败被 catch → 后端无 ELEVE_DESKTOP → self-spawn。
 */
export async function restartService(): Promise<void> {
  if (isDesktop()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('mark_restarting');
    } catch (err) {
      console.warn('[bridge] mark_restarting failed, backend will self-spawn:', err);
    }
  }
  await call('restart_service', {});
}

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
  throw new Error(`[bridge] No WS/HTTP mapping for command: ${command}`);
}

// ====== Kanban HTTP（对齐 Hermes：Kanban 走 REST API 不走 WS） ======

interface KanbanMapping {
  method: string;
  path: string | ((args: Record<string, any>) => string);
}

const KANBAN_HTTP_MAP: Record<string, KanbanMapping> = {
  // Board
  get_kanban_board:       { method: 'GET',  path: (a) => `/api/kanban/board?board=${encodeURIComponent(a.board || 'default')}&include_archived=${a.include_archived ? 'true' : 'false'}` },
  get_kanban_boards:      { method: 'GET',  path: '/api/kanban/boards' },
  create_kanban_board:    { method: 'POST', path: '/api/kanban/boards' },
  update_kanban_board:    { method: 'PATCH', path: (a) => `/api/kanban/boards/${a.slug}` },
  delete_kanban_board:    { method: 'DELETE', path: (a) => `/api/kanban/boards/${a.slug}?delete_permanently=${a.delete_permanently || false}` },
  switch_kanban_board:    { method: 'POST', path: (a) => `/api/kanban/boards/${a.slug}/switch` },

  // Task CRUD
  get_kanban_task:        { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}?board=${encodeURIComponent(a.board || 'default')}` },
  create_kanban_task:     { method: 'POST', path: '/api/kanban/tasks' },
  // 🔴 P0-4：新建前工作量估算（对齐 Hermes estimateNew）
  estimate_kanban_task:   { method: 'POST', path: '/api/kanban/tasks/estimate' },
  // 🔴 P0-4b：任务详情估算（对齐 Hermes /tasks/{id}/estimate，抽屉 EstimateSection）
  estimate_kanban_task_by_id: { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/estimate?board=${encodeURIComponent(a.board || 'default')}` },
  update_kanban_task:     { method: 'PATCH', path: (a) => `/api/kanban/tasks/${a.task_id}` },
  delete_kanban_task:     { method: 'DELETE', path: (a) => `/api/kanban/tasks/${a.task_id}?board=${encodeURIComponent(a.board || 'default')}` },
  bulk_update_kanban_tasks: { method: 'POST', path: '/api/kanban/tasks/bulk' },

  // Task operations
  get_kanban_stats:       { method: 'GET',  path: (a) => `/api/kanban/stats?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_assignees:   { method: 'GET',  path: (a) => `/api/kanban/assignees?board=${encodeURIComponent(a.board || 'default')}` },
  dispatch_kanban_tasks:  { method: 'POST', path: '/api/kanban/dispatch' },
  reclaim_kanban_task:    { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/reclaim` },
  // 🔴 对齐 Hermes 2026-08 一等评审生命周期：request_review（running/ready→review，
  //   force=true 显式人工覆盖）、request_changes（评审退回返工）、reopen_review（评审重开）
  request_kanban_review:  { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/review` },
  request_kanban_changes: { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/review/changes` },
  reopen_kanban_review:   { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/review/reopen` },
  add_kanban_comment:     { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/comments` },
  create_kanban_link:     { method: 'POST', path: '/api/kanban/links' },
  delete_kanban_link:     { method: 'DELETE', path: (a) => `/api/kanban/links?parent_id=${a.parent_id}&child_id=${a.child_id}&board=${encodeURIComponent(a.board || 'default')}` },
  reassign_kanban_task:   { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/reassign` },

  // Task log / events
  get_kanban_task_log:    { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}/log?tail=${a.tail || ''}&board=${encodeURIComponent(a.board || 'default')}` },
  // JSON 轮询端点是 /api/kanban/events/poll；/api/kanban/events 是 SSE stream（EventSource 专用），不能按 JSON 消费
  poll_kanban_events:     { method: 'GET',  path: (a) => `/api/kanban/events/poll?since=${a.since || ''}&board=${encodeURIComponent(a.board || 'default')}` },

  // Attachments
  get_kanban_attachments:     { method: 'GET',  path: (a) => `/api/kanban/tasks/${a.task_id}/attachments?board=${encodeURIComponent(a.board || 'default')}` },
  upload_kanban_attachment:   { method: 'POST', path: (a) => `/api/kanban/tasks/${a.task_id}/attachments` },
  download_kanban_attachment: { method: 'GET',  path: (a) => `/api/kanban/attachments/${a.attachment_id}` },
  delete_kanban_attachment:   { method: 'DELETE', path: (a) => `/api/kanban/attachments/${a.attachment_id}` },

  // Workers / runs / diagnostics
  get_kanban_diagnostics:     { method: 'GET',  path: (a) => `/api/kanban/diagnostics?board=${encodeURIComponent(a.board || 'default')}` },
  get_kanban_active_workers:  { method: 'GET',  path: (a) => `/api/kanban/workers/active?board=${encodeURIComponent(a.board || 'default')}` },
  // 🔴 修复（连线断点）：run 详情按 board 路由——后端 Query board 缺省 'default'，
  //   此前映射不带 board，非 default 看板查 run 落错板
  get_kanban_run:             { method: 'GET',  path: (a) => `/api/kanban/runs/${a.run_id}?board=${encodeURIComponent(a.board || 'default')}` },
  terminate_kanban_run:       { method: 'POST', path: (a) => `/api/kanban/runs/${a.run_id}/terminate` },
  // 🔴 连线完善：对齐后端已注册的端点（编排面板用），此前后端有、前端 API 层未接
  get_kanban_run_inspect:     { method: 'GET',  path: (a) => `/api/kanban/runs/${a.run_id}/inspect?board=${encodeURIComponent(a.board || 'default')}` },
  patch_kanban_profile:       { method: 'PATCH', path: (a) => `/api/kanban/profiles/${encodeURIComponent(a.profile_id)}` },
  auto_describe_kanban_profile: { method: 'POST', path: (a) => `/api/kanban/profiles/${encodeURIComponent(a.profile_id)}/describe-auto` },

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
  // 🔴 Phase 2c: 多 Profile 统一注入 — 非 default profile 加 /p/<profile>/ 前缀
  // 对齐 WS 层 setWsActiveProfile 盖章机制，HTTP 层等价实现
  const { getWsActiveProfile } = await import('../services/ws-client');
  const profile = getWsActiveProfile();
  const profilePrefix = profile ? `/p/${profile}` : '';
  const url = `${_httpBase}${profilePrefix}${path}`;

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

