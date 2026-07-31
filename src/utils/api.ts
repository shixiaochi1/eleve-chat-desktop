/**
 * API 客户端 v3 — HTTP 统一版
 *
 * 桌面模式 & 浏览器模式统一走 HTTP API
 * 通过 bridge.js 的 discoverPort 动态获取网关端口
 *
 * ⚠️ DEPRECATED（2026-07-31 系统审查 Phase 4 确立）：
 * 本文件是 bridge.call 的遗留薄包装层，已冻结——禁止新增函数。
 * 新代码直接用 bridge.call（lib/bridge.ts，COMMAND_TO_WS_METHOD 路由）
 * 或经 hooks 层封装。存量函数随消费方迁移逐步删除。
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

// F1: 会话管理补全（后端已就绪，前端断线）

/** 撤销最后一轮对话 */
export async function undoSessionTurn(sessionId: string): Promise<{ undone: boolean; removed_text?: string; reason?: string }> {
  return call('undo_session_turn', { session_id: sessionId });
}

/** 手动压缩上下文 */
export async function compressSession(sessionId: string, focus?: string): Promise<{ status: string; summary: string }> {
  return call('compress_session', { session_id: sessionId, ...(focus ? { focus } : {}) });
}

/** 分支当前会话 */
export async function branchSession(sessionId: string, name?: string): Promise<{ status: string; branch_id: string }> {
  return call('branch_session', { session_id: sessionId, ...(name ? { name } : {}) });
}

/** 获取会话 token 用量 */
export async function getSessionUsage(sessionId: string): Promise<{
  session_id: string; usage: string;
  input_tokens: number; output_tokens: number; total_tokens: number;
}> {
  return call('get_session_usage', { session_id: sessionId });
}

// F2: 进程与委托管理

export interface ProcessInfo {
  session_id: string;
  command: string;
  cwd: string;
  pid: number;
  started_at: number;
  uptime_seconds: number;
  status: 'running' | 'exited';
  output_preview: string;
  output_tail: string;
  exit_code?: number;
  completion_reason?: string;
  session_scoped?: boolean;
  detached?: boolean;
}

/** 列出后台进程 */
export async function listProcesses(sessionId: string): Promise<{ processes: ProcessInfo[] }> {
  return call('process_list', { session_id: sessionId });
}

/** 杀单个进程 */
export async function killProcess(sessionId: string, processId: string): Promise<any> {
  return call('process_kill', { session_id: sessionId, process_id: processId });
}

/** 杀全部进程 */
export async function stopAllProcesses(): Promise<{ killed: number }> {
  return call('process_stop', {});
}

/** 暂停/恢复委托 */
export async function setDelegationPause(sessionId: string, paused: boolean): Promise<{ paused: boolean }> {
  return call('delegation_pause', { session_id: sessionId, paused });
}

/** 获取委托状态 */
export async function getDelegationStatus(sessionId: string): Promise<{ running: boolean; has_subagents: boolean; paused: boolean }> {
  return call('delegation_status', { session_id: sessionId });
}

/** 中断子 Agent */
export async function interruptSubagent(sessionId: string): Promise<{ status: string }> {
  return call('subagent_interrupt', { session_id: sessionId });
}

// F3: 输入增强

export interface CompletionItem {
  text: string;
  display: string;
  meta: string;
}

/** 路径/@引用补全 */
export async function completePath(word: string): Promise<{ items: CompletionItem[]; replace_from: number }> {
  return call('complete_path', { word });
}

// F4: 信息面板

/** 学习时间线 */
export async function getLearningFrames(): Promise<{ nodes: Array<{ id: string; modified: number }>; [k: string]: unknown }> {
  return call('learning_frames', {});
}

/** 学习节点详情 */
export async function getLearningDetail(id: string): Promise<{ ok: boolean; id: string; content?: string; error?: string }> {
  return call('learning_detail', { id });
}

/** 删除学习节点 */
export async function deleteLearning(id: string): Promise<{ ok: boolean; id: string }> {
  return call('learning_delete', { id });
}

/** 回滚点列表 */
export async function listRollbacks(cwd: string): Promise<{ rollbacks: Array<{ hash: string; message: string }> }> {
  return call('rollback_list', { cwd });
}

/** 回滚差异 */
export async function getRollbackDiff(hash: string, cwd: string): Promise<{ diff: string }> {
  return call('rollback_diff', { hash, cwd });
}

/** 执行回滚 */
export async function restoreRollback(hash: string, cwd: string): Promise<{ status: string; output: string }> {
  return call('rollback_restore', { hash, cwd });
}

// ====== 模型 ======

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

// ====== 工具 ======

export async function fetchTools(): Promise<any> {
  return call('list_tools', {});
}

/** GET /api/tools/toolsets — 工具集列表（含真实 enabled 状态，对齐 Hermes getToolsets）
 *  profile 可选：指定查询哪个 profile 的工具开关，缺省走 active profile
 */
export async function fetchToolsets(profile?: string): Promise<any[]> {
  const qs = profile ? `?profile=${encodeURIComponent(profile)}` : '';
  const resp = await fetch(`${getApiBase()}/api/tools/toolsets${qs}`);
  if (!resp.ok) throw new Error(`GET /api/tools/toolsets: ${resp.status}`);
  return resp.json();
}

/** PUT /api/tools/toolsets/:name — 切换工具集开关（D5，对齐 Hermes toggleToolset）
 *  profile 可选：指定目标 profile，缺省走 active profile（后端已支持 body.profile）
 */
export async function toggleToolset(name: string, enabled: boolean, profile?: string): Promise<any> {
  const body: Record<string, unknown> = { enabled };
  if (profile) body.profile = profile;
  const resp = await fetch(`${getApiBase()}/api/tools/toolsets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `PUT /api/tools/toolsets/${name}: ${resp.status}`);
  }
  return resp.json();
}

// ====== 多 Profile 管理（F9+ Profile 选择器，对齐 Hermes profile list/use） ======

/** profiles.list — 列出所有 profile（含 model/provider/skill_count/has_env 富信息）
 *  返回 { profiles: ProfileInfo[], active: string }
 */
export async function fetchProfiles(): Promise<{ profiles: any[]; active: string }> {
  const data = await call('list_profiles', {});
  return {
    profiles: Array.isArray(data?.profiles) ? data.profiles : [],
    active: typeof data?.active === 'string' ? data.active : 'default',
  };
}

/** profiles.get_active — 查询当前活动 profile 名 */
export async function getActiveProfile(): Promise<string> {
  const data = await call('get_active_profile', {});
  return typeof data?.active === 'string' ? data.active : 'default';
}

/** profiles.create — 新建 Agent（profile），可选从已有 Agent 克隆配置 */
export async function createProfile(name: string, displayName?: string, cloneSource?: string): Promise<any> {
  return call('create_profile', {
    name,
    ...(displayName ? { display_name: displayName } : {}),
    ...(cloneSource ? { clone_source: cloneSource } : {}),
  });
}

/** profiles.delete — 删除 Agent（移入回收站，可恢复；per-profile 凭证隔离不影响其它 Agent） */
export async function deleteProfile(name: string): Promise<any> {
  return call('delete_profile', { name });
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
