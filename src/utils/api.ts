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

// ====== 会话 ======

export async function fetchSessions(): Promise<any[]> {
  const data = await call('list_sessions', {});
  if (data && Array.isArray(data.sessions)) return data.sessions;
  if (Array.isArray(data)) return data;
  return [];
}

export async function createSession(options?: { model?: string; provider?: string; profile?: string; cwd?: string }): Promise<any> {
  // 对齐 Hermes: createBackendSessionForSend 传 model/provider → per-session override
  return call('create_session', {
    ...(options?.model ? { model: options.model } : {}),
    ...(options?.provider ? { provider: options.provider } : {}),
    ...(options?.profile ? { profile: options.profile } : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });
}

/** 重置当前会话（对齐 Eleve reset_session：新 ID + 清消息 + 保留记忆） */
export async function resetSession(sessionId: string, cwd?: string): Promise<any> {
  return call('reset_session', { session_id: sessionId, ...(cwd ? { cwd } : {}) });
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
    // 🔴 2026-08-10 对齐 Hermes：后端 session.context_breakdown 返回
    // { context_used, context_max, context_percent, categories, estimated_total, model }
    // context_used = 实测 last_prompt_tokens 优先，无实测回退估算（永不为 0）；
    // context_max = 模型解析链结果（内置表→provider-aware→OR live→models.dev→256K）。
    // 归一为 ContextBar/CardContextGauge 的 { total_tokens, context_limit, percentage } 形状。
    const data = await call('get_session_context', { session_id: sessionId });
    if (!data) return null;
    return {
      total_tokens: data.context_used ?? data.total_tokens ?? 0,
      context_limit: data.context_max ?? data.context_limit ?? 0,
      percentage: data.context_percent ?? data.percentage ?? 0,
      model: data.model,
      estimated_total: data.estimated_total,
      categories: data.categories,
      compression_count: data.compression_count,
    };
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
  /** 输出缓冲区总字节数（后端 output_buffer.len()）— 镜像按绝对偏移增量写，
   *  解决定长尾窗 >4000B 后窗口平移导致的冻结（旧后端无此字段 → 降级旧逻辑） */
  output_len?: number;
  exit_code?: number;
  completion_reason?: string;
  session_scoped?: boolean;
  detached?: boolean;
}

/** 列出后台进程 */
export async function listProcesses(sessionId: string): Promise<{ processes: ProcessInfo[] }> {
  return call('process_list', { session_id: sessionId });
}

// ── 文件树操作（对齐 Hermes file-actions：重命名/删除走后端，reveal 走 Tauri opener）──

/** 同目录重命名（返回新路径） */
export async function filesRename(path: string, newName: string): Promise<{ path: string }> {
  return call('files_rename', { path, new_name: newName });
}

/** 移入 OS 回收站（对齐 Hermes shell.trashItem；可恢复） */
export async function filesDelete(path: string): Promise<{ deleted: string }> {
  return call('files_delete', { path });
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
export interface ActiveSubagent {
  subagent_id: string;
  /** 🔴 2026-08-15 双登记合并：父会话 id（后端 delegation.status 已按此过滤，仅同会话子可见） */
  parent_session_id?: string | null;
  goal: string;
  depth: number;
  model: string | null;
  status: string;
  tool_count: number;
  current_tool: string | null;
  elapsed_seconds: number;
  interrupt_message?: string | null;
}

export async function getDelegationStatus(sessionId: string): Promise<{
  running: boolean;
  has_subagents: boolean;
  paused: boolean;
  max_spawn_depth?: number;
  max_concurrent_children?: number;
  active?: ActiveSubagent[];
}> {
  return call('delegation_status', { session_id: sessionId });
}

/** 中断子 Agent（带 subagent_id = 精准中断单个；不带 = 兼容旧语义中断父会话） */
export async function interruptSubagent(sessionId: string, subagentId?: string): Promise<{ status: string }> {
  const params: Record<string, unknown> = { session_id: sessionId };
  if (subagentId) params.subagent_id = subagentId;
  return call('subagent_interrupt', params);
}

/** 🔴 2026-08-15 编排对齐：向运行中子 Agent 下达指令（步边界注入，不打断当前工具）。
 *  2026-08-15 祖先权威：session_id 为调用方会话（后端校验起源/活树祖先）。 */
export async function steerSubagent(sessionId: string, subagentId: string, instruction: string): Promise<{ status: string; subagent_id: string }> {
  return call('subagent_steer', { session_id: sessionId, subagent_id: subagentId, text: instruction });
}

/** 子会话历史消息（对齐 DSH subagent.history：parent 校验 + 分页游标） */
export interface SubagentHistoryMessage {
  role: string;
  content: unknown;
  tool_name?: string;
  tool_call_id?: string;
  message_id?: string;
  display_kind?: string;
  [k: string]: unknown;
}

/** 🔴 2026-08-15 前端普查待办①：回读子会话消息历史
 * （子会话已落库但不在 SessionManager，走专用 RPC 按 child_session_id 读 DB）。
 * limit/before_id 缺省 = 全量；传 limit 返回最新 N 条，has_more + oldest_id 上翻。 */
export async function getSubagentHistory(
  sessionId: string,
  childSessionId: string,
  limit?: number,
  beforeId?: number,
): Promise<{
  child_session_id: string;
  messages: SubagentHistoryMessage[];
  has_more?: boolean;
  oldest_id?: number | null;
}> {
  const params: Record<string, unknown> = { session_id: sessionId, child_session_id: childSessionId };
  if (limit !== undefined) params.limit = limit;
  if (beforeId !== undefined) params.before_id = beforeId;
  return call('subagent_history', params);
}

// F3: 输入增强

export interface CompletionItem {
  text: string;
  display: string;
  meta: string;
}

/** 路径/@引用补全（W-6：透传会话 cwd，后端对齐 Hermes _completion_cwd 回退链） */
export async function completePath(word: string, cwd?: string): Promise<{ items: CompletionItem[]; replace_from: number }> {
  return call('complete_path', { word, ...(cwd ? { cwd } : {}) });
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

/** Checkpoint 列表（对齐 Hermes rollback.list：{enabled, checkpoints}）。
 * cwd 由后端从会话派生（_session_cwd 语义），前端只传 session_id。 */
export async function listCheckpoints(sessionId: string): Promise<{
  enabled: boolean;
  checkpoints: Array<{ hash: string; short_hash?: string; timestamp?: string; message: string; files_changed?: number }>;
}> {
  return call('rollback_list', { session_id: sessionId });
}

/** Checkpoint 差异（对齐 Hermes rollback.diff：{stat, diff≤4000字}） */
export async function getCheckpointDiff(sessionId: string, hash: string): Promise<{ stat?: string; diff?: string; error?: string }> {
  return call('rollback_diff', { session_id: sessionId, hash });
}

/** 恢复 checkpoint（对齐 Hermes rollback.restore；busy 时后端返 4009） */
export async function restoreCheckpoint(sessionId: string, hash: string): Promise<{
  success: boolean; restored_to?: string; reason?: string; file?: string; error?: string;
  /** 对齐 Hermes history_removed：全量回滚后被截断的消息数（0/缺省 = 未截断） */
  history_removed?: number;
}> {
  return call('rollback_restore', { session_id: sessionId, hash });
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
export async function createProfile(name: string, displayName?: string, cloneSource?: string, opts?: { noSkills?: boolean; soul?: string; color?: string }): Promise<any> {
  return call('create_profile', {
    name,
    ...(displayName ? { display_name: displayName } : {}),
    ...(cloneSource ? { clone_source: cloneSource } : {}),
    ...(opts?.noSkills ? { no_skills: true } : {}),
    ...(opts?.soul ? { soul: opts.soul } : {}),
    ...(opts?.color ? { color: opts.color } : {}),
  });
}

/** profiles.set_color — 设置 Agent 主题色（#RRGGBB，仅 UI） */
export async function setProfileColor(name: string, color: string): Promise<any> {
  return call('set_color', { name, color });
}

/** profiles.set_avatar — 上传 Agent 头像（base64 data URL → 后端 avatar.png） */
export async function setProfileAvatar(name: string, dataUrl: string): Promise<any> {
  return call('set_avatar', { name, data: dataUrl });
}

/** profiles.set_avatar_key — 设置 Agent 默认头像（预设头像库 key，写 profile.yaml） */
export async function setProfileAvatarKey(name: string, avatarKey: string | null): Promise<any> {
  return call('set_avatar_key', { name, avatar_key: avatarKey });
}

/** profiles.get_avatar — 读取 Agent 头像（返回 { exists, data?: dataURL }） */
export async function getProfileAvatar(name: string): Promise<{ exists: boolean; data?: string; mime?: string }> {
  return call('get_avatar', { name });
}

/** profiles.set_display_name — 设置 Agent 昵称（同步 SOUL.md 身份块） */
export async function setDisplayName(name: string, displayName: string): Promise<any> {
  return call('set_display_name', { name, display_name: displayName });
}

/** profiles.get_soul — 读取 Agent SOUL.md */
export async function getProfileSoul(name: string): Promise<{ content: string; exists: boolean }> {
  return call('get_soul', { name });
}

/** profiles.set_soul — 写入 Agent SOUL.md */
export async function setProfileSoul(name: string, content: string): Promise<any> {
  return call('set_soul', { name, content });
}

/** profiles.get_memory — 读取 Agent MEMORY.md */
export async function getProfileMemory(name: string): Promise<{ content: string; exists: boolean }> {
  return call('get_memory', { name });
}

/** profiles.set_memory — 写入 Agent MEMORY.md */
export async function setProfileMemory(name: string, content: string): Promise<any> {
  return call('set_memory', { name, content });
}

/** profiles.get_user — 读取 Agent USER.md */
export async function getProfileUser(name: string): Promise<{ content: string; exists: boolean }> {
  return call('get_user', { name });
}

/** profiles.set_user — 写入 Agent USER.md */
export async function setProfileUser(name: string, content: string): Promise<any> {
  return call('set_user', { name, content });
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
export async function submitClarifyResponse(clarifyId: string, response: string, profile?: string): Promise<any> {
  // 🔴 P2-1: 统一走 bridge.call（WS 优先→HTTP 降级由 bridge 内部处理）
  // profile 显式归属（宫格模式）；undefined 时 sendRpc 自动盖当前活跃 profile
  return call('submit_clarify_response', { clarify_id: clarifyId, response, profile });
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

// 🔴 对齐 Hermes fetchBoard(archived)（审查 d1 P1-4）：include_archived=true 显示归档
export async function getKanbanBoard(board = 'default', includeArchived = false): Promise<any> {
  return call('get_kanban_board', { board, include_archived: includeArchived });
}

export async function getKanbanTask(taskId: string, board = 'default'): Promise<any> {
  return call('get_kanban_task', { task_id: taskId, board });
}

export async function createKanbanTask(data: Record<string, any>): Promise<any> {
  return call('create_kanban_task', data);
}

// 🔴 P0-4：新建前工作量估算（对齐 Hermes estimateNew：辅助模型估 token+复杂度）
export async function estimateKanbanTask(
  title: string,
  body: string,
  board = 'default',
): Promise<{ ok: boolean; est_tokens?: number; complexity?: string; rationale?: string; reason?: string }> {
  return call('estimate_kanban_task', { title, body, board });
}

// 🔴 P0-4b：任务详情估算（对齐 Hermes /tasks/{id}/estimate，抽屉 EstimateSection）
export async function estimateKanbanTaskById(
  taskId: string,
  board = 'default',
): Promise<{ ok: boolean; est_tokens?: number; complexity?: string; rationale?: string; reason?: string }> {
  return call('estimate_kanban_task_by_id', { task_id: taskId, board });
}

/**
 * 更新任务字段/状态。🔴 修复：后端 update handler 从 body 读 board（缺省
 * 'default'），此前不传 board → 非 default 看板上的拖拽/动作/抽屉保存全部
 * 落到 default 板（任务不存在 → 400 或 0 行影响，功能静默失效）。
 */
export async function updateKanbanTask(taskId: string, data: Record<string, any>, board = 'default'): Promise<any> {
  return call('update_kanban_task', { task_id: taskId, board, ...data });
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

// --- 🔴 对齐 Hermes 2026-08 一等评审生命周期（request_review / request_changes /
//     reopen_review_task）---

/** running/ready → review（提交评审）。force=true 为显式人工覆盖：
 *  任务 running 有活 claim 时，无 expected_run_id 必须 force（防清活 worker claim）。 */
export async function requestKanbanReview(
  taskId: string,
  opts: { summary?: string; reviewer?: string; force?: boolean; expectedRunId?: string } = {},
  board = 'default',
): Promise<any> {
  return call('request_kanban_review', {
    task_id: taskId,
    board,
    summary: opts.summary,
    reviewer: opts.reviewer,
    force: opts.force ?? false,
    expected_run_id: opts.expectedRunId,
  });
}

/** 评审退回返工：活动 review run → changes_requested（回实现者重跑） */
export async function requestKanbanChanges(taskId: string, reason: string, board = 'default', expectedRunId?: string): Promise<any> {
  return call('request_kanban_changes', { task_id: taskId, board, reason, expected_run_id: expectedRunId });
}

/** 评审重开：review → ready/todo（实现者按新评论重跑） */
export async function reopenKanbanReview(taskId: string, board = 'default'): Promise<any> {
  return call('reopen_kanban_review', { task_id: taskId, board });
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

/**
 * 批量更新任务。🔴 修复①：后端 bulk_update_tasks 读顶层字段
 * （status/assignee/priority/archive/reclaim_first/result/summary/metadata），
 * 此前发送 { ids, data: {...} } 形状恒被忽略 → 批量操作静默失效。
 * 现展开为 { ids, ...fields }，与网关契约对齐。
 * 🔴 修复②：后端从 body 读 board（缺省 'default'），批量操作需按当前板路由。
 */
export async function bulkUpdateKanbanTasks(ids: string[], fields: Record<string, any>, board = 'default'): Promise<any> {
  return call('bulk_update_kanban_tasks', { ids, board, ...fields });
}

export async function reassignKanbanTask(taskId: string, profile: string, reclaimFirst: boolean, reason: string, board = 'default'): Promise<any> {
  return call('reassign_kanban_task', { task_id: taskId, profile, reclaim_first: reclaimFirst, reason, board });
}

export async function getKanbanBoards(): Promise<any> {
  return call('get_kanban_boards', {});
}

export async function createKanbanBoard(slug: string, name: string, description: string, icon: string, color: string, switchTo: boolean, projectId?: string): Promise<any> {
  const payload: Record<string, any> = { slug, name, description, icon, color, switch: switchTo };
  // 🔴 2026-08-16（project_id 系统审查 fe-1）：新建看板可绑定项目（对齐
  //   Hermes NewBoardDialog ProjectPicker → createBoard {project_id}）
  if (projectId !== undefined) {
    payload.project_id = projectId;
  }
  return call('create_kanban_board', payload);
}

/** 项目树（新建/编辑看板项目下拉数据源；对齐 Hermes kanban /projects 列表） */
export async function getProjectsTree(previewLimit = 0, includeDiscovered = true): Promise<any> {
  return call('projects_tree', { preview_limit: previewLimit, include_discovered: includeDiscovered });
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

// 🔴 修复（批量）：以下端点后端均从 body/query 读 board（缺省 'default'），
// 非 default 看板必须显式传 board，否则落到 default 板（0 行影响/404）。
export async function deleteKanbanAttachment(attachmentId: string, board = 'default'): Promise<any> {
  return call('delete_kanban_attachment', { attachment_id: attachmentId, board });
}

export async function getKanbanDiagnostics(board = 'default'): Promise<any> {
  return call('get_kanban_diagnostics', { board });
}

export async function getKanbanActiveWorkers(board = 'default'): Promise<any> {
  return call('get_kanban_active_workers', { board });
}

export async function getKanbanRun(runId: string, board = 'default'): Promise<any> {
  return call('get_kanban_run', { run_id: runId, board });
}

export async function terminateKanbanRun(runId: string, reason: string, board = 'default'): Promise<any> {
  return call('terminate_kanban_run', { run_id: runId, reason, board });
}

export async function decomposeKanbanTask(taskId: string, author: string, board = 'default'): Promise<any> {
  return call('decompose_kanban_task', { task_id: taskId, author, board });
}

export async function specifyKanbanTask(taskId: string, author: string, board = 'default'): Promise<any> {
  return call('specify_kanban_task', { task_id: taskId, author, board });
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

// 🔴 连线完善：对齐后端已注册端点（PATCH /profiles/:id、POST /profiles/:id/describe-auto、
//   GET /runs/:id/inspect），此前后端有、前端 API 层未接
/** 更新 profile 描述（编排面板用，对齐 Hermes saveProfileDescription） */
export async function patchKanbanProfile(profileId: string, description: string): Promise<any> {
  return call('patch_kanban_profile', { profile_id: profileId, description });
}

/** 用辅助模型自动生成 profile 描述（对齐 Hermes autoDescribeProfile） */
export async function autoDescribeKanbanProfile(profileId: string): Promise<any> {
  return call('auto_describe_kanban_profile', { profile_id: profileId, overwrite: true });
}

/** 检查 run 进程存活状态（对齐 Hermes inspect_run_endpoint） */
export async function inspectKanbanRun(runId: string, board = 'default'): Promise<any> {
  return call('get_kanban_run_inspect', { run_id: runId, board });
}

export async function getKanbanHomeChannels(taskId: string, board = 'default'): Promise<any> {
  return call('get_kanban_home_channels', { task_id: taskId, board });
}

export async function subscribeKanbanHome(taskId: string, platform: string, board = 'default'): Promise<any> {
  return call('subscribe_kanban_home', { task_id: taskId, platform, board });
}

export async function unsubscribeKanbanHome(taskId: string, platform: string, board = 'default'): Promise<any> {
  return call('unsubscribe_kanban_home', { task_id: taskId, platform, board });
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
