/**
 * session-status.ts — 跨会话实时状态 store（对齐 Hermes store/session-states.ts）
 *
 * 数据流（与 Hermes 同构）：WS 事件 → store（Record<sessionId, SessionLiveState>）
 * → 纯函数 sessionDotState（lib/session-dot-state.ts）→ SessionStatusDot UI。
 *
 * Hermes 用 nanostores atom + computed；ELEVE 用 useSyncExternalStore
 * （复用 store/terminals.ts、lib/sidebar-node-open.ts 既有模式，不造轮子）。
 *
 * 状态语义（对齐 Hermes ClientSessionState.busy/needsInput + watchdog）：
 * - running    = busy：LLM turn 权威运行中（session.info 权威 + 流式事件中间证据）
 * - needsInput = Hermes attention：有 pending prompt（clarify/approval/sudo/secret/
 *                slash_confirm/terminal_read）——等待用户输入
 * - unread     = Hermes $unreadFinishedSessionIds：后台会话 turn 完成且未打开
 * - stalled    = Hermes watchdog：权威 running 但流活动静默超 SESSION_WATCHDOG_TIMEOUT_MS
 *
 * 事件源：全局 ws-client 单例（复用现有连接，零新连接/零新 RPC）。
 * 后端 build_ws_event（frame.rs）给所有事件注入 session_id，store 据此路由。
 * 订阅制：仅已 attach 的会话能收到事件（ws-client attachedSessions），与 Hermes
 * gateway 只广播活跃 runtime 的行为一致，不额外 attach（不造轮子）。
 *
 * ⚠️ background 态（Hermes $backgroundRunningSessionIds）：数据源 = 后台 terminal
 * 进程存活（process→session 映射），ELEVE 无等价事件，如实不做（待后端支持）。
 */
import { useSyncExternalStore } from 'react';
import { getWsClient } from '../services/ws-client';
import { call } from '../utils/bridge';
import * as storage from '../utils/storage';

export interface SessionLiveState {
  running: boolean;
  needsInput: boolean;
  unread: boolean;
  stalled: boolean;
  /** 有 running 的后台进程（Hermes $backgroundRunningSessionIds 等价） */
  background: boolean;
  /** 压缩中（Hermes $compactingSessions 等价）：status.update kind=compacting/compacted 驱动，
   *  恢复信号（首个模型输出/工具事件）提前退役（对齐 Hermes compactedTurnRef + COMPACTION_RESUME_EVENT_TYPES） */
  compacting: boolean;
  lastActive: number;
}

const IDLE_STATE: SessionLiveState = { running: false, needsInput: false, unread: false, stalled: false, background: false, compacting: false, lastActive: 0 };

/** 对齐 Hermes SESSION_WATCHDOG_TIMEOUT_MS = 8min：权威 running 但流活动静默即 stalled */
export const SESSION_WATCHDOG_TIMEOUT_MS = 8 * 60 * 1000;

/**
 * 后台进程轮询间隔。
 *
 * 🔴 2026-08-30 空转修复：5s → 60s。
 * 原先必须 5s，是因为**进程启动没有任何事件**（只有 terminal.close 表示结束），
 * 前端只能靠高频轮询感知"哪个会话起了后台进程"。现在后端补了 process.started
 * 事件（ProcessRegistry.on_start_tx → Gateway 广播），启停都走事件，
 * 轮询降级为**对账**——仅用于纠正 WS 断线期间丢失的启停事件。
 * 每轮仍会让后端对全部进程做 PID 探测并序列化 4KB/进程 的 output_tail，
 * 所以不能太频繁；但也不能完全没有，否则断线期间的状态永远纠不回来。
 */
export const BACKGROUND_POLL_MS = 60 * 1000;

// ── 内部状态 ──

let states: Record<string, SessionLiveState> = {};
const listeners = new Set<() => void>();
const watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 会话 → 该会话下正在运行的后台进程 id 集合。
 *
 * 🔴 一个会话可以同时跑多个后台进程，所以必须按集合维护：
 * 两个进程里结束一个，不能就把灰点灭掉，得等集合空了才行。
 * 这正好对应旧实现 `runningIds.has(sid)` 的语义（该会话是否还有进程在跑）。
 */
const backgroundProcesses = new Map<string, Set<string>>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function armWatchdog(sessionId: string): void {
  const existing = watchdogTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  watchdogTimers.set(sessionId, setTimeout(() => {
    watchdogTimers.delete(sessionId);
    patch(sessionId, { stalled: true });
  }, SESSION_WATCHDOG_TIMEOUT_MS));
}

function clearWatchdog(sessionId: string): void {
  const t = watchdogTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    watchdogTimers.delete(sessionId);
  }
}

/** 无变化不 emit（对齐 Hermes publishSessionState prev===state skip + stableArray） */
function patch(sessionId: string, p: Partial<SessionLiveState>): void {
  const prev = states[sessionId] ?? IDLE_STATE;
  const next: SessionLiveState = { ...prev, ...p };
  if (
    prev.running === next.running &&
    prev.needsInput === next.needsInput &&
    prev.unread === next.unread &&
    prev.stalled === next.stalled &&
    prev.background === next.background &&
    prev.compacting === next.compacting &&
    prev.lastActive === next.lastActive
  ) {
    return;
  }
  states = { ...states, [sessionId]: next };
  emit();
}

// 🔴 2026-08-13 P2-2：宫格焦点会话 override（unread 判定基准）。
// 单视图：全局指针（storage session_id）；宫格：焦点卡片会话（App 经
// setActiveSessionOverride 同步 focusedGridSessionId）——宫格焦点切换不写全局指针
// （防污染单视图指针语义，退出宫格 restoreProfileSession 用 map 权威）。
let activeSessionOverride: string | null = null;
/** 设置/清除宫格焦点会话 override（null = 清除 → 回退全局指针） */
export function setActiveSessionOverride(id: string | null): void {
  activeSessionOverride = id;
}

function activeSessionId(): string | null {
  return activeSessionOverride ?? (storage.load('session_id', null) as string | null) ?? null;
}

// ── 事件接线（模块加载时注册一次；ws 单例懒创建，事件在连接后到达） ──

interface StatusEvent {
  session_id?: string;
  payload?: Record<string, unknown>;
}

getWsClient().addEventListener((eventName: string, data: unknown) => {
  const d = data as StatusEvent;
  const sid = d.session_id;
  if (!sid) return;
  const payload = d.payload ?? {};
  // 🔴 兼容两种事件帧格式（ws-client 分发时把 params 平铺交给 handler）：
  // - build_ws_event（标准，payload 内聚）：{ session_id, payload: {...}, seq, ts }
  // - build_event_frame（平铺，只注入 type）：{ process_id, session_id, ... }
  // process.started / terminal.close 走后者，字段在顶层，故取 payload ?? 整帧。
  const flat = (d.payload ?? d) as Record<string, unknown>;

  switch (eventName) {
    // ── 权威快照：running + pending_prompts（后端每次状态变化推送） ──
    case 'session.info': {
      const running = payload.running === true;
      const pending = payload.pending_prompts as Record<string, unknown> | undefined;
      const needsInput = !!pending && Object.keys(pending).length > 0;
      patch(sid, { running, needsInput, stalled: false, lastActive: Date.now() });
      if (running) {
        armWatchdog(sid);
      } else {
        clearWatchdog(sid);
      }
      break;
    }
    // ── 压缩生命周期（对齐 Hermes gateway-event.ts L1076-1081）：
    //    kind=compacting → 压缩中；kind=compacted → 压缩完成。
    //    Hermes 用 compactedTurnRef 记录开始态，恢复信号命中即提前退役；
    //    ELEVE 的 compacting 标志本身即"本次压缩中"，恢复信号分支直接清。 ──
    case 'status.update': {
      const kind = payload.kind as string | undefined;
      if (kind === 'compacting') {
        patch(sid, { compacting: true, lastActive: Date.now() });
      } else if (kind === 'compacted') {
        patch(sid, { compacting: false, lastActive: Date.now() });
      }
      break;
    }
    // ── 流活动证据：任何 delta/工具事件 = 会话正在工作（即时反馈，不等心跳） ──
    // 恢复信号（对齐 Hermes COMPACTION_RESUME_EVENT_TYPES）：压缩中收到首个
    // 模型输出/工具事件 = 摘要完成、turn 已恢复 → 提前退役压缩态（不依赖
    // compacted 事件——Hermes 同语义：mid-turn 压缩不重发 message.start）
    case 'message.start':
    case 'message.delta':
    case 'reasoning.available':
    case 'reasoning.delta':
    case 'thinking.delta':
    case 'tool.start':
    case 'tool.generating':
    case 'tool.progress':
    case 'step.complete': {
      patch(sid, { running: true, stalled: false, compacting: false, lastActive: Date.now() });
      armWatchdog(sid);
      break;
    }
    // ── turn 结束：running 归零；非活动会话完成 → unread（对齐 Hermes handleTransition） ──
    case 'message.complete':
    case 'error': {
      const wasRunning = (states[sid] ?? IDLE_STATE).running;
      clearWatchdog(sid);
      patch(sid, {
        running: false,
        needsInput: false,
        stalled: false,
        compacting: false, // 对齐 Hermes message.complete/error 清 compactedTurnRef（L544/L1158）
        unread: wasRunning && sid !== activeSessionId() ? true : (states[sid] ?? IDLE_STATE).unread,
        lastActive: Date.now(),
      });
      break;
    }
    // ── 进程生命周期事件：即时刷新后台进程状态（对齐 Hermes gateway-event 里
    //    tool.complete 后 refreshBackgroundProcesses 的触发点；无 process.start 事件
    //    （Hermes 同），进程启动由 5s 全量轮询兜底） ──
    // ── 进程启动（2026-08-30 新增事件）：点亮该会话灰点 ──
    // 后端：ProcessRegistry.on_start_tx → Gateway 广播 process.started
    // （registry.rs spawn 注册点 / api_server.rs 6-F2 监听块）
    case 'process.started': {
      const pid = flat.process_id as string | undefined;
      if (!pid) break;
      let set = backgroundProcesses.get(sid);
      if (!set) {
        set = new Set();
        backgroundProcesses.set(sid, set);
      }
      set.add(pid);
      patch(sid, { background: true, lastActive: Date.now() });
      break;
    }
    case 'tool.complete': {
      patch(sid, { running: true, stalled: false, lastActive: Date.now() });
      armWatchdog(sid);
      // 工具完成可能伴随进程启停；事件已覆盖绝大部分场景，这里只做补充对账
      void refreshBackgroundStatus();
      break;
    }
    // ── 进程结束：从集合移除，**集合空了才灭灰点** ──
    // 旧实现收到这个事件后又发一次全量 process.list，纯属浪费——
    // 事件本身已经告诉我们是哪个进程关了。
    case 'terminal.close': {
      const pid = flat.process_id as string | undefined;
      const set = backgroundProcesses.get(sid);
      if (pid && set) {
        set.delete(pid);
        if (set.size === 0) {
          backgroundProcesses.delete(sid);
          patch(sid, { background: false, lastActive: Date.now() });
        }
      } else {
        // 没有 process_id 或本地未记录该进程 → 退化成一次对账，别让状态卡住
        void refreshBackgroundStatus();
      }
      break;
    }
    default:
      break;
  }
});

// ── 后台进程状态：单点全量轮询（对齐 Hermes status-stack 5s 轮询语义；
//    全量查询一次覆盖所有会话，避免 per-session N 请求） ──

interface ProcessEntry {
  /** 🔴 注意：这个字段名叫 session_id，装的其实是**进程 id**（proc_<uuid>） */
  session_id?: string;
  /** Gateway 会话标识（2026-08-30 后端新增）：按会话聚合的权威路由键 */
  session_key?: string;
  status?: string;
}

/** 内存保护：完全空闲且长时间无活动的会话条目，淘汰掉（states 原本只增不减） */
const STATES_IDLE_TTL_MS = 30 * 60 * 1000;

async function refreshBackgroundStatus(): Promise<void> {
  try {
    const data = await call('process_list', {}) as { processes?: ProcessEntry[] } | null;
    if (!data?.processes) return;
    // 🔴 必须按 session_key 聚合，不能按 session_id——
    // session_id 实为 proc_<uuid> 进程 id，用它建条目会让 states 的 key 与
    // UI 查询用的真实 session id 对不上，background 灰点永远亮不起来
    // （这是本次顺带修掉的既有 bug，后端配合新增了 session_key 字段）。
    const running = new Map<string, Set<string>>();
    for (const p of data.processes) {
      if (p.status !== 'running') continue;
      const key = p.session_key;
      if (!key) continue;
      let set = running.get(key);
      if (!set) {
        set = new Set();
        running.set(key, set);
      }
      if (p.session_id) set.add(p.session_id);
    }

    // 以服务端为准重建本地进程集合：事件可能丢（WS 断线），对账时纠偏
    backgroundProcesses.clear();
    for (const [key, set] of running) {
      backgroundProcesses.set(key, new Set(set));
    }

    const known = new Set(Object.keys(states));
    for (const sid of known) {
      patch(sid, { background: running.has(sid) });
    }
    // 进程归属的会话可能不在本地列表（未加载）——仍收录，供后续行挂载时即时呈现
    for (const sid of running.keys()) {
      if (!known.has(sid)) {
        patch(sid, { background: true });
      }
    }

    // ── 内存保护：淘汰完全空闲且长期无活动的条目 ──
    // 被删的都是 idle 态，未收录的会话本来也返回 IDLE_STATE，UI 表现一致。
    const cutoff = Date.now() - STATES_IDLE_TTL_MS;
    let pruned: Record<string, SessionLiveState> | null = null;
    for (const [sid, st] of Object.entries(states)) {
      const idle =
        !st.running && !st.unread && !st.background && !st.compacting && !st.needsInput && !st.stalled;
      if (idle && st.lastActive > 0 && st.lastActive < cutoff) {
        if (!pruned) pruned = { ...states };
        delete pruned[sid];
      }
    }
    if (pruned) {
      states = pruned;
      emit();
    }
  } catch {
    // WS 未连接/暂不可用：下轮重试（对齐 Hermes 瞬态 socket loss 重试语义）
  }
}

let pollStarted = false;
function ensureBackgroundPolling(): void {
  if (pollStarted) return;
  pollStarted = true;
  void refreshBackgroundStatus();
  setInterval(() => void refreshBackgroundStatus(), BACKGROUND_POLL_MS);

  // WS 重连成功后立即对账一次：断线期间的进程启停事件会丢失，
  // 否则要等到下一个轮询周期才纠正，灰点会长时间停在错误状态。
  getWsClient().onStateChange((s) => {
    if (s === 'connected') void refreshBackgroundStatus();
  });
}
ensureBackgroundPolling();

/** 会话被打开时清除 unread（对齐 Hermes：打开即已读；UI 切换会话处调用） */
export function markSessionRead(sessionId: string): void {
  patch(sessionId, { unread: false });
}

// ── 订阅 hook ──

/**
 * 同步读取单个会话的实时状态（非 hook 版，供事件回调/useCallback 内使用，
 * 对齐 Hermes getter 语义）。未收录会话返回 IDLE。
 */
export function getSessionStatus(sessionId: string): SessionLiveState {
  return states[sessionId] ?? IDLE_STATE;
}

/**
 * 订阅单个会话的实时状态。快照引用稳定（无变化不重渲染，
 * 对齐 Hermes stableArray 防全列表重绘）。未收录会话返回 IDLE。
 */
export function useSessionStatus(sessionId: string): SessionLiveState {
  return useSyncExternalStore(
    subscribe,
    () => states[sessionId] ?? IDLE_STATE,
    () => IDLE_STATE,
  );
}
