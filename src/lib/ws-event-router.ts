/**
 * ws-event-router — 🔴 阶段2 地基（frontend-chat-unification-2026-09-09）：
 * 单视图 useSSE.routeWsEvent 与宫格 useGridChat.handler 的 WS payload 归一化
 * 两处手抄收敛为一份（2b 路由器正式合并的前置——消费端形态统一前先统一输入）。
 *
 * 对齐 Hermes _emit 格式：业务数据在 payload 字段下，session_id/run_id 在
 * 事件顶层（build_ws_event 注入）。归一化 = payload 展开 + 顶层字段兜底提升
 * （payload 缺失时用顶层值，**顶层优先**——两端原读点 raw??payload 语义一致）。
 */
export interface NormalizedWsEvent {
  raw: Record<string, unknown>;
  /** payload 展开 + session_id/run_id 顶层兜底提升后的扁平事件体 */
  chunk: Record<string, unknown>;
}

export function normalizeWsEvent(data: unknown): NormalizedWsEvent | null {
  const raw = data as Record<string, unknown>;
  if (!raw) return null;
  const chunkBase = (raw.payload && typeof raw.payload === 'object' ? raw.payload : raw) as Record<string, unknown>;
  const chunk: Record<string, unknown> = {
    ...chunkBase,
    ...(raw.session_id != null && chunkBase.session_id == null ? { session_id: raw.session_id } : {}),
    ...(raw.run_id != null && chunkBase.run_id == null ? { run_id: raw.run_id } : {}),
  };
  return { raw, chunk };
}

// ── 会话归属守卫（🔴 2b 地基：守卫纯函数化 + 用例锁定）──
// 两端守卫是历次串台事故的修复沉淀（useSSE 串台绝对闭环 / 宫格 #10 过期流
// 守卫 + 新鲜发送兼容 + P2 脏指针自含防御）。2b 路由器正式合并前，先把
// 判定逻辑提为纯函数 + vitest 锁死语义——合并时不变量有回归网兜底。

export type AdmitVerdict = 'accept' | 'drop' | 'buffer';

/**
 * 单视图守卫（原 useSSE.routeWsEvent 三分支，1:1 提取）：
 * - 无 session_id → 全局广播（notification/skin/terminal 等）放行；
 * - 无过滤 ref（currentSessionIdRef 未传）→ 不过滤模式放行；
 * - 已锁定当前会话：非本会话事件丢弃（后端已持久化，切回 loadHistory 恢复）；
 * - current 为 null 且本人刚发送新建会话（pendingSend）→ 缓冲（session 未知
 *   窗口，等响应锁定后冲洗——不丢自己的早期事件，不漏外来流式）；
 * - current 为 null 但非本人发送（切到空白 Agent）→ 丢弃外来流式（串台根因
 *   修复：不能靠时序，必须靠归属判定）。
 */
export function admitByCurrentSession(
  eventSessionId: string | undefined,
  currentSessionId: string | null | undefined,
  pendingSend: boolean,
): AdmitVerdict {
  if (!eventSessionId) return 'accept';
  // undefined = 调用方未传过滤 ref（不过滤模式）；null = 已传但尚未锁定
  if (currentSessionId === undefined) return 'accept';
  if (currentSessionId) return eventSessionId === currentSessionId ? 'accept' : 'drop';
  return pendingSend ? 'buffer' : 'drop';
}

export type SlotVerdict = 'accept' | 'drop';

/**
 * 宫格 slot 守卫（原 useGridChat.handler #10 守卫，1:1 提取）：
 * - 事件无 session_id / slot 无指针 → 放行（全局事件或未初始化 slot）；
 * - slotSid 脏指针（前缀不归属本 profile，slotSidBelongs=false）→ 视同 null
 *   放行（P2 自含防御：守卫不依赖"slot 恒干净"的隐式不变量）；
 * - session 与 slot 当前 session 一致 → 放行；
 * - 不一致（切会话后迟到）：交互类事件放行（后台会话并发轮的审批/澄清必须
 *   可见可响应，被丢弃 = 工具挂到超时）；其余丢弃（防旧流 delta 注入新会话
 *   ——调用方在 drop 终止事件时自行释放 per-profile 锁，见 handler）。
 */
export function admitBySlotGuard(
  sessionId: string | undefined,
  slotSid: string | null | undefined,
  slotSidBelongs: boolean,
  isInteraction: boolean,
): SlotVerdict {
  if (!sessionId || !slotSid) return 'accept';
  if (!slotSidBelongs) return 'accept';
  if (sessionId === slotSid) return 'accept';
  return isInteraction ? 'accept' : 'drop';
}
