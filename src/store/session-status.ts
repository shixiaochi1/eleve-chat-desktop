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

/** 对齐 Hermes status-stack BACKGROUND_POLL_MS = 5s：后台进程轮询间隔 */
export const BACKGROUND_POLL_MS = 5 * 1000;

// ── 内部状态 ──

let states: Record<string, SessionLiveState> = {};
const listeners = new Set<() => void>();
const watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

function activeSessionId(): string | null {
  return (storage.load('session_id', null) as string | null) ?? null;
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
    case 'tool.failed':
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
    case 'tool.complete': {
      patch(sid, { running: true, stalled: false, lastActive: Date.now() });
      armWatchdog(sid);
      void refreshBackgroundStatus();
      break;
    }
    case 'terminal.close':
      void refreshBackgroundStatus();
      break;
    default:
      break;
  }
});

// ── 后台进程状态：单点全量轮询（对齐 Hermes status-stack 5s 轮询语义；
//    全量查询一次覆盖所有会话，避免 per-session N 请求） ──

interface ProcessEntry {
  session_id?: string;
  status?: string;
}

async function refreshBackgroundStatus(): Promise<void> {
  try {
    const data = await call('process_list', {}) as { processes?: ProcessEntry[] } | null;
    if (!data?.processes) return;
    const runningIds = new Set(
      data.processes.filter((p) => p.status === 'running' && p.session_id).map((p) => p.session_id as string),
    );
    const known = new Set(Object.keys(states));
    for (const sid of known) {
      patch(sid, { background: runningIds.has(sid) });
    }
    // 进程归属的会话可能不在本地列表（未加载）——仍收录，供后续行挂载时即时呈现
    for (const sid of runningIds) {
      if (!known.has(sid)) {
        patch(sid, { background: true });
      }
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
