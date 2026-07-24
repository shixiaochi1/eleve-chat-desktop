/**
 * API 客户端 v3 — HTTP 统一版
 * 
 * 桌面模式 & 浏览器模式统一走 HTTP API
 * 通过 bridge.js 的 discoverPort 动态获取网关端口
 */
import { call, discoverPort, setHttpBase, getHttpBase } from './bridge';
import { getWsClient } from '@/services/ws-client';

// ====== 会话 ======

export async function fetchSessions(): Promise<any[]> {
  const data = await call('list_sessions', {});
  if (data && Array.isArray(data.sessions)) return data.sessions;
  if (Array.isArray(data)) return data;
  return [];
}

export async function createSession(options?: { model?: string; provider?: string }): Promise<any> {
  // 对齐 Hermes: createBackendSessionForSend 传 model/provider → per-session override
  return call('create_session', {
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.provider ? { provider: options.provider } : {}),
  });
}

/** 重置当前会话（对齐 Eleve reset_session：新 ID + 清消息 + 保留记忆） */
export async function resetSession(sessionId: string): Promise<any> {
  return call('reset_session', { session_id: sessionId });
}

export async function deleteSession(id: string): Promise<any> {
  return call('delete_session', { session_id: id });
}

export async function activateSession(id: string): Promise<any> {
  return call('activate_session', { session_id: id });
}

export async function setSessionTitle(sessionId: string, title: string): Promise<any> {
  return call('set_session_title', { session_id: sessionId, title });
}

export async function getSessionHistory(id: string): Promise<any> {
  return call('get_session_messages', { session_id: id });
}

export async function fetchSessionContext(sessionId: string | null | undefined): Promise<any> {
  if (!sessionId) return null;
  try {
    return await call('get_session_context', { session_id: sessionId });
  } catch {
    return null;
  }
}

export async function searchSessions(query: string, limit: number = 20): Promise<any> {
  return call('search_sessions', { query, limit });
}

// ====== 聊天 ======

/**
 * 发送消息并启动 SSE 流式
 * 统一走 HTTP SSE（由 useSSE.js 处理）
 */
export function sendChatStream(message: string, sessionId: string | null): Promise<Response> {
  // 统一走 HTTP SSE，对齐 /v1/chat/completions OpenAI 兼容格式
  return fetch(`${getApiBase()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      stream: true,
      session_id: sessionId || null,
    }),
  });
}

// ====== 模型 ======

export async function fetchModels(): Promise<any> {
  return call('list_models', {});
}

export async function fetchConfig(): Promise<any> {
  return call('get_config', {});
}

export async function setModel(modelName: string): Promise<any> {
  return call('update_config_raw', { yaml_text: `model: ${modelName}` });
}

// ====== 命令 ======

export async function fetchCommands(): Promise<any[]> {
  const catalog = await call('list_commands', {});
  // commands.catalog 返回 { pairs, canon, categories, sub, skill_count }
  // 转换为 CommandDef[] 格式供 CommandMenu 使用
  if (!catalog || !catalog.categories) return [];

  const commands: any[] = [];
  const seen = new Set<string>();

  for (const section of catalog.categories) {
    const category = section.name;
    for (const [cmdPath, description] of section.pairs) {
      // cmdPath 是 "/name" 格式
      const name = cmdPath.startsWith('/') ? cmdPath.slice(1) : cmdPath;
      if (seen.has(name)) continue;
      seen.add(name);

      // 从 canon 中找别名
      const aliases: string[] = [];
      if (catalog.canon) {
        for (const [alias, canonical] of Object.entries(catalog.canon)) {
          const aliasName = alias.startsWith('/') ? alias.slice(1) : alias;
          if (canonical === cmdPath && aliasName !== name) {
            aliases.push(aliasName);
          }
        }
      }

      commands.push({ name, description, category, aliases });
    }
  }

  return commands;
}

export async function executeCommand(command: string, args = '', sessionId: string | null = null): Promise<any> {
  return call('execute_command', { command });
}

// ====== 工具 ======

export async function fetchTools(): Promise<any> {
  return call('list_tools', {});
}

/** GET /api/tools/toolsets — 工具集列表（含真实 enabled 状态，对齐 Hermes getToolsets） */
export async function fetchToolsets(): Promise<any[]> {
  const resp = await fetch(`${getApiBase()}/api/tools/toolsets`);
  if (!resp.ok) throw new Error(`GET /api/tools/toolsets: ${resp.status}`);
  return resp.json();
}

/** PUT /api/tools/toolsets/:name — 切换工具集开关（D5，对齐 Hermes toggleToolset） */
export async function toggleToolset(name: string, enabled: boolean): Promise<any> {
  const resp = await fetch(`${getApiBase()}/api/tools/toolsets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `PUT /api/tools/toolsets/${name}: ${resp.status}`);
  }
  return resp.json();
}

// ====== 网关 ======

export async function fetchGatewayStatus(): Promise<any> {
  return call('gateway_status', {});
}

// ====== 审批 ======

/**
 * 提交 clarify 响应 — WS 优先，降级到 HTTP
 *
 * 对齐 Hermes TUI 架构：
 * - WS 连接时：通过 JSON-RPC clarify.respond 提交（同一长连接，无额外 HTTP 开销）
 * - SSE/降级时：通过 HTTP POST /api/clarify-response 提交
 */
export async function submitClarifyResponse(clarifyId: string, response: string): Promise<any> {
  const wsClient = getWsClient();
  if (wsClient.state === 'connected') {
    try {
      const result = await wsClient.sendRpc('clarify.respond', {
        request_id: clarifyId,
        answer: response,
      });
      // WS 返回 { status: "ok" }，统一为 { status: "resolved" } 供 ClarifyCard 判断
      // 注意：展开顺序很重要，status 必须在最后才能覆盖
      return { ...(result as object), status: 'resolved' };
    } catch (wsErr) {
      console.warn('[api] WS clarify.respond failed, falling back to HTTP:', wsErr);
    }
  }
  return call('submit_clarify_response', { clarify_id: clarifyId, response });
}

// ====== 健康检查 ======

export async function checkHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${getApiBase()}/v1/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// ====== 用量分析 ======

export async function fetchAnalyticsUsage(days = 30): Promise<any> {
  return call('analytics_usage', { days });
}

// ====== Kanban ======

export async function getKanbanBoard(board = 'default'): Promise<any> {
  return call('get_kanban_board', { board });
}

export async function getKanbanTask(taskId: string, board = 'default'): Promise<any> {
  return call('get_kanban_task', { task_id: taskId, board });
}

export async function createKanbanTask(data: Record<string, any>): Promise<any> {
  return call('create_kanban_task', data);
}

export async function updateKanbanTask(taskId: string, data: Record<string, any>): Promise<any> {
  return call('update_kanban_task', { task_id: taskId, ...data });
}

export async function deleteKanbanTask(taskId: string, board = 'default'): Promise<any> {
  return call('delete_kanban_task', { task_id: taskId, board });
}

export async function getKanbanStats(board = 'default'): Promise<any> {
  return call('get_kanban_stats', { board });
}

export async function getKanbanAssignees(board = 'default'): Promise<any> {
  return call('get_kanban_assignees', { board });
}

export async function dispatchKanbanTasks(params: Record<string, any> = {}): Promise<any> {
  return call('dispatch_kanban_tasks', params);
}

export async function reclaimKanbanTask(taskId: string, reason: string, board = 'default'): Promise<any> {
  return call('reclaim_kanban_task', { task_id: taskId, reason, board });
}

// --- New kanban functions ---

export async function addKanbanComment(taskId: string, body: string, author: string, board = 'default'): Promise<any> {
  return call('add_kanban_comment', { task_id: taskId, body, author, board });
}

export async function createKanbanLink(parentId: string, childId: string, board = 'default'): Promise<any> {
  return call('create_kanban_link', { parent_id: parentId, child_id: childId, board });
}

export async function deleteKanbanLink(parentId: string, childId: string, board = 'default'): Promise<any> {
  return call('delete_kanban_link', { parent_id: parentId, child_id: childId, board });
}

export async function bulkUpdateKanbanTasks(ids: string[], data: Record<string, any>): Promise<any> {
  return call('bulk_update_kanban_tasks', { ids, data });
}

export async function reassignKanbanTask(taskId: string, profile: string, reclaimFirst: boolean, reason: string, board = 'default'): Promise<any> {
  return call('reassign_kanban_task', { task_id: taskId, profile, reclaim_first: reclaimFirst, reason, board });
}

export async function getKanbanBoards(): Promise<any> {
  return call('get_kanban_boards', {});
}

export async function createKanbanBoard(slug: string, name: string, description: string, icon: string, color: string, switchTo: boolean): Promise<any> {
  return call('create_kanban_board', { slug, name, description, icon, color, switch: switchTo });
}

export async function updateKanbanBoard(slug: string, data: Record<string, any>): Promise<any> {
  return call('update_kanban_board', { slug, ...data });
}

export async function deleteKanbanBoard(slug: string, deletePermanently = false): Promise<any> {
  return call('delete_kanban_board', { slug, delete_permanently: deletePermanently });
}

export async function switchKanbanBoard(slug: string): Promise<any> {
  return call('switch_kanban_board', { slug });
}

export async function getKanbanTaskLog(taskId: string, tail: number | string, board = 'default'): Promise<any> {
  return call('get_kanban_task_log', { task_id: taskId, tail, board });
}

export async function pollKanbanEvents(since: string, board = 'default'): Promise<any> {
  return call('poll_kanban_events', { since, board });
}

export async function getKanbanAttachments(taskId: string, board = 'default'): Promise<any> {
  return call('get_kanban_attachments', { task_id: taskId, board });
}

export async function uploadKanbanAttachment(taskId: string, filename: string, contentBase64: string, board = 'default'): Promise<any> {
  return call('upload_kanban_attachment', { task_id: taskId, filename, content_base64: contentBase64, board });
}

export async function downloadKanbanAttachment(attachmentId: string): Promise<any> {
  return call('download_kanban_attachment', { attachment_id: attachmentId });
}

export async function deleteKanbanAttachment(attachmentId: string): Promise<any> {
  return call('delete_kanban_attachment', { attachment_id: attachmentId });
}

export async function getKanbanDiagnostics(board = 'default'): Promise<any> {
  return call('get_kanban_diagnostics', { board });
}

export async function getKanbanActiveWorkers(board = 'default'): Promise<any> {
  return call('get_kanban_active_workers', { board });
}

export async function getKanbanRun(runId: string): Promise<any> {
  return call('get_kanban_run', { run_id: runId });
}

export async function terminateKanbanRun(runId: string, reason: string): Promise<any> {
  return call('terminate_kanban_run', { run_id: runId, reason });
}

export async function decomposeKanbanTask(taskId: string, author: string): Promise<any> {
  return call('decompose_kanban_task', { task_id: taskId, author });
}

export async function specifyKanbanTask(taskId: string, author: string): Promise<any> {
  return call('specify_kanban_task', { task_id: taskId, author });
}

export async function getKanbanOrchestration(): Promise<any> {
  return call('get_kanban_orchestration', {});
}

export async function setKanbanOrchestration(data: Record<string, any>): Promise<any> {
  return call('set_kanban_orchestration', data);
}

export async function getKanbanProfiles(): Promise<any> {
  return call('get_kanban_profiles', {});
}

export async function getKanbanHomeChannels(taskId: string, board = 'default'): Promise<any> {
  return call('get_kanban_home_channels', { task_id: taskId, board });
}

export async function subscribeKanbanHome(taskId: string, platform: string): Promise<any> {
  return call('subscribe_kanban_home', { task_id: taskId, platform });
}

export async function unsubscribeKanbanHome(taskId: string, platform: string): Promise<any> {
  return call('unsubscribe_kanban_home', { task_id: taskId, platform });
}

export async function getKanbanConfig(): Promise<any> {
  return call('get_kanban_config', {});
}

// ====== API Base URL ======

/**
 * 获取动态 API Base URL
 * 桌面模式通过 discoverPort 设置，浏览器模式默认 http://127.0.0.1:3001
 */
export function getApiBase(): string {
  return getHttpBase();
}
