/**
 * session_id ↔ profile 解析与归属校验工具
 *
 * ═══════════════════════════════════════════════════════════════════
 *  ELEVE 多 Profile 隔离架构 — 核心不变量
 * ═══════════════════════════════════════════════════════════════════
 *
 * 【1. 身份模型】
 *
 *   Profile（Agent）= 一个独立的 AI 人格，拥有独立的：
 *     - 配置（config.yaml per-profile section）
 *     - 记忆（memories/）
 *     - 技能（skills/）
 *     - 会话历史（sessions/）
 *     - 凭证（credential scope）
 *
 *   每个 Profile 在运行时对应一个或多个 Session。
 *   Session 是"一次对话"，Profile 是"谁在对话"。
 *
 * 【2. session_id 格式与归属编码】
 *
 *   标准格式: agent:<profile>:<platform>:<uuid8>
 *   示例:
 *     agent:default:ws:a1b2c3d4    → default profile, WS 通道
 *     agent:ocean:ws:e5f6g7h8      → ocean profile, WS 通道
 *     agent:work:telegram:12345    → work profile, Telegram 通道
 *
 *   归属规则: session_id 的第二段（split(':')[1]）即为 profile 名。
 *   特殊归一: 'main' → 'default'（历史兼容，旧版用 main 代替 default）。
 *
 *   非 agent: 前缀的旧格式 session_id（如纯 UUID）无法判定归属，
 *   sessionIdMatchesProfile() 对此放行（兼容旧数据）。
 *
 * 【3. 隔离不变量（铁律）】
 *
 *   ① 一个 session_id 只属于一个 profile，终身不变。
 *   ② 前端任何持有 session_id 的地方（localStorage、state、ref），
 *      使用前必须校验其 profile 归属是否与当前操作目标一致。
 *   ③ 后端 SessionManagerActor 按完整 session_id 精确查找/创建，
 *      不存在"按 profile 模糊匹配"的路径。
 *   ④ 事件回传帧的 session_id 由后端在 session 创建时确定，
 *      前端仅解析、不篡改。
 *
 * 【4. 串台攻击面与防御点】
 *
 *   串台 = profile B 的 session_id 被 profile A 的 UI 消费。
 *
 *   攻击面（前端 localStorage 指针污染）:
 *     profile_session_map = { "B": "agent:A:ws:xxx" }  ← 污染！
 *
 *   防御点（本文件提供的 sessionIdMatchesProfile）:
 *     - App.tsx 启动恢复: 校验后才 setSessionId
 *     - App.tsx handleProfileChange: 写入/读取 map 均校验
 *     - GridModeView 进入: 校验后才 loadLatest
 *     - useGridChat sendTo: 校验后才传 session_id 给后端
 *
 *   不匹配时的降级策略: 静默丢弃该 session_id，传空串让后端
 *   按 profile 参数新建 session（后端是生命周期权威源）。
 *
 * 【5. 数据流全景（WS 通道）】
 *
 *   发送:
 *     用户输入 → sendTo(profile='B')
 *       → sessionIdMatchesProfile(sid, 'B') 校验
 *       → ws.sendRpc('prompt.submit', { profile:'B', session_id:sid })
 *       → 后端 rpc_prompt.rs: profile 解析链 (URL > params > "default")
 *       → session_id 生成: agent:B:ws:<uuid>
 *       → SessionManagerActor.get_or_create(session_id, profile_config)
 *       → Agent 执行 → StreamChunk 事件流
 *
 *   接收:
 *     后端 build_ws_event(event_type, payload, session_id, run_id)
 *       → WS 帧: { params: { session_id: "agent:B:ws:xxx", ... } }
 *       → 前端 ws-client emit → useGridChat handler
 *       → profileFromSessionId("agent:B:ws:xxx") → 'B'
 *       → patch('B', ...) 更新 B 的状态槽
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import * as storage from './storage';

/** session_id → profile 解析（agent:<profile>:...，main 归一为 default） */
export function profileFromSessionId(sid: string | undefined | null): string | null {
  if (!sid) return null;
  const parts = sid.split(':');
  if (parts[0] !== 'agent' || parts.length < 2) return null;
  const p = parts[1];
  return p === 'main' ? 'default' : p;
}

/**
 * 校验 session_id 是否属于指定 profile。
 *
 * 返回值语义:
 *   true  = 归属正确（或旧格式无法判定，兼容放行）
 *   false = 归属错误（指针污染），调用方应丢弃该 session_id
 *
 * 使用场景: 所有从 localStorage / state 读取 session_id 后、
 * 实际消费（加载历史、发送消息、切换会话）之前的校验关卡。
 */
export function sessionIdMatchesProfile(sid: string | undefined | null, profile: string): boolean {
  const owner = profileFromSessionId(sid);
  // 非 agent: 前缀的旧格式 session_id 无法判定归属 → 放行（兼容）
  if (owner === null) return true;
  return owner === profile;
}

/**
 * 🔴 会话指针持久化（单一权威入口）
 *
 * 写 session_id（全局指针）的同时同步更新 profile_session_map（per-profile 索引）。
 * 所有“后端创建/重置 session → 前端更新指针”的路径必须走此函数，
 * 禁止裸调 storage.save('session_id', ...)，否则 map 指针陈旧（P0-B 根因）。
 */
export function persistSessionPointer(sessionId: string): void {
  storage.save('session_id', sessionId);
  const profile = profileFromSessionId(sessionId);
  if (profile) {
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    map[profile] = sessionId;
    storage.save('profile_session_map', map);
  }
}

/**
 * 🔴 P1-6: 清除会话指针（单一权威入口）
 *
 * 置空全局 session_id 的同时删除 profile_session_map 中对应条目。
 * 禁止裸调 storage.save('session_id', null)，否则 map 残留僵尸指针。
 * @param profile 要清除的 profile；不传则只清全局指针（兼容未知 profile 场景）
 */
export function clearSessionPointer(profile?: string): void {
  storage.save('session_id', null);
  if (profile) {
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    if (map[profile] !== undefined) {
      delete map[profile];
      storage.save('profile_session_map', map);
    }
  }
}

// ── profile_session_map 纯 map 操作（不触碰全局 session_id）──
// 🔴 P2-5: 所有对 profile_session_map 的读写必须走 session.ts，禁止裸调 storage

/** 读取全量 per-profile 指针 map */
export function loadProfilePointers(): Record<string, string | null> {
  return (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
}

/** 写入单个 profile 指针（仅 map，不动全局 session_id） */
export function saveProfilePointer(profile: string, sessionId: string): void {
  const map = loadProfilePointers();
  map[profile] = sessionId;
  storage.save('profile_session_map', map);
}

/** 删除单个 profile 指针；传 expectedSessionId 则仅匹配时删除（防误删新指针） */
export function removeProfilePointer(profile: string, expectedSessionId?: string): void {
  const map = loadProfilePointers();
  if (expectedSessionId !== undefined && map[profile] !== expectedSessionId) return;
  if (map[profile] !== undefined) {
    delete map[profile];
    storage.save('profile_session_map', map);
  }
}

/** 批量写入多个 profile 指针（宫格退出时一次性持久化） */
export function batchSaveProfilePointers(entries: Record<string, string>): void {
  if (Object.keys(entries).length === 0) return;
  const map = loadProfilePointers();
  Object.assign(map, entries);
  storage.save('profile_session_map', map);
}
