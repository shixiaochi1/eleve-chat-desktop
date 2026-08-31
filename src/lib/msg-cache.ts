/**
 * msgCache LRU — 会话消息缓存的容量治理（🔴 2026-09-01 内存修复，审查 P0-1）
 *
 * 背景：useSessions.msgCache 是 Record<sessionId, ChatMessage[]>，缓存所有
 * 打开过的会话的全量消息（含工具 args/result 大字符串），且每 turn 全量回写 +
 * storage 全量持久化。无上限 → 内存随"使用时长 × 会话数"加速增长。
 *
 * 语义约束（为什么淘汰是安全的）：msgCache 非权威源。读取点仅"切会话秒显"
 * （App.tsx loadSessionIntoView / useSessionActions.handleSwitchSession），
 * 两处注释自证"始终被后端覆盖"——loadHistory 恒从后端全量重拉，后端 DB 是
 * 唯一真相源。淘汰条目零数据丢失，仅损失秒显瞬间 UX（短暂 spinner）。
 *
 * 容量 10：覆盖单视图来回切换（2-5 个活跃会话）+ 宫格展开兜底（宫格自身有
 * WINDOW_MAX=100 消息窗口且不依赖 msgCache）。冷会话重进走 loadHistory
 * 正常路径，感知仅为短暂加载。
 *
 * 实现说明：LRU 序由模块级 lastTouched Map 维护（React state 的 Record 无法
 * 保序，Map 与 storage._cache 同生命周期）。touch 采用"写时触发"：收敛在
 * useSessions.saveCache 单点，通过"写入前后引用 diff"识别刚写入的会话 key
 * （写点恒为 { ...cache, [sid]: msgs } 引用新建形态），调用方零改动。
 */

/** 缓存容量上限（会话数） */
export const MSG_CACHE_MAX_SESSIONS = 10;

const lastTouched = new Map<string, number>();

/** 按 lastTouched 升序淘汰超出容量的最旧条目（容量内原引用返回，零拷贝） */
export function pruneMsgCache<T>(cache: Record<string, T>): Record<string, T> {
  const keys = Object.keys(cache);
  if (keys.length <= MSG_CACHE_MAX_SESSIONS) return cache;
  // 未 touch 过的按 0 参与（启动恢复的存量数据按插入序淘汰，最旧的先进先出）
  const sorted = [...keys].sort(
    (a, b) => (lastTouched.get(a) ?? 0) - (lastTouched.get(b) ?? 0),
  );
  const next = { ...cache };
  for (const k of sorted.slice(0, keys.length - MSG_CACHE_MAX_SESSIONS)) {
    delete next[k];
    lastTouched.delete(k);
  }
  return next;
}

/** touch 一个会话（标记"最近使用"）并裁剪。saveCache 写入路径调用 */
export function touchAndPruneMsgCache<T>(
  cache: Record<string, T>,
  sessionId: string,
): Record<string, T> {
  lastTouched.set(sessionId, Date.now());
  return pruneMsgCache(cache);
}

/** 显式删除条目（会话删除联动），防脏序号残留 */
export function dropMsgCacheEntry(sessionId: string): void {
  lastTouched.delete(sessionId);
}

/**
 * 找出 cache 中与 prev 引用不同（本次刚被写入）的 key。
 * 写点恒为 { ...cache, [sid]: msgs } 形态 → diff 命中即写入目标。
 * 返回最后一个命中项（同批次多写时以最后写入者为准）。
 * 注意：若写入值与旧值引用相同（连续同引用回写），返回 null → 仅裁剪不 touch，
 * 无正确性影响（该会话数据仍在后端，被淘后重进走 loadHistory）。
 */
export function findTouchedKey<T>(
  prev: Record<string, T>,
  next: Record<string, T>,
): string | null {
  let touched: string | null = null;
  for (const k of Object.keys(next)) {
    if (next[k] !== prev[k]) touched = k;
  }
  return touched;
}
