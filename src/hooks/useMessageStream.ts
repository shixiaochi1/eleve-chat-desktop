import { useRef, useCallback, useEffect, type MutableRefObject } from 'react';
import { useSSE, type SSECallbacks } from './useSSE';
// 🔴 2026-09-01 收敛：SessionManagerHandle 单一权威源 = useSessions（ReturnType 推导），
// 删除本文件原有的平行 interface 定义（已漂移：create 缺 cwd、缺 sessionReady）
import type { SessionManagerHandle } from './useSessions';
import * as storage from '../utils/storage';
import { profileFromSessionId, persistSessionPointer } from '../utils/session';
import { handleGlobalEvent } from '@/lib/global-events';
import { burstVibeHearts } from '@/lib/vibe-hearts';
import { writeAgentTerminalChunk } from '@/lib/agent-terminal-stream';
import {
  setMessages as storeSetMessages,
  getMessages,
  updateMessage,
  setIsStreaming as storeSetIsStreaming,
} from '../store/messages';
import { type DebugToolCall, type MonitorState } from '../store/debug';
import {
  textPart,
  reasoningPart,
  upsertToolPart,
  appendTextPart,
  appendReasoningPart,
  finalContinuesInterim as finalContinuesInterimPredicate,
  type ChatMessagePart,
  type GatewayEventPayload,
} from '@/lib/chat-messages';
import { extractPendingInteractions } from '@/lib/ws-event-processor';
import { completionErrorText } from '@/lib/completion-error';
import type { ChatMessage } from '@/types';
import type { Session } from '@/types';

// ── 调试侧边栏刷屏修复（2026-08-15）──────────────────────────────
// 子 Agent 每个文本 delta 都是一条 delegate.progress WS 帧；调试面板按帧
// 记行且旧格式只显示 goal 前缀 → 同一子 Agent 信息重复刷屏。
// subagent.text 按 subagentId 节流合并：800ms 一窗，只记一行（累计字数 +
// 末段预览）；完整轨迹由 SubagentMonitor trace（cap 60）承载。
const SUBAGENT_TEXT_COALESCE_MS = 800;
const subagentTextCoalesce = new Map<string, { lastFlush: number; chars: number }>();

/** 构造 delegate_progress 调试行（事件区分内容，替代统一 goal 前缀） */
function buildDelegateProgressDebugLine(
  eventType?: string,
  payload?: { goal?: string; toolName?: string; toolPreview?: string; progressSummary?: string; summary?: string; status?: string },
): string {
  switch (eventType) {
    case 'subagent.tool':
      return `subagent.tool ${payload?.toolName || ''}`;
    case 'subagent.progress':
      return `subagent.progress ${payload?.progressSummary || ''}`;
    case 'subagent.complete':
      return `subagent.complete ${payload?.summary || payload?.status || ''}`.trim();
    default:
      return `${eventType || ''} ${payload?.goal?.slice(0, 40) || payload?.toolName || ''}`;
  }
}

// 🔴 2026-09-01 内存修复（审查 P0-3）：delegateTasks 生命周期治理——此前
// 只增不减：每个历史子 Agent 的 outputTail/toolArgs/thinkingText/lastText/
// files* 大字段跨会话、跨 turn 永驻（长跑编排场景线性增长，无任何上限）。
// 策略：终态条目剥离大体积低回看价值字段 + 截断保留有显示价值的文本字段
// （复核修正：SubagentMonitor 完成卡片消费 thinkingText/lastText 渲染
// "思考：/回复："行——整字段剥离 = 丢显示，改为 cap 200 字符截断保留）；
// 总量超上限按插入序淘汰最旧终态条目。running 条目受 ToolStatusBar
// delegation.status 水合依赖保护，永不淘汰、不剥离（活跃卡片需全量渲染）。
const DELEGATE_TASKS_MAX = 40;
// 🔴 2026-09-01 复核对齐后端枚举（crates/eleve-tools-native/src/delegate/types.rs:39-40
// "completed, failed, interrupted, error" + interrupted_result()；eleve-core lib.rs:2910
// 文档另声称 timeout 对齐 Hermes）——原白名单漏 'interrupted'（父 Agent 中断子任务的
// JoinError cancelled 路径，常见操作）→ 被中断的子 Agent 条目误判 running → 大字段
// 永不剥离 + 永不参与上限淘汰 = 泄漏。白名单语义"宁多勿缺"：漏判=泄漏，多判=无害
// （后端 running 恒为 'running' 字面量；aborted/cancelled/timeout 为防御性保留）。
const DELEGATE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'error', 'interrupted', 'timeout', 'aborted', 'cancelled']);
/** 完成态文本保留上限：SubagentMonitor 显示 truncate 一行 + title 悬停预览，200 字符足够 */
const DONE_TEXT_KEEP_CHARS = 200;

function clampDoneText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.length > DONE_TEXT_KEEP_CHARS ? v.slice(0, DONE_TEXT_KEEP_CHARS) + '…' : v;
}

function stripDelegateHeavyFields(t: Record<string, unknown>): Record<string, unknown> {
  // 剥离：outputTail（输出尾部快照）、toolArgs（工具完整参数 JSON）、files*（读/写文件列表）——无消费方
  // 截断保留：thinkingText/lastText（完成卡片"思考：/回复："行，cap 200）
  // 保留：trace（cap 60 行，过程回看）、summary/status/duration/tokens/cost 等
  const { outputTail, toolArgs, filesRead, filesWritten, thinkingText, lastText, ...rest } = t;
  const ct = clampDoneText(thinkingText);
  const cl = clampDoneText(lastText);
  if (ct !== undefined) rest.thinkingText = ct;
  if (cl !== undefined) rest.lastText = cl;
  return rest;
}

function governDelegateTasks(tasks: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(tasks);
  const isTerminal = (t: unknown) =>
    DELEGATE_TERMINAL_STATUSES.has(String((t as { status?: unknown } | undefined)?.status ?? ''));
  const running = entries.filter(([, t]) => !isTerminal(t));
  let done = entries.filter(([, t]) => isTerminal(t));
  // 超限淘汰最旧终态（Object.entries 序 = 插入序，保留最新的 40 条）
  if (done.length > DELEGATE_TASKS_MAX) done = done.slice(done.length - DELEGATE_TASKS_MAX);
  return Object.fromEntries([...running, ...done.map(([k, t]) => [k, stripDelegateHeavyFields(t as Record<string, unknown>)])]);
}


// ── Props type ──

export interface UseMessageStreamProps {
  genId: () => string
  addDebugEvent: (type: string, detail: string) => void
  setConnectionStatus: React.Dispatch<React.SetStateAction<string>>
  setDebugToolCalls: React.Dispatch<React.SetStateAction<DebugToolCall[]>>
  setMonitorState: React.Dispatch<React.SetStateAction<MonitorState>>
  // 🔴 2026-08-17 阶段4：交互回调改为带 session_id 的值语义（App 侧按会话
  // 多槽存储——per-session 并发轮架构下后台会话的交互必须可见可响应）
  // null = 该会话 pending 快照为空（session.info 权威）→ 清该会话项
  setActiveClarify: (data: { session_id?: string; clarify_id: string; question: string; choices: string[]; multi_select?: boolean } | null) => void
  /** 🔴 批量澄清（一次表单多题，对齐 Hermes questions batch） */
  setActiveClarifyBatch?: (data: {
    session_id?: string
    clarify_id: string
    title?: string | null
    questions: { qid: string; id?: string | null; question: string; choices?: string[] | null; multi_select?: boolean }[]
  } | null) => void
  setActiveApproval: (data: { session_id?: string; command: string; description: string; pattern: string; choices: string[]; run_id: string } | null) => void
  setActiveSudo?: (data: { session_id?: string; request_id: string; prompt?: string } | null) => void
  setActiveSecret?: (data: { session_id?: string; request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> } | null) => void
  /** 🔴 2026-08-17 阶段4：审批被其他路径响应后按会话关闭卡片（run_id = session_id） */
  closeApproval?: (sessionId: string) => void
  setActiveSlashConfirm?: React.Dispatch<React.SetStateAction<{ confirmId: string; command: string; description: string } | null>>
  /** 🔴 W-7: 会话 cwd 同步（session.info 推送）— 供 PreviewPanel 重启预览等消费 */
  setSessionCwd?: React.Dispatch<React.SetStateAction<string>>
  sess: SessionManagerHandle
  drainQueueRef: MutableRefObject<(() => void) | null>
  setSessionListVersion?: React.Dispatch<React.SetStateAction<number>>
  /** 🔴 宫格/单视图互斥：grid 模式传 false 暂停 useSSE（useGridChat 接管 WS 事件） */
  enabled?: boolean
}

/**
 * Queued deltas — same shape as Eleve QueuedStreamDeltas.
 * We accumulate *incremental deltas* here (not fullText), then flush
 * them into the store via mutateStream.
 */
interface QueuedStreamDeltas {
  assistant: string
  reasoning: string
}

// Minimum gap between two assistant-text flushes — same as Eleve (33ms).
const STREAM_DELTA_FLUSH_MS = 33
// 🔴 #3（对齐 Hermes utils.ts:73 MAX_STREAM_FLUSH_GAP_MS）：自适应 flush 上限——
// 昂贵 flush 延到 250ms（4/s 文本增长下限），防多流并发时主线程卡顿。
const MAX_STREAM_FLUSH_GAP_MS = 250

/**
 * useMessageStream — SSE streaming callbacks, aligned 1:1 with Eleve
 *
 * Key architecture (matching Eleve use-message-stream.ts):
 * 1. streamId — unique ID for each streaming turn, guarantees only ONE
 *    assistant message is ever created per response.
 *    [FIX #1] Lazy creation in mutateStream — if streamId is null when
 *    the first delta arrives, auto-allocate one (same as Eleve).
 * 2. mutateStream — single entry point for all message mutations.
 *    Checks streamId to decide: create new or update existing.
 * 3. queueDelta + flushQueuedDeltas — accumulates incremental deltas
 *    (not fullText), then flushes via mutateStream at ~30fps.
 *    [FIX #2] onText receives (delta, fullText) — queueDelta uses delta
 *    for incremental streaming.
 * 4. Tool events flush text deltas BEFORE upserting tool parts.
 * 5. completeAssistantMessage — on 'done', replaces streaming message parts
 *    with drainFinalParts() from the shared StreamAccumulator.
 *    (3.3: 消灭影子累加器 fullTextRef，单一权威源 ws-event-processor)
 * 6. [FIX #4] reasoning.available triggers start (creates empty reasoning part),
 *    same as Eleve appendReasoningDelta with replace=true.
 */
export function useMessageStream({
  genId,
  addDebugEvent,
  setConnectionStatus,
  setDebugToolCalls,
  setMonitorState,
  setActiveClarify,
  setActiveApproval,
  setActiveSudo,
  setActiveSecret,
  setActiveClarifyBatch,
  closeApproval,
  setActiveSlashConfirm,
  setSessionCwd,
  sess,
  drainQueueRef,
  setSessionListVersion,
  enabled = true,
}: UseMessageStreamProps): {
  isStreaming: boolean
  send: (text: string, sessionId?: string | null, modelOpts?: { model?: string; provider?: string }) => Promise<void>
  abort: () => Promise<void>
  resetStream: (nextSessionId?: string | null) => void
  /** 🔴 当前显示 session 的同步权威 ref（resetStream 同步锁定）——loadHistory 过期响应守卫必须比它，不能比异步 sess.sessionId */
  currentSessionIdRef: MutableRefObject<string | null>
} {
  // ── Stream ID — same as Eleve: one unique ID per streaming turn ──
  // [FIX #1] Lazy creation: mutateStream auto-allocates if null
  const streamIdRef = useRef<string | null>(null)

  // ── Queued deltas — accumulated incremental deltas (Eleve pattern) ──
  const queuedDeltasRef = useRef<QueuedStreamDeltas>({ assistant: '', reasoning: '' })
  const flushHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlushAtRef = useRef<number>(0)
  // 🔴 #3：上次 flush 实测耗时（ms）→ 自适应间隔 = max(33, cost*3) capped 250
  const lastFlushCostRef = useRef<number>(0)
  // 🔴 #4：turn 结束标志（对齐 Hermes state.interrupted 语义）——onDone（含 abort 路径）
  // 置 true 后丢弃迟到 delta（mutateStream 入口守卫），onRunStart 重置。
  // Hermes 注释原话：迟到事件会 seed 一条"看起来属于下一条用户消息"的全新气泡。
  const turnEndedRef = useRef<boolean>(false)
  // 🔴 #6b：interim 边界已发生标志（对齐 Hermes state.interimBoundaryPending）——
  // interim 密封时置位，complete 消费后清位。语义：interim 边界后的 complete 就是
  // 同一轮的回答，应原地 settle（Hermes index.ts:563 无条件 settle 分支；ELEVE 后端
  // 无 response_previewed 字段，responsePreviewed 场景不存在，interimSealedRef 覆盖其
  // "final 被重写不再共享前缀"的等价格——#63679 修复族）。
  const interimSealedRef = useRef<boolean>(false)
  // 🔴 #7：侧边栏刷新合并（对齐 Hermes scheduleSessionsRefresh index.ts:145-173）——
  // 300ms debounce，多次 completion 合并为一次 refresh，防多会话并发时列表频繁刷新
  const sessionsRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 🔴 多 Agent 隔离：跟踪当前显示的 session_id，传给 useSSE 做 WS 事件过滤
  const currentSessionIdRef = useRef<string | null>(sess.sessionId)
  useEffect(() => { currentSessionIdRef.current = sess.sessionId }, [sess.sessionId])

  const sseCallbacks = useRef<SSECallbacks>({});

  // ── Cleanup on unmount — flush any remaining deltas ──
  useEffect(() => {
    return () => {
      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current)
        flushHandleRef.current = null
      }
      // 🔴 P3-2（Coder 复审 2026-08-09）：unmount 漏清 sessionsRefreshRef timer
      //（对齐 Hermes index.ts:175-183）。React 18 下仅潜在 no-op setState 警告，低风险。
      if (sessionsRefreshRef.current !== null) {
        clearTimeout(sessionsRefreshRef.current)
        sessionsRefreshRef.current = null
      }
    }
  }, [])

  // ── scheduleSessionsRefresh — 对齐 Hermes index.ts:145-173 ──
  // 300ms debounce：多次 completion 合并为一次 refresh（标题更新后列表已变）
  const scheduleSessionsRefresh = useCallback(() => {
    if (sessionsRefreshRef.current !== null) return
    sessionsRefreshRef.current = setTimeout(() => {
      sessionsRefreshRef.current = null
      sess.refresh()
      if (setSessionListVersion) setSessionListVersion(v => v + 1)
    }, 300)
  }, [sess, setSessionListVersion])

  // ── mutateStream — 1:1 from Eleve mutateStream ──
  // Single entry point for all streaming message mutations.
  // Uses streamId to guarantee at most ONE assistant message per turn.
  // [FIX #1] Lazy streamId: if null, auto-allocate (same as Eleve).
  const mutateStream = useCallback(
    (
      transform: (parts: ChatMessagePart[], message: ChatMessage) => ChatMessagePart[],
      seed: () => ChatMessagePart[],
      opts: { pending?: (message: ChatMessage) => boolean } = {},
    ) => {
      // [FIX #1] Lazy creation — same as Eleve:
      // state.streamId ?? `assistant-stream-${Date.now()}`
      if (!streamIdRef.current) {
        streamIdRef.current = `assistant-stream-${Date.now()}`
      }
      const streamId = streamIdRef.current

      storeSetMessages((prev) => {
        // 🔴 #4：中断守卫（对齐 Hermes index.ts:94-100，位于 mutateStream 状态回调入口）——
        // 停止/完成后迟到的 delta/tool 事件直接丢弃，不得 seed 新气泡（Hermes 注释原话：
        // "a brand-new bubble that appears to belong to the next user message"）
        if (turnEndedRef.current) {
          return prev
        }
        if (prev.some(m => m.id === streamId)) {
          // Message exists — transform its parts
          return prev.map(m =>
            m.id === streamId
              ? {
                  ...m,
                  parts: transform(m.parts, m),
                  pending: opts.pending ? opts.pending(m) : true,
                }
              : m
          )
        }
        // Message doesn't exist yet — seed it with id = streamId
        return [
          ...prev,
          {
            id: streamId,
            role: 'assistant' as const,
            parts: seed(),
            pending: true,
            timestamp: Date.now(),
          },
        ]
      })
    },
    [],
  )

  // ── flushQueuedDeltas — 1:1 from Eleve flushQueuedDeltas ──
  // Takes accumulated deltas from queue, applies them via mutateStream.
  // [FIX] 合并 text + reasoning 为一次 mutateStream 调用，避免双次 React re-render
  const flushQueuedDeltas = useCallback(() => {
    const queued = queuedDeltasRef.current
    queuedDeltasRef.current = { assistant: '', reasoning: '' }

    if (!queued.assistant && !queued.reasoning) return

    // 合并：一次 mutateStream 同时处理 text 和 reasoning
    mutateStream(
      (parts) => {
        let result = parts
        if (queued.reasoning) {
          result = appendReasoningPart(result, queued.reasoning)
        }
        if (queued.assistant) {
          result = appendTextPart(result, queued.assistant)
        }
        return result
      },
      () => {
        const seed: ChatMessagePart[] = []
        if (queued.reasoning) seed.push(reasoningPart(queued.reasoning))
        if (queued.assistant) seed.push(textPart(queued.assistant))
        return seed
      },
    )
  }, [mutateStream])

  // ── scheduleDeltaFlush — 对齐 Hermes index.ts:255-291 ──
  // 🔴 #3：恒用 setTimeout，绝不用 requestAnimationFrame。Chromium 对隐藏 renderer
  // 暂停 rAF（最小化/离屏/compositor parked 都算）——rAF 门控的 flush 永不执行，
  // 完整回答堆在队列里直到某次输入/聚焦唤醒帧，表现=回复停滞、切回时一次性涌出。
  // Timer 保持同样的合并节奏（floor 就是为此）且无需交互保证送达；后台 renderer
  // 只钳制 timer 不挂起，流式期间的 unthrottle 连钳制都解除。
  // 自适应间隔：yield 3x 实测成本——廉价 flush 保持 30fps 文本增长，昂贵多流 flush
  // 降文本 fps 而非交互性，capped 250ms 保证文本更新不低于 4/s。
  const scheduleDeltaFlush = useCallback(() => {
    if (flushHandleRef.current !== null) return

    const sinceLast = performance.now() - lastFlushAtRef.current
    const adaptiveFloor = Math.min(
      Math.max(STREAM_DELTA_FLUSH_MS, lastFlushCostRef.current * 3),
      MAX_STREAM_FLUSH_GAP_MS,
    )

    const runFlush = () => {
      flushHandleRef.current = null
      const startedAt = performance.now()
      lastFlushAtRef.current = startedAt
      flushQueuedDeltas()
      lastFlushCostRef.current = performance.now() - startedAt
    }

    flushHandleRef.current = window.setTimeout(
      runFlush,
      Math.max(0, adaptiveFloor - sinceLast),
    )
  }, [flushQueuedDeltas])

  // ── queueDelta — 1:1 from Eleve queueDelta ──
  // 🔴 2026-08-10 修复（工具卡住根因）：timer 失效兜底——Chromium 对隐藏/遮挡
  // renderer 深度节流 setTimeout（实测 33ms 定时器 31.5s 不触发）→ 流式 delta
  // 无限累积 → UI 无渲染（"任务期间不回复"）→ 任务完成 onDone 一次性 flush
  // （"一股脑全发出来"）。修复：WS 消息驱动 flush——距上次 flush 超过 33ms 阈值
  // 立即 flush（WS onmessage 处理不受 timer 节流影响），timer 仅作最后残留 delta
  // 兜底（隐藏时最坏延迟 1s，可接受；visible 时 33ms 准时）。
  const queueDelta = useCallback(
    (key: keyof QueuedStreamDeltas, delta: string) => {
      if (!delta) return
      queuedDeltasRef.current[key] += delta
      // 🔴 2026-08-10：消息驱动 flush（不依赖 timer）
      const now = performance.now()
      if (now - lastFlushAtRef.current >= STREAM_DELTA_FLUSH_MS) {
        flushQueuedDeltas()
      } else {
        scheduleDeltaFlush()
      }
    },
    [scheduleDeltaFlush, flushQueuedDeltas],
  )

  // ── upsertToolCall — 1:1 from Eleve upsertToolCall ──
  // 🔴 2026-08-11 双卡修复（interim 密封分叉）：interim 密封置 streamId=null 后，
  // 迟到的工具事件（tool.start/complete）经 mutateStream 懒分配新气泡 → 同一
  // callId 的工具卡分叉成两张（密封消息里的卡永远 pending 无 duration + 新消息里的
  // 卡 done 有 duration）= 老大看到的"工具重复：说话前无时间、说话后有时间"
  // （实证：500785f7 会话 [1] write_file 卡 duration=None + [2] 同 callId duration=0.0068）。
  // 修复：streamId=null 时，工具事件复用最近一条 interim/流式 assistant 消息
  // （工具卡属于当前上下文消息，对齐 Hermes 语义），不再新建气泡；
  // 文本 delta 仍走原分界（新建气泡）不受影响。
  const upsertToolCall = useCallback(
    (payload: GatewayEventPayload | undefined, phase: 'running' | 'complete') => {
      if (!streamIdRef.current) {
        const msgs = getMessages()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (!m || m.hidden || m.role !== 'assistant') continue
          if (m.interim || m.pending) {
            streamIdRef.current = m.id
            break
          }
          break // 再往前没有流式上下文，不跨消息复用
        }
      }
      mutateStream(
        parts => upsertToolPart(parts, payload, phase),
        () => upsertToolPart([], payload, phase),
        { pending: m => phase !== 'complete' || (m.pending ?? false) }
      )
    },
    [mutateStream],
  )

  // ── completeAssistantMessage — 3.3: 改用 drainFinalParts 共享累加器权威 parts ──
  // On stream end, replace streaming message parts with accumulator-finalized parts.
  // 消灭旧版 fullTextRef 影子累加器 + reasoning 去重 hack（累加器已正确分离 reasoning/text）。
  // 🔴 C-1（2026-08-08）：failure 语义对齐 Hermes index.ts L558-565——
  // failure.error 时消息带 error 标记（MessageRow 渲染 type=error 气泡）；
  // partial=true 保留流式文本（错误帧的部分输出），非 partial 剥文本只显错误。
  // 🔴 C-2（2026-08-08）：legacy 错误文本启发式——结构化 failure 优先，否则
  // 匹配 "API call failed after N retries:" / "HTTP xxx" / "Provider error:" 文本
  // （对齐 Hermes completionErrorText），同样标 error 剥文本。
  const completeAssistantMessage = useCallback(
    (finalParts: ChatMessagePart[], failure?: { error: string; partial: boolean }) => {
      const streamId = streamIdRef.current
      streamIdRef.current = null // Clear streamId — turn is over
      // 🔴 #6b: complete 无条件清 interim 边界标志（对齐 Hermes index.ts:596
      // interimBoundaryPending: false——无论 settle 还是新建）
      interimSealedRef.current = false

      // 对齐 Hermes：completionError = 结构化 failure 优先，legacy 文本启发式兜底
      const finalText = finalParts
        .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('')
      const completionError = failure?.error ?? completionErrorText(finalText)
      const keepFailedPartialText = Boolean(failure?.partial && finalText)

      // 对齐 Hermes：非 partial 错误剥除文本 parts（仅保留 reasoning/tool 骨架），
      // 避免错误帧的半截文本被当成正常回复
      const effectiveParts =
        completionError && !keepFailedPartialText
          ? finalParts.filter((p) => p.type !== 'text')
          : finalParts

      storeSetMessages((prev) => {
        const errorField = completionError ? { error: completionError } : {}
        if (streamId && prev.some(m => m.id === streamId)) {
          // Found our streaming message — finalize with accumulator parts
          return prev.map(m => {
            if (m.id !== streamId) return m
            return {
              ...m,
              parts: effectiveParts.length ? effectiveParts : m.parts,
              pending: false,
              ...errorField,
            }
          })
        }

        // Fallback: 对齐 Hermes index.ts:528-582 去重决策树——找最后一条 assistant
        //（不限 pending；Hermes 是 `!m.hidden`），按 pending / interim 延续 / exact match
        // 分流 settle，防重复气泡：
        //  - pending → 原地 settle（原逻辑）
        //  - interim && finalContinuesInterim（文本前缀互匹配，Hermes :552-557）→
        //    原地 settle（工具轮次密封的 interim 就是同一轮的回答，#63679）
        //  - 非 interim && exact match → settle（finalizeStepBoundary 密封后 complete
        //    到达且文本一致——修正 2 确认的现实重复路径，旧 fallback 只查 pending 漏掉）
        const fallbackIndex = [...prev]
          .reverse()
          .findIndex(m => m.role === 'assistant' && !m.hidden)

        if (fallbackIndex >= 0) {
          const index = prev.length - 1 - fallbackIndex
          const existing = prev[index]
          const existingText = existing.parts
            .filter((p): p is Extract<ChatMessagePart, { type: 'text' }> => p.type === 'text')
            .map((p) => p.text)
            .join('')
            .trim()
          // 🔴 P2-2（Coder 复审 2026-08-09）：finalContinuesInterim 抽共享谓词
          //（chat-messages.ts 单一权威源），宫格/单视图同语义。
          const finalContinuesInterim = existing.interim
            ? finalContinuesInterimPredicate(existing, finalText)
            : false

          const settleInPlace = existing.pending ||
            (existing.interim && (interimSealedRef.current || finalContinuesInterim)) ||
            (!existing.interim && Boolean(finalText) && existingText === finalText)

          if (settleInPlace) {
            return prev.map((m, i) => {
              if (i !== index) return m
              return {
                ...m,
                parts: effectiveParts.length ? effectiveParts : m.parts,
                pending: false,
                interim: false,
                ...errorField,
              }
            })
          }
        }

        // No pending/sealed interim to settle — create a completed one
        if (effectiveParts.length || completionError) {
          return [...prev, { id: genId(), role: 'assistant' as const, parts: effectiveParts, pending: false, timestamp: Date.now(), ...errorField }]
        }
        return prev
      })
    },
    [genId],
  )

  // ── 🔴 Phase 2: 独立消息追加（系统提示/中间消息/委托 — 审查 #2/#13 修复）──
  // 旧实现经 mutateStream 混进流式助手气泡（绕过累加器 → 完成时被 finalize 整体替换抹掉）。
  // 新实现：独立消息入 store。流式进行中插到 in-flight 气泡之前，
  // 对齐宫格“messages 在前、流式气泡殿后”的视觉顺序（两视图同事件同产物）。
  const appendIndependentMessage = useCallback((msg: ChatMessage) => {
    storeSetMessages((prev) => {
      const streamId = streamIdRef.current;
      if (streamId) {
        const idx = prev.findIndex(m => m.id === streamId);
        if (idx >= 0) return [...prev.slice(0, idx), msg, ...prev.slice(idx)];
      }
      return [...prev, msg];
    });
  }, []);

  // ── finalizeStepBoundary — 对齐 Hermes _emit_interim_assistant_message 消息分界 ──
  // step.complete 到达时：当前步骤的 text + tool parts 已全量流入，
  // 将当前流式消息标记完成（pending:false）并重置 streamId，
  // 下一步的 delta 自动创建新消息气泡。
  const finalizeStepBoundary = useCallback(() => {
    // 先刷尽排队 delta，确保当前步骤文本完整
    if (flushHandleRef.current !== null) {
      clearTimeout(flushHandleRef.current)
      flushHandleRef.current = null
    }
    flushQueuedDeltas()

    const streamId = streamIdRef.current
    if (!streamId) return

    // 标记当前消息完成（保留 parts 原样，不做文本替换）
    storeSetMessages((prev) =>
      prev.map(m => m.id === streamId ? { ...m, pending: false } : m)
    )

    // 重置：下一步 delta 会创建新消息
    streamIdRef.current = null
  }, [flushQueuedDeltas])

  // ── SSE streaming callbacks — aligned with Eleve handleGatewayEvent ──
  sseCallbacks.current = {
    // 🔴 2026-08-13 对齐修复：项目数据变化 → bump sessionListVersion →
    // ProjectTreePanel [sessionId, sessionListVersion] effect 自动静默刷新树
    onProjectsChanged: () => {
      if (setSessionListVersion) setSessionListVersion(v => v + 1)
    },

    // ── Text delta — 1:1 with Eleve message.delta ──
    // queueDelta uses the INCREMENTAL delta.
    // 3.3: fullText 不再追踪 — onDone 走 drainFinalParts() 从共享累加器取权威 parts
    onText: (delta: string) => {
      queueDelta('assistant', delta)
    },

    // ── Reasoning delta — 1:1 with Eleve reasoning.delta ──
    onReasoning: (delta: string) => {
      queueDelta('reasoning', delta)
    },

    // reasoning.available = 推理块完成后的摘要（对齐 Hermes appendReasoningDelta(text, true) replace 语义）
    // 🔴 2026-08-08 对齐 Hermes（老大纠正）：Hermes 基线 reasoning.delta 流式必推 +
    // reasoning.available 完成态带摘要；reasoning.end 是 ELEVE 自创（Hermes 无）已删。
    // replace：移除全部 reasoning 块 → 冻结摘要块（done=true 保持多块边界，
    // 下一个 reasoning.delta 经 appendReasoningPart 自然新开块）。
    // 守卫：消息已有正文文本时不替换（对齐 Hermes chatMessageText 守卫，推理块保留）。
    onReasoningAvailable: (text: string) => {
      flushQueuedDeltas()
      const streamId = streamIdRef.current
      if (!streamId) return
      if (!getMessages().some(m => m.id === streamId)) return
      mutateStream(
        (parts, message) => {
          if (message.parts.some(p => p.type === 'text' && p.text)) return parts
          return [...parts.filter((p) => p.type !== 'reasoning'), { ...reasoningPart(text), done: true }]
        },
        () => [{ ...reasoningPart(text), done: true }],
        { pending: m => m.pending ?? true },
      )
    },
    // ── Tool start — 1:1 with Eleve tool.start ──
    // KEY: flush queued text/reasoning BEFORE upserting tool part.
    onToolStart: ({ id, name, preview }: { id: string | null; name: string; preview?: string }) => {
      addDebugEvent('tool_start', `${name} (${id?.slice(0, 8)})${preview ? ` - ${preview}` : ''}`);
      // 🔴 2026-08-05 去重：同一 callId 已存在（如历史双推/重连重放）→ 更新不新增，
      // 防 DebugPanel 工具记录重复显示（后端 ToolCallStart 双推已修，此处兜底）
      setDebugToolCalls((prev) => {
        if (id && prev.some((t) => t.callId === id)) {
          return prev.map((t) => t.callId === id ? { ...t, name: name || t.name, preview } : t);
        }
        return [...prev, { name, callId: id || '', args: '', result: '', status: 'pending' }];
      });
      flushQueuedDeltas()
      const toolPayload: GatewayEventPayload = { tool_call_id: id || '', name, preview };
      upsertToolCall(toolPayload, 'running');
    },

    onToolArgs: ({ id, accumulated }: { id: string; delta?: string; accumulated: string }) => {
      setDebugToolCalls((prev) => prev.map((t) => t.callId === id ? { ...t, args: accumulated } : t));
      flushQueuedDeltas()
      let parsedArgs: Record<string, unknown> = {};
      try {
        if (accumulated && accumulated.trim()) {
          parsedArgs = JSON.parse(accumulated);
        }
      } catch { /* ignore parse errors for partial streaming args */ }
      const toolPayload: GatewayEventPayload = { tool_call_id: id, args: parsedArgs };
      upsertToolCall(toolPayload, 'running');
    },

    // ── Tool end — 1:1 with Eleve tool.complete ──
    onToolEnd: ({ id, name, duration, error }: { id: string | null; name: string; duration?: number; error?: boolean }) => {
      addDebugEvent('tool_complete', `${name || 'tool'} (${id?.slice(0, 8)})${duration ? ` ${duration.toFixed(1)}s` : ''}${error ? ' ❌' : ''}`);
      setDebugToolCalls((prev) => prev.map((t) => t.callId === id ? { ...t, status: 'done' } : t));
      flushQueuedDeltas()
      const toolPayload: GatewayEventPayload = { tool_call_id: id || '', name, duration, error };
      upsertToolCall(toolPayload, 'complete');
    },

    onUsage: ({ input, output }: { input: number; output: number }) => {
      addDebugEvent('usage', `↑${input} ↓${output}`);
      setMonitorState((prev) => ({ ...prev, tokensIn: (prev.tokensIn as number || 0) + input, tokensOut: (prev.tokensOut as number || 0) + output }));
      const streamId = streamIdRef.current
      if (streamId) {
        updateMessage(streamId, { inputTokens: input, outputTokens: output })
      }
    },

    onModelName: (name: string) => {
      addDebugEvent('model', name);
      setMonitorState((prev) => ({ ...prev, modelName: name }));
    },

    onRunStart: (sessionId: string) => {
      // 🔴 #4：新 turn 开始 → 解除中断封锁（迟到 delta 重新放行）
      turnEndedRef.current = false
      // 🔴 #6b: 新 turn 清 interim 边界标志（对齐 Hermes gateway-event.ts:573
      // message.start 重置 interimBoundaryPending: false）
      interimSealedRef.current = false
      if (sessionId && sessionId !== sess.sessionId) {
        addDebugEvent('run_start', `new session: ${sessionId?.slice(0, 8)}`);
        if (sess.sessionId && getMessages()?.length) {
          sess.saveCache((cache) => ({ ...cache, [sess.sessionId!]: getMessages() }));
        }
        sess.setSessionId(sessionId);
        persistSessionPointer(sessionId);
        setMonitorState((prev) => ({ ...prev, sessionStartedAt: Date.now() }));
        if (setSessionListVersion) setSessionListVersion(v => v + 1);
        // 同步 WS 连接到新 session
        import('@/services/ws-client').then(({ getWsClient }) => {
          const wsClient = getWsClient();
          if (wsClient.state === 'connected') {
            wsClient.switchSession(sessionId);
          }
        });
      }
      // Allocate streamId — if already set by lazy creation, keep it
      if (!streamIdRef.current) {
        streamIdRef.current = `assistant-stream-${Date.now()}`
      }
    },

    onDelegateStart: ({ taskId, goal, model, sessionId }: { taskId: string; goal?: string; model?: string; sessionId?: string }) => {
      addDebugEvent('delegate', `start: ${goal?.slice(0, 50)}`);
      // 🔴 2026-08-18 会话隔离加固：事件缺 session_id 时兜底打标当前流会话
      // （sse_data 恒注入父会话 sid，兜底仅防漏标——无标任务会在
      // 无会话上下文的空态抽屉里跨会话串显）
      const sid = sessionId ?? sess.sessionId ?? undefined;
      setMonitorState((prev) => ({
        ...prev,
        delegateTasks: { ...((prev.delegateTasks as Record<string, unknown>) || {}), [taskId]: { id: taskId, goal, model, status: 'running', startTs: Date.now(), sessionId: sid } },
      }));
      // 🔴 Phase 2: 独立 system 消息（对齐宫格 useGridChat delegate.start）
      appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(`▶ 委托子 Agent: ${goal || taskId}`)], timestamp: Date.now() });
    },

    onDelegateEnd: ({ taskId, status, summary, model, tokensInput, tokensOutput, duration, sessionId }: { taskId: string; status?: string; summary?: string; model?: string; tokensInput?: number; tokensOutput?: number; duration?: number; sessionId?: string }) => {
      const sid = sessionId ?? sess.sessionId ?? undefined;
      setMonitorState((prev) => {
        const next = { ...((prev.delegateTasks as Record<string, unknown>) || {}) };
        if (next[taskId]) {
          next[taskId] = { ...(next[taskId] as Record<string, unknown>), status, summary, tokensInput, tokensOutput, duration, sessionId: sid };
        }
        return { ...prev, delegateTasks: next };
      });
      // 🔴 Phase 2: 独立 system 消息（对齐宫格 useGridChat delegate.end）
      appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(`✔ 子 Agent 完成: ${summary || status || 'done'}`)], timestamp: Date.now() });
    },

    onClarify: ({ session_id, clarify_id, question, choices, multi_select }: { session_id?: string; clarify_id: string; question: string; choices?: string[]; multi_select?: boolean }) => {
      addDebugEvent('clarify', question.slice(0, 60));
      setActiveClarify({ session_id, clarify_id, question, choices: choices ?? [], multi_select });
    },

    // 🔴 批量澄清（一次表单多题，对齐 Hermes questions batch）
    onClarifyBatch: ({ session_id, clarify_id, title, questions }: { session_id?: string; clarify_id: string; title?: string | null; questions: { qid: string; id?: string | null; question: string; choices?: string[] | null; multi_select?: boolean }[] }) => {
      addDebugEvent('clarify.batch', `q=${questions.length} ${title ?? ''}`.slice(0, 60));
      setActiveClarifyBatch?.({ session_id, clarify_id, title, questions });
    },

    onApproval: (data: unknown) => {
      const d = data as { command?: string };
      addDebugEvent('approval', (d.command?.slice(0, 60)) ?? '');
      setActiveApproval(data as any);
    },

    // 🔴 对齐 Hermes: 收到 approval.responded 事件时关闭弹窗
    onApprovalResponded: (data: { run_id: string; choice: string; resolved: number }) => {
      addDebugEvent('approval.responded', `run_id=${data.run_id} choice=${data.choice} resolved=${data.resolved}`);
      // 🔴 2026-08-17 阶段4：按会话关闭（多槽交互；run_id = session_id）
      closeApproval?.(data.run_id);
    },

    onSudo: (data: { session_id?: string; request_id: string; prompt?: string }) => {
      addDebugEvent('sudo', `request_id=${data.request_id} prompt=${(data.prompt?.slice(0, 40)) ?? ''}`);
      setActiveSudo?.(data);
    },

    onSecret: (data: { session_id?: string; request_id: string; prompt: string; env_var: string; metadata?: Record<string, unknown> }) => {
      addDebugEvent('secret', `request_id=${data.request_id} env_var=${data.env_var}`);
      setActiveSecret?.(data);
    },

    onSessionInfo: (data: {
      session_id: string
      run_id: string
      model: string
      provider: string
      cwd: string
      branch: string | null
      running: boolean
      title: string
      version: string
      reasoning_effort: string
      service_tier: string
      fast: boolean
      yolo: boolean
      personality: string
      desktop_contract: string
      release_date: string
      update_behind: number | null
      update_command: string
      profile_name: string
      credential_warning: boolean | null
      tools: Record<string, unknown>
      skills: Record<string, unknown>
      usage?: {
        input_tokens?: number
        output_tokens?: number
        reasoning_tokens?: number
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        api_calls?: number
        context_used?: number
        context_max?: number
        compressions?: number
        cache_read_tokens?: number
        cache_write_tokens?: number
      }
      mcp_servers: Array<{ name: string; status: string }>
      system_prompt: string
      // C-5: inflight turn 快照（对齐 Hermes _inflight_snapshot）——failed turn 恢复
      inflight?: {
        user?: string
        assistant?: string
        streaming?: boolean
        error?: string
        status?: string
        recoverable?: boolean
      }
      // T5: pending_prompts
      pending_prompts?: {
        clarify?: { clarify_id: string; question: string; choices: string[]; awaiting_text: boolean }
        sudo_password?: { sudo_id: string; prompt: string }
        secret_capture?: { secret_id: string; env_var: string; prompt: string }
        terminal_read?: { read_id: string }
        slash_confirm?: { confirm_id: string; command: string }
        approval?: { request_id: string; command: string; choices?: string[] }
      }
    }) => {
      addDebugEvent('session_info', `model=${data.model} running=${data.running} branch=${data.branch}`);
      // C-5（2026-08-08 对齐 Hermes resume inflight 投影）：failed turn 恢复——
      // 断线窗口错误帧丢失后，session.info 携带 inflight.error；重建失败气泡（错误语义
      // 优先，不把部分文本当健康回复——对齐 Hermes localPendingSupersedes 语义）。
      // 幂等：按 error 文本匹配已存在消息（session.info 每次状态变化都会推送）。
      const inflightErr = data.inflight?.error;
      if (inflightErr && !getMessages().some((m) => m.error === inflightErr)) {
        const partial = (data.inflight?.assistant || '').trim();
        storeSetMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant' as const,
            parts: partial ? [textPart(partial)] : [],
            error: inflightErr,
            pending: false,
            timestamp: Date.now(),
          },
        ]);
      }
      // 🔴 W-7: 同步会话 cwd（后端 session.info 携带；旧版丢弃 → preview.restart cwd 恒空）
      setSessionCwd?.(data.cwd || '');
      // T5: 恢复 pending 交互 UI — 归一化提取（与宫格 useGridChat 同一权威源）
      const pending = extractPendingInteractions(data.pending_prompts as Record<string, Record<string, unknown>> | undefined, data.run_id);
      if (pending) {
        if (pending.clarify) setActiveClarify(pending.clarify);
        // 🔴 2026-08-23：批量表单刷新恢复（pending 快照带 questions → ClarifyBatchCard）
        if (pending.clarify_batch) setActiveClarifyBatch?.(pending.clarify_batch);
        if (pending.approval) setActiveApproval(pending.approval);
        if (pending.sudo) setActiveSudo?.(pending.sudo);
        if (pending.secret) setActiveSecret?.(pending.secret);
        // 🔴 P1 修复：slash_confirm 恢复（之前漏掉，刷新后 pending 的 /new /undo /reset 确认卡不恢复）
        if (pending.slashConfirm) setActiveSlashConfirm?.(pending.slashConfirm as { confirmId: string; command: string; description: string });
      } else {
        // 🔴 2026-08-13 边界修复：session.info 是 pending 状态唯一快照权威——
        // 快照为空 = 无任何 pending，必须清空（否则切到无 pending 的会话时
        // 旧会话的审批/澄清卡残留——handleSwitchSession 路径不清理，只有
        // loadSessionIntoView（P1-3）清，此前行为不一致）。
        setActiveClarify(null);
        setActiveClarifyBatch?.(null);
        setActiveApproval(null);
        setActiveSudo?.(null);
        setActiveSecret?.(null);
        setActiveSlashConfirm?.(null);
      }
      // 更新 monitorState — 同步 usage 绝对值（session.info 每次 push 都是完整快照）
      setMonitorState((prev) => ({
        ...prev,
        modelName: data.model,
        tokensIn: data.usage?.input_tokens ?? prev.tokensIn,
        tokensOut: data.usage?.output_tokens ?? prev.tokensOut,
      }));
      // 同步 store 中的 streaming 状态
      if (!data.running) {
        // 对齐 Eleve session.info running=false: 重置全部流式状态
        // Eleve: streamId=null, busy=false, awaitingResponse=false,
        //         pendingBranchGroup=null, turnStartedAt=null
        // 🔴 P1-2（Coder 复审 2026-08-09）：兜底路径置 turn 结束标志——
        // 该分支的存在意义就是"message.complete 永远不到达"（turn 崩溃/断线），
        // 此时 onDone 不触发、turnEndedRef 不置位 → 迟到 delta 仍可 seed 新气泡，
        // 守卫在最需要它的场景失效。对齐 Hermes gateway-event.ts:492-509
        // （running=false 把 streamId/pendingBranchGroup/turnStartedAt 全置 null）。
        turnEndedRef.current = true;
        interimSealedRef.current = false;
        // 先 flush 残留 delta，再 finalize pending 消息
        if (flushHandleRef.current !== null) {
          clearTimeout(flushHandleRef.current);
          flushHandleRef.current = null;
        }
        flushQueuedDeltas();
        // 如果还有活跃的 streamId，说明 agent 异常退出没发 done → finalize
        if (streamIdRef.current) {
          completeAssistantMessage(drainFinalParts());
        }
        storeSetIsStreaming(false);
        setConnectionStatus('idle');
        // 🔴 P0-4: 自愈必须释放发送锁（对齐宫格 useGridChat:574-577 + 单视图 onDone:624）
        // 不释锁 → isSendingRef 恒 true → 后续消息静默进死队列永不发送
        if (drainQueueRef.current) drainQueueRef.current();
      } else {
        // 🔴 2026-08-16 流程审查修复（S1）：running=true 自愈——abort 后若 WS
        // 断连导致 interrupt 丢失、后端 turn 续跑，重连 re-attach 只推
        // session.info(running=true)（无 message.start）→ turnEndedRef 恒 true
        // → 续跑轮全部 delta 被守卫丢弃，轮末 hydrate 又被 unresolvedUserTail
        // 挡住 → 本轮输出静默丢失（需手动刷新）。对齐 Hermes per-turn
        // state.interrupted 语义：running=true 且本地无活跃流时复位守卫。
        if (turnEndedRef.current && !streamIdRef.current) {
          const hasPendingAssistant = getMessages()?.some(m => m.role === 'assistant' && (m.pending || m.interim))
          if (!hasPendingAssistant) {
            turnEndedRef.current = false
            interimSealedRef.current = false
          }
        }
        storeSetIsStreaming(true);
        setConnectionStatus('streaming');
      }
    },

    // ── Done — 1:1 with Hermes message.complete ──
    // 3.3: drainFinalParts() 从共享累加器取权威 parts（消灭影子累加器 fullTextRef）
    // 🔴 C-1（2026-08-08）：onDone 携带结构化 failure（对齐 Hermes gateway-event.ts L725-733），
    // status=error 时消息带 error 标记渲染（MessageRow type=error），不再静默吞错误。
    onDone: (newSessionId: string | null, failure?: { error: string; partial: boolean }) => {
      addDebugEvent('done', newSessionId ? `new session: ${newSessionId?.slice(0, 8)}` : 'complete');

      // 🔴 #4：置 turn 结束标志——此后的迟到 delta/tool 事件全部丢弃（对齐 Hermes
      // state.interrupted 语义：停止后迟到 token 不得 seed 新气泡）。正常完成路径
      // 后端已发完事件，置位无副作用；abort 路径（onDone(null)）正是防线。
      turnEndedRef.current = true

      // Cancel any pending flush timer
      if (flushHandleRef.current !== null) {
        clearTimeout(flushHandleRef.current)
        flushHandleRef.current = null
      }

      // Flush any remaining queued deltas
      flushQueuedDeltas()

      // 3.3: drain 共享累加器 → 权威 parts（reasoning → tools → text）
      // drain 语义：取出+重置。interrupted 双触发时第二次 drain 返回空 → 不创建重复消息
      const drainedParts = drainFinalParts()
      completeAssistantMessage(drainedParts, failure)

      // 🔴 修复：显式重置 isStreaming 状态（对齐 Hermes session.info(running=false)）
      // 后端在对话完成后发送 message.complete，前端 onDone 被调用，
      // 但之前没有重置 isStreaming，导致审批后输入框被禁用
      storeSetIsStreaming(false)

      setConnectionStatus('idle');

      const currentSessionId = sess.sessionId;
      const effectiveId = newSessionId || currentSessionId;

      // 🔴 #8: Hydrate fallback（对齐 Hermes index.ts:583-622 shouldHydrate）——
      // complete 到达但零 payload（delta 丢失/流中断），会话显示空消息。Hermes 从本地
      // 存储重载（3 次重试）；ELEVE 后端是消息唯一权威源，直接 loadHistory 重载一次
      //（复用现有 prop，零新增 RPC）。条件对齐 Hermes：
      //  - !completionError：错误本身是有效终态，不 hydrate
      //  - !hasInlineError：列表已有 assistant error 不 hydrate
      //  - drainedParts 空 = !sawAssistantPayload || !finalText（累加器含 reasoning/
      //    tool parts，收到过任何 payload 都不空；Hermes 的 sawAssistantPayload 同义）
      //  - !unresolvedUserTail（🔴 P2-1 补）：Hermes index.ts:655-657 最后可见消息是
      //    user 时不 hydrate——若后端其实没收到本轮 user 消息（提交失败/断连丢帧），
      //    loadHistory 重载会把乐观上屏的用户消息覆盖丢；宁可保持现状等下次交互自愈
      const hasInlineError = getMessages()?.some(m => m.role === 'assistant' && m.error && !m.hidden) ?? false
      const lastVisible = [...(getMessages() ?? [])].reverse().find(m => !m.hidden)
      const unresolvedUserTail = lastVisible?.role === 'user'
      if (
        drainedParts.length === 0 &&
        !failure?.error &&
        !hasInlineError &&
        !unresolvedUserTail &&
        effectiveId
      ) {
        sess.loadHistory(effectiveId).then((msgs) => {
          if (msgs && msgs.length) {
            storeSetMessages(() => msgs)
          }
        }).catch(() => { /* hydrate 失败静默：下次交互自愈 */ })
      }
      if (effectiveId && getMessages()?.length) {
        sess.saveCache((cache) => ({ ...cache, [effectiveId]: getMessages() }));
      }

      if (drainQueueRef.current) drainQueueRef.current();

      // 🔴 对齐 Hermes：onDone 后无条件刷新列表（300ms debounce 合并，确保新 session 标题更新）
      if (newSessionId && newSessionId !== currentSessionId) {
        if (currentSessionId && getMessages()?.length) {
          sess.saveCache((cache) => ({ ...cache, [currentSessionId]: getMessages() }));
        }
        setTimeout(() => {
          sess.setSessionId(newSessionId);
          persistSessionPointer(newSessionId);
          // 🔴 #7：refresh 走 debounce（新 session 切换后 300ms 内合并）
          scheduleSessionsRefresh();
        }, 0);
      } else {
        // 🔴 对齐 Hermes：即使无新 session，也刷新列表（标题可能已更新）——300ms debounce
        scheduleSessionsRefresh();
      }
    },

    onError: (msg: string) => {
      addDebugEvent('error', msg);
      const errorStreamId = streamIdRef.current || `assistant-error-${Date.now()}`

      streamIdRef.current = null

      if (getMessages().some(m => m.id === errorStreamId)) {
        updateMessage(errorStreamId, { error: msg, pending: false })
      } else {
        storeSetMessages((prev) => [...prev, { id: genId(), role: 'assistant', parts: [textPart(msg)], error: msg, timestamp: Date.now() } as ChatMessage]);
      }
      setConnectionStatus('error');
      import('../utils/notifications').then(({ notifyError }) => {
        notifyError(msg, 'Agent 错误');
      });
      if (drainQueueRef.current) drainQueueRef.current();
      setTimeout(() => setConnectionStatus((s) => (s === 'error' ? 'idle' : s)), 3000);
    },

    // ── Session reset — aligned with Eleve /new /reset ──
    // When backend resets session (via /new command), update UI session_id + clear messages.
    onSessionReset: ({ new_session_id }: { old_session_id: string; new_session_id: string }) => {
      addDebugEvent('session_reset', `new: ${new_session_id?.slice(0, 8)}`);
      sess.setSessionId(new_session_id);
      persistSessionPointer(new_session_id);
      storeSetMessages([]);
      sess.refresh();
      if (setSessionListVersion) setSessionListVersion(v => v + 1);
      setMonitorState((prev) => ({ ...prev, sessionStartedAt: Date.now() }));
      // 同步 WS 连接到新 session
      import('@/services/ws-client').then(({ getWsClient }) => {
        const wsClient = getWsClient();
        if (wsClient.state === 'connected') {
          wsClient.switchSession(new_session_id);
        }
      });
    },

    // 对齐架构原则：后端是 session_id 唯一权威源
    // 后端在 prompt.submit 中自动创建 session 时通知前端更新
    onSessionCreated: (newSessionId: string) => {
      addDebugEvent('session_created', `new: ${newSessionId?.slice(0, 8)}`);
      sess.setSessionId(newSessionId);
      persistSessionPointer(newSessionId);
      if (setSessionListVersion) setSessionListVersion(v => v + 1);
      setMonitorState((prev) => ({ ...prev, sessionStartedAt: Date.now() }));
      import('@/services/ws-client').then(({ getWsClient }) => {
        const wsClient = getWsClient();
        if (wsClient.state === 'connected') {
          wsClient.switchSession(newSessionId);
        }
      });
    },

    // 对齐 Hermes pending_title: 后端应用 title 后推送 session.title 事件
    // 前端消费事件更新 titles map + 刷新 session 列表
    onSessionTitle: (data: { session_id: string; title: string }) => {
      if (data.session_id && data.title) {
        sess.setTitle(data.session_id, data.title);
        if (setSessionListVersion) setSessionListVersion(v => v + 1);
      }
    },

    // ── Run completed — aligned with Eleve session.info(running=false) ──
    // Eleve doesn't explicitly handle run.completed in handleGatewayEvent,
    // but the event carries usage data. Process it here for stats tracking.
    onRunComplete: (data: { sessionId: string; completed?: boolean; interrupted?: boolean; usage?: unknown }) => {
      addDebugEvent('run_complete', `session=${data.sessionId?.slice(0, 8)} completed=${data.completed} interrupted=${data.interrupted}`);
      // 如果被中断，清理流式状态
      if (data.interrupted && streamIdRef.current) {
        flushQueuedDeltas();
        completeAssistantMessage(drainFinalParts());
        storeSetIsStreaming(false);
      }
    },

    // ── Delegate progress — aligned with Eleve upsertSubagent ──
    // Eleve handles subagent events via upsertSubagent.
    // Eleve routes delegate.* events through this callback for monitor display.
    onDelegateProgress: (data: {
      subagentId?: string; eventType?: string; taskIndex?: number; taskCount?: number
      goal?: string; toolName?: string; toolArgs?: Record<string, unknown>; toolPreview?: string; thinkingText?: string
      progressSummary?: string; depth?: number
      parentId?: string; model?: string; toolsets?: string[]; childSessionId?: string; toolCount?: number
      sessionId?: string
      status?: string; durationSeconds?: number; summary?: string
      inputTokens?: number; outputTokens?: number; reasoningTokens?: number; apiCalls?: number
      filesRead?: string[]; filesWritten?: string[]; outputTail?: unknown[]; costUsd?: number; exitReason?: string
    }) => {
      // 🔴 2026-08-15 调试侧边栏刷屏修复：按事件区分内容 + subagent.text
      // 节流合并（见模块顶部说明）——同一子 Agent 不再逐 delta 刷同前缀行。
      if (data.eventType === 'subagent.text' && data.subagentId) {
        const now = Date.now();
        const st = subagentTextCoalesce.get(data.subagentId) || { lastFlush: 0, chars: 0 };
        st.chars += String(data.toolPreview ?? '').length;
        if (now - st.lastFlush >= SUBAGENT_TEXT_COALESCE_MS) {
          addDebugEvent(
            'delegate_progress',
            `subagent.text +${st.chars}字 ${String(data.toolPreview ?? '').slice(-60)}`,
          );
          st.chars = 0;
          st.lastFlush = now;
        }
        subagentTextCoalesce.set(data.subagentId, st);
      } else {
        if (data.subagentId && (data.eventType === 'subagent.complete' || data.status)) {
          subagentTextCoalesce.delete(data.subagentId); // 终态清理节流状态
        }
        if (subagentTextCoalesce.size > 64) subagentTextCoalesce.clear(); // 防御性上限
        addDebugEvent('delegate_progress', buildDelegateProgressDebugLine(data.eventType, data));
      }
      // 更新 monitorState 显示子代理进度
      if (data.subagentId) {
        setMonitorState((prev) => {
          const tasks = { ...((prev.delegateTasks as Record<string, unknown>) || {}) };
          // 🔴 2026-08-17 链路闭合修复（E-F2 消解 + 水合同键）：卡片键 =
          // childSessionId（registry 键）优先、展示身份兜底——与
          // ToolStatusBar delegation.status 水合（同 registry 键）共用
          // 一个键空间：父轮结束后/页面刷新后运行中的后台子卡片可恢复，
          // steer/kill 恒命中 registry 键；旧展示身份键条目在
          // childSessionId 到达时迁移删除（消除同子双卡片 E-F2）。
          const key = data.childSessionId || data.subagentId!;
          const legacyKey =
            data.childSessionId && data.subagentId !== data.childSessionId
              ? data.subagentId
              : undefined;
          const prior = ((tasks[key] as Record<string, unknown> | undefined) ||
            (legacyKey ? (tasks[legacyKey] as Record<string, unknown> | undefined) : undefined)) || {};
          if (legacyKey && legacyKey !== key) delete tasks[legacyKey];
          // 🔴 2026-08-15 编排对齐（③ 监控过程视图）：工具/进度/文本按到达序
          // 追加轨迹（cap 60），last-write-wins 快照升级为有过程的任务视图
          const trace = Array.isArray(prior.trace) ? [...(prior.trace as string[])] : [];
          let line = '';
          // 🔴 2026-08-18 禁 Emoji 规范：轨迹行前缀改纯文本标签
          if (data.eventType === 'subagent.tool') line = `工具：${data.toolName || ''}`;
          else if (data.eventType === 'subagent.progress' && data.progressSummary) line = `进度：${data.progressSummary}`;
          else if (data.eventType === 'subagent.text' && data.toolPreview) line = `回复：${String(data.toolPreview).slice(0, 120)}`;
          if (line) {
            trace.push(line);
            if (trace.length > 60) trace.splice(0, trace.length - 60);
          }
          tasks[key] = {
            ...prior,
            id: key,
            // 🔴 2026-08-18 会话隔离加固：事件缺 session_id 时兜底当前流会话
            // （子 Agent 事件恒带父会话 sid，兜底仅防漏标串显）
            sessionId: data.sessionId ?? sess.sessionId ?? undefined,
            goal: data.goal,
            eventType: data.eventType,
            taskIndex: data.taskIndex,
            taskCount: data.taskCount,
            toolName: data.toolName,
            toolArgs: data.toolArgs,
            progressSummary: data.progressSummary,
            depth: data.depth,
            parentId: data.parentId,
            model: data.model,
            toolsets: data.toolsets,
            childSessionId: data.childSessionId ?? prior.childSessionId,
            toolCount: data.toolCount,
            // 🔴 对齐Hermes: 统一 subagent.complete + status字段区分完成/失败
            status: data.status || (data.eventType === 'subagent.complete' && data.summary ? 'completed' : data.eventType === 'subagent.complete' ? 'failed' : 'running'),
            durationSeconds: data.durationSeconds,
            duration: data.durationSeconds, // 映射到UI已有字段
            summary: data.summary,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            reasoningTokens: data.reasoningTokens,
            apiCalls: data.apiCalls,
            filesRead: data.filesRead,
            filesWritten: data.filesWritten,
            outputTail: data.outputTail,
            costUsd: data.costUsd,
            exitReason: data.exitReason,
            thinkingText: data.thinkingText ?? prior.thinkingText,
            lastText: data.eventType === 'subagent.text' && data.toolPreview
              ? String(data.toolPreview)
              : (prior.lastText as string | undefined),
            trace,
          };
          // 🔴 2026-09-01 内存修复（审查 P0-3）：写入前治理（终态剥离 + 上限）
          return { ...prev, delegateTasks: governDelegateTasks(tasks) };
        });
      }
    },

    // ── System notice — 委托共享处理器（与宫格 useGridChat 同一权威源）──
    onSystemNotice: (data: { text: string; level?: string; kind?: string; ttl_ms?: number; key?: string; id?: string }) => {
      addDebugEvent('system_notice', `${data.level || 'info'}: ${data.text.slice(0, 60)}`);
      handleGlobalEvent('notification.show', data as Record<string, unknown>);
    },
    onNoticeClear: (data: { key: string }) => {
      addDebugEvent('notice_clear', `key=${data.key}`);
      handleGlobalEvent('notification.clear', data as Record<string, unknown>);
    },

    // Phase 6: 浏览器连接进度 — 委托共享处理器
    onBrowserProgress: (data: { message: string; level: string }) => {
      addDebugEvent('browser_progress', `${data.level}: ${data.message}`);
      handleGlobalEvent('browser.progress', data as Record<string, unknown>);
    },

    // Phase 6: 终端关闭 — 委托共享处理器
    onTerminalClose: (data: { process_id: string }) => {
      addDebugEvent('terminal_close', `process ${data.process_id} closed`);
      handleGlobalEvent('terminal.close', data as Record<string, unknown>);
    },

    // Agent 后台进程输出流（对齐 Hermes agent.terminal.output）— 直写只读 xterm
    onAgentTerminalOutput: (data: { process_id: string; chunk: string }) => {
      writeAgentTerminalChunk(data.process_id, data.chunk);
    },

    // ── Status update — Eleve status.update (覆盖式状态，按 kind 分流) ──
    // 对齐 Eleve TUI 前端 createGatewayEventHandler.ts L425-470:
    //   kind=goal/compressing → sys(text)+setStatus(brief)
    //   kind=lifecycle/warn/error → setStatus(text)+pushActivity(text, level)
    //   kind=status → 仅 setStatus()
    onStatusUpdate: (data: { kind: string; text: string }) => {
      addDebugEvent('status_update', `${data.kind}: ${data.text.slice(0, 60)}`);
      const { kind, text } = data;
      switch (kind) {
        case 'goal':
        case 'compacting':
          // 🔴 Phase 2: 压缩/目标变更 → 独立 system 消息（对齐宫格）+ 状态栏
          // （旧实现混进流式气泡，完成时被 finalize 抹掉 — 审查 #2）
          // kind 对齐 Hermes gateway-event.ts L1076：后端压缩开始发 compacting
          //（旧分支名 'compressing' 是 Hermes 手动压缩 RPC 的开始 kind，ELEVE
          //  统一走 compress_context 内部，只发 compacting——消费方以 compacting 为准）
          if (text) appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(text)], timestamp: Date.now() });
          break;
        case 'compacted':
          // 压缩完成（对齐 Hermes gateway-event.ts L1079-1081）：退役压缩态。
          // 压缩态退役由 store/session-status 统一处理（status.update 接线）。
          // monitor.statusText 死状态已清理（2026-08-15 前端普查待办②）。
          break;
        case 'background':
          // 🔴 Phase 2: 后台任务结果回推（对齐 Hermes _run_background_task deliver）→ 独立 system 消息（对齐宫格）+ toast
          if (text) appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(text)], timestamp: Date.now() });
          import('../utils/notifications').then(({ notifySuccess, notifyError }) => {
            if (text.startsWith('❌')) notifyError(text, '后台任务失败');
            else notifySuccess('后台任务已完成');
          });
          break;
        case 'lifecycle':
        case 'warn':
        case 'error': {
          // 生命周期/警告/错误 → 错误通知
          const level = kind === 'error' ? 'error' : kind === 'warn' ? 'warning' : 'info';
          import('../utils/notifications').then(({ notifyError }) => {
            if (level === 'error' || level === 'warning') {
              notifyError(text, level === 'error' ? '错误' : '警告');
            }
          });
          break;
        }
        case 'status':
        default:
          // 普通状态：monitor.statusText 死状态已清理（2026-08-15 前端普查待办②），
          // 无监视器字段更新。
          break;
      }
    },

    // ── Reasoning completed — 推理块结束 → 冻结 live 尾部推理块 ──
    // 🔴 2026-08-08 已删除（对齐 Hermes：Hermes 无 reasoning.end 事件，
    // 块冻结由 reasoning.available 完成态 replace 承担，见 onReasoningAvailable）。

    // ── 🔴 Phase 2b: 补齐单视图缺失的 8 个事件（对齐宫格 useGridChat 已处理）──

    // Agent 思考状态（对齐 Hermes thinking_callback）
    onThinking: (text: string) => {
      addDebugEvent('thinking', text.slice(0, 60));
    },

    // 工具参数生成中（drafting 状态，对齐 Hermes setSessionDraftingTool）
    // 🔴 2026-08-11 对齐 Hermes gateway-event.ts:830：「It's a status, so say it as
    // one」——generating 只做状态提示，绝不创建工具行（幽灵卡根因，已从累加器移除）。
    onToolGenerating: (name: string) => {
      addDebugEvent('tool_generating', name);
    },

    // 工具进度（对齐 Hermes tool_progress_command）
    onToolProgress: (data: { eventType: string; toolName: string; preview?: string; args?: unknown; duration?: number; error?: boolean; toolCallId?: string }) => {
      addDebugEvent('tool_progress', `${data.toolName}: ${data.preview || data.eventType}`);
    },

    // Fallback 已激活（对齐 Hermes fallback 通知）
    onFallbackActivated: (data: { model: string; provider: string }) => {
      addDebugEvent('fallback', `${data.provider}/${data.model}`);
      setMonitorState((prev) => ({ ...prev, modelName: data.model }));
      import('../utils/notifications').then(({ notifyWarning }) => {
        notifyWarning(`模型回退: ${data.provider}/${data.model}`, 'Fallback');
      }).catch(() => {});
    },

    // 文本段结束（对齐 Hermes stream_delta_callback(None)）
    onSectionEnd: () => {
      flushQueuedDeltas();
    },

    // 步骤完成（对齐 Hermes step_callback + _emit_interim_assistant_message 消息分界）
    // 内部记账进 DebugPanel；同时 finalize 当前流式消息，下一步 delta 创建新气泡
    onStepComplete: (data: { stepNumber: number; toolResults: Array<{ toolName: string; success: boolean }> }) => {
      const text = data.toolResults.length
        ? `步骤 ${data.stepNumber}: ${data.toolResults.map(r => `${r.toolName} ${r.success ? '✓' : '✗'}`).join(', ')}`
        : `步骤 ${data.stepNumber} 完成`;
      addDebugEvent('step_complete', text);
      finalizeStepBoundary();
    },

    // 中间助手消息（对齐 Hermes finalizeInterimAssistantMessage index.ts:410-464）
    // 🔴 #5：interim 到达时：① 先密封当前流式气泡（pending:false, interim:true）——
    // 过程文本到此为止，下一步 delta 创建新气泡；② alreadyStreamed=false（内容未上屏）
    // 时再 append 独立 interim 消息（Hermes 无气泡时的独立消息语义）。
    // 旧实现 alreadyStreamed=true 直接跳过：流式气泡继续累积 + interim 语义丢失，
    // complete 时密封气泡因 pending:false 被 fallback 漏掉 → 重复气泡。
    onInterimMessage: (data: { content: string; alreadyStreamed: boolean }) => {
      // 对齐 Hermes :418-421：权威文本 trim 后为空 → 直接 return（不密封不创建）
      if (data.content && data.content.trim()) {
        addDebugEvent('interim_message', data.content.slice(0, 60));
        // ① 先刷尽排队 delta（Hermes gateway-event.ts:584-594 先 flush 再 finalize）
        if (flushHandleRef.current !== null) {
          clearTimeout(flushHandleRef.current)
          flushHandleRef.current = null
        }
        flushQueuedDeltas()
        // ② 密封当前流式气泡（Hermes :433-438 原地 pending:false, interim:true）
        const streamId = streamIdRef.current
        if (streamId) {
          storeSetMessages((prev) =>
            prev.map(m => {
              if (m.id !== streamId) return m
              // 🔴 文本合并（对齐 Hermes mergeFinalAssistantText：interim 权威文本替换
              // 流式 delta 文本，reasoning/tool parts 保留）——流式 delta 可能丢尾字符
              // 🔴 2026-08-11 修复（工具卡跑文本前）：原实现 append 权威文本到 parts
              // 末尾 → 渲染 [TOOL][TEXT]（qwen 文本晚到场景实证）。插到第一个
              // tool-call 之前（对齐 Hermes 文本上、工具卡下的视觉）。
              const mergedParts = data.content
                ? (() => {
                    const nonText = m.parts.filter(p => p.type !== 'text')
                    const toolIdx = nonText.findIndex(p => p.type === 'tool-call')
                    if (toolIdx >= 0) {
                      return [...nonText.slice(0, toolIdx), textPart(data.content), ...nonText.slice(toolIdx)]
                    }
                    return [...nonText, textPart(data.content)]
                  })()
                : m.parts
              return { ...m, parts: mergedParts, pending: false, interim: true }
            }),
          )
          streamIdRef.current = null // 下一步 delta 创建新气泡（Hermes :457）
          // 🔴 #6b: interim 边界已发生 → complete 无条件 settle（Hermes :563）
          interimSealedRef.current = true
        }
        // ③ 未上屏内容 → 独立 interim 消息（Hermes :439-451）
        if (!data.alreadyStreamed) {
          appendIndependentMessage({ id: genId(), role: 'assistant' as const, parts: [textPart(data.content)], interim: true, timestamp: Date.now() });
        }
        // 🔴 #6b: interim 边界已发生（Hermes 两种路径无条件置 interimBoundaryPending: true，
        // index.ts:458）——独立消息路径也要置位，否则 complete 只按文本前缀匹配 settle
        if (!streamId) {
          interimSealedRef.current = true
        }
      }
    },

    // 后台 Review 结果（对齐 Hermes background_review_callback）
    // 🔴 Phase 2: 独立 system 消息（对齐宫格 useGridChat background.review）
    onBackgroundReview: (data: { summary: string }) => {
      if (data.summary) {
        addDebugEvent('background_review', data.summary.slice(0, 60));
        appendIndependentMessage({ id: genId(), role: 'system' as const, parts: [textPart(`🔍 后台审查: ${data.summary}`)], timestamp: Date.now() });
      }
    },

    // reaction — 用户 affection（ily / <3 / good bot / 心形 emoji）→ 爱心彩蛋
    // 对齐 Hermes: gateway-event.ts isActiveEvent → burstVibeHearts()；纯 UI，永不触碰对话
    onReaction: (data: { kind: string }) => {
      if (data.kind === 'vibe') {
        addDebugEvent('reaction', 'vibe hearts');
        burstVibeHearts();
      }
    },

    // wake.detected — 唤醒词命中 → 委托共享处理器（与宫格同一权威源）
    onWakeDetected: (data: { phrase: string; start_new_session?: boolean }) => {
      addDebugEvent('wake_detected', `phrase=${data.phrase}`);
      handleGlobalEvent('wake.detected', data as Record<string, unknown>);
    },

    // voice.interrupted — full-duplex barge-in 打断（TTS 已切 + turn 已中断，
    // 纯后端语义事件；前端无额外 UI，debug 留痕）
    onVoiceInterrupted: (_data: Record<string, unknown>) => {
      addDebugEvent('voice_interrupted', 'TTS cut + turns interrupted');
    },

    // ── E-3: MoA 参考模型输出（对齐 Hermes use-message-stream moa.reference #64658）──
    // 作为带标签的推理块展示（◇ Reference idx/cnt — label）；首个参考替换（清 stale 推理），
    // 后续累积防互相覆盖。单视图走 mutateStream 直改 parts（与累加器 appendReasoningPart 同构）。
    onMoaReference: (data: { index?: number; count?: number; label: string; text: string }) => {
      addDebugEvent('moa_reference', `${data.index}/${data.count} ${data.label}`);
      flushQueuedDeltas();
      const header =
        data.index !== undefined && data.count !== undefined
          ? `◇ Reference ${data.index}/${data.count} — ${data.label}`
          : `◇ Reference — ${data.label}`;
      const block = `${header}\n${data.text || ''}\n\n`;
      mutateStream(
        (parts) => {
          if (data.index === undefined || data.index <= 1) {
            return appendReasoningPart(parts.filter((p) => p.type !== 'reasoning'), block);
          }
          return appendReasoningPart(parts, block);
        },
        () => [reasoningPart(block)],
      );
    },

    // ── E-3: MoA 聚合开始（对齐 Hermes moa.phase aggregator 一行标记）──
    onMoaAggregating: () => {
      addDebugEvent('moa_aggregating', '');
      flushQueuedDeltas();
      mutateStream(
        (parts) => appendReasoningPart(parts, '◇ MoA aggregating…\n'),
        () => [reasoningPart('◇ MoA aggregating…\n')],
      );
    },
  } satisfies SSECallbacks;

  const { isStreaming, send, abort, resetStream: resetSSEStream, drainFinalParts } = useSSE(sseCallbacks.current, currentSessionIdRef, enabled);

  // 🔴 多 Agent 隔离：切换会话时重置全部流式状态（SSE 累加器 + streamId）
  // 🔴 串台根因修复：nextSessionId 提供时同步锁定过滤 ref，消灭“effect 异步更新”的串台窗口。
  // 稳态仍由 useEffect([sess.sessionId]) 对账（后端驱动的 session 变更经 onRunStart/onSessionCreated）。
  const resetStream = useCallback((nextSessionId?: string | null) => {
    if (nextSessionId !== undefined) {
      currentSessionIdRef.current = nextSessionId;
    }
    resetSSEStream();
    streamIdRef.current = null;
    queuedDeltasRef.current = { assistant: '', reasoning: '' };
    // 🔴 P1-1（Coder 复审 2026-08-09）：切换会话时同步清 turn 级 ref——
    // 否则会话 A done/abort 后 turnEndedRef=true 残留，切到 B 若 B 的 turn
    // 已在进行（message.start 早于切换发出）→ B 的 delta 全被守卫丢弃
    // （流式静默丢失）；interimSealedRef 残留则可能让 B 的 complete 误
    // settle 到 A 的 sealed interim 上覆盖历史。Hermes 这些状态是
    // per-session state（切换天然隔离），ELEVE 全局单 ref 必须显式清理。
    turnEndedRef.current = false;
    interimSealedRef.current = false;
    if (flushHandleRef.current !== null) {
      clearTimeout(flushHandleRef.current);
      flushHandleRef.current = null;
    }
  }, [resetSSEStream]);

  return {
    isStreaming,
    send,
    abort,
    resetStream,
    currentSessionIdRef,
  };
}
