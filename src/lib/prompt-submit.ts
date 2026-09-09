/**
 * prompt-submit.ts — 🔴 阶段2 统一（frontend-chat-unification-2026-09-09）：
 * 单视图 useSSE.send / 宫格 useGridChat.sendTo / 远端 RemoteBotChatView 三条
 * 发送链的**公共骨架**收敛为一份。
 *
 * 重复实证（审查报告）：wasBusy 之后的 ensureConnected → prompt.submit →
 * route_busy_submit outcome（steered/redirected/queued toast）三段在
 * useSSE.ts:810-849 与 useGridChat.ts:271-313 逐段对偶，靠注释互相"对齐"；
 * RemoteBotChatView 同协议（prompt.submit）却无 outcome 消费。
 *
 * **刻意不进本层的职责**（调用方各自持有，状态形态不同）：
 * - wasBusy 判定与锁/流式态管理（①全局 atom；②per-slot；④无锁）
 * - 乐观上屏 / 累加器重置 / pendingSend 缓冲窗（①独有）/ 串台守卫
 * - 失败反馈通道（①onError 回调；②toast——见各调用方 catch）
 */

/** route_busy_submit outcome（对齐后端 spawn_ws_turn_with_drain 三模式） */
export interface PromptSubmitOutcome {
  session_id?: string;
  status?: 'steered' | 'redirected' | 'queued';
}

interface PromptSubmitWs {
  sendRpc(method: string, params: Record<string, unknown>): Promise<unknown>;
  ensureConnected(timeoutMs?: number): Promise<boolean>;
}

export interface PromptSubmitParams {
  text: string;
  /** 已有会话（新建会话传 undefined，后端为唯一权威源） */
  sessionId?: string;
  /** 宫格路径必带 profile（per-profile 会话路由）；单视图/远端不带 */
  profile?: string;
  model?: string;
  provider?: string;
  /** 🔴 单视图特有：pending_title（首次消息后端在 message.complete 后应用） */
  title?: string;
  /** 🔴 单视图特有：client drain 续发标记（红线 3——drain 消息强制 queue） */
  queued?: boolean;
}

export interface PromptSubmitCallbacks {
  /** status=steered（注入 live turn） */
  onSteered?: () => void;
  /** status=redirected（软重定向修正） */
  onRedirected?: () => void;
  /** status=queued（busy 直发入 Inbox.followup） */
  onQueued?: () => void;
  /** 后端新建 session（session_id 权威源回传；调用方各自更新指针） */
  onSessionCreated?: (newSid: string) => void;
}

/** toast 文案单点（steered/redirected/queued 三分支曾三处手抄） */
function notifyOutcomeToast(status: NonNullable<PromptSubmitOutcome['status']>): void {
  import('../utils/notifications').then(({ notifyInfo }) => {
    if (status === 'steered') notifyInfo('已注入当前轮（steer）', '消息已送达');
    else if (status === 'redirected') notifyInfo('已重定向当前轮（redirect）', '修正已注入当前回复');
    else if (status === 'queued') notifyInfo('任务已加入队列', '当前任务完成后自动执行');
  }).catch(() => {});
}

/** 统一连接保障（曾三处手抄 ensureConnected(10000)） */
export async function ensureWsConnected(
  ws: PromptSubmitWs,
  timeoutMs = 10000,
): Promise<boolean> {
  return ws.ensureConnected(timeoutMs);
}

/** prompt.submit 公共骨架：发送 + route_busy_submit outcome 消费 + 新会话回调。
 *  失败 throw（调用方按各自反馈通道处理）；连接失败也 throw（统一错误语义）。
 *  调用方契约：wasBusy 时不得重置锁/流式态/累加器（锁归属 live turn）。 */
export async function submitPromptViaWs(
  ws: PromptSubmitWs,
  params: PromptSubmitParams,
  cbs?: PromptSubmitCallbacks,
): Promise<PromptSubmitOutcome> {
  const connected = await ws.ensureConnected(10000);
  if (!connected) {
    throw new Error('连接断开，正在重连，请稍后重试');
  }
  const result = (await ws.sendRpc('prompt.submit', {
    text: params.text,
    session_id: params.sessionId ?? '',
    ...(params.profile ? { profile: params.profile } : {}),
    ...(params.model ? { model: params.model, provider: params.provider || '' } : {}),
    ...(params.title ? { title: params.title } : {}),
    ...(params.queued ? { queued: true } : {}),
  })) as PromptSubmitOutcome;

  const status = result?.status;
  if (status === 'steered' || status === 'redirected' || status === 'queued') {
    notifyOutcomeToast(status);
    if (status === 'steered') cbs?.onSteered?.();
    else if (status === 'redirected') cbs?.onRedirected?.();
    else cbs?.onQueued?.();
  }
  // 对齐架构原则：后端是 session_id 的唯一权威源——新建会话回传调用方
  if (result?.session_id && result.session_id !== params.sessionId) {
    cbs?.onSessionCreated?.(result.session_id);
  }
  return result ?? {};
}
