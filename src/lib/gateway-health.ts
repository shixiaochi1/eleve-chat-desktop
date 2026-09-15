/**
 * 网关运行态健康的**展示判据**（唯一判据；后端是权威）。
 *
 * 🔴 2026-09-16（对齐 Hermes `gateway/session_db_recovery.py` 的健康聚合消费面）：
 * 后端 `write_runtime_status` 会写 `session_store { status, degraded_paths }`，
 * 且 `gateway.status` RPC 已把它透出（`crates/eleve-gateway/src/ws/mod.rs`）。
 * 但**透出 ≠ 被看见**——本文件补的就是消费端：把三个词（`ok` / `retrying` / `unavailable`）
 * 翻成面板上能读的一句话。
 *
 * 为什么值得呈现（Hermes #88235 原文）：
 * *"state.db corruption or NFS/SMB lock failures **silently degrade the entire gateway** —
 * messages may flow but **nothing is persisted**, and the user has no indication until they
 * try `/resume` and find nothing."*
 *
 * 边界：**缺省 / 旧后端 / 非字符串 ⇒ `null`**（宁可不显示，也不把未知当故障）。
 */

/** 后端 `session_store` 段的最小形状。 */
export interface SessionStoreStatusRaw {
  status?: unknown;
  degraded_paths?: unknown;
  failure_kind?: unknown;
}

/** 归一化后的健康形态。 */
export interface SessionStoreHealth {
  /** `'ok' | 'retrying' | 'unavailable'`（后端 `db_open_gate::aggregate_health`） */
  status: string;
  /** 处于降级（失败/退避/单飞）的库数 */
  degradedPaths: number;
  /** `'corrupt' | 'locked' | 'disk' | 'other'`；缺省 / 未知 ⇒ `''`
   *  （后端 `db_open_gate::StoreFailureKind::as_str`，**隐私安全**的四个词）。
   *
   *  声明为可选：直接构造健康对象的地方（测试 / 旧调用）不必填。 */
  failureKind?: string;
}

/**
 * 归一化后端 `session_store` 段：无 / 无 `status` / 非字符串 ⇒ `null`。
 * `degraded_paths` 非有限值或 ≤ 0 ⇒ 0；`failure_kind` 非字符串 ⇒ `''`。
 */
export function sessionStoreHealth(
  raw?: SessionStoreStatusRaw | null,
): SessionStoreHealth | null {
  if (!raw) return null;
  const status = typeof raw.status === 'string' ? raw.status : '';
  if (!status) return null;
  const degraded = Number(raw.degraded_paths);
  return {
    status,
    degradedPaths: Number.isFinite(degraded) && degraded > 0 ? Math.floor(degraded) : 0,
    failureKind: typeof raw.failure_kind === 'string' ? raw.failure_kind : '',
  };
}

/**
 * 是否处于降级。`null`（未知/旧后端）⇒ **false** —— 未知不得当故障
 * （与后端"没有失败状态即 ok"同口径）。
 */
export function isSessionStoreDegraded(health: SessionStoreHealth | null): boolean {
  return health !== null && health.status !== 'ok';
}

/**
 * 面板文案（与后端 `format_session_store_degraded_notice` 的**语义**对齐：
 * 还能用 / 不会被保存 / 自动重试；**不含**路径与错误文本）。
 */
export function sessionStoreDegradedLabel(health: SessionStoreHealth): string {
  const count = health.degradedPaths > 0 ? `（${health.degradedPaths} 个库）` : '';
  // ⚠️ 纯文本渲染（Notification / 面板）——**不要**写 markdown 星号，
  // 否则界面上会原样显示 `**`（本轮踩过）。
  //
  // 🔴 损坏与"锁/磁盘"必须分开说（对齐 Hermes `classify_persistence_error`）：
  // **损坏不会自愈**，让用户等自动重试是错的引导。
  if (health.failureKind === 'corrupt') {
    return `会话库疑似损坏${count}：消息能收发，但这段时间的对话不会被保存；损坏不会自愈，请运行 eleve doctor 查看诊断，先备份再处理`;
  }
  return health.status === 'unavailable'
    ? `会话存储不可用${count}：消息能收发，但这段时间的对话不会被保存；系统正按 1s→60s 自动退避重试`
    : `会话存储重试中${count}：最近打开失败，正在退避重试，恢复后自动继续`;
}
