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
