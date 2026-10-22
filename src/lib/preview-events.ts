/**
 * preview-events — 预览域 WS 事件路由（对齐 Hermes use-preview-routing.ts 职责）
 *
 * 单一监听点：App 挂载（initPreviewEvents），消费预览域事件写入 preview store：
 * - preview.restart.progress / preview.restart.complete → 重启状态机（task_id 追踪）
 * - preview.open → 打开预览 tab（open_preview 工具事件；仅聚焦会话生效，后台 turn 不劫持）
 * - tool.complete + inline_diff 非空 → requestPreviewReload（文件变更自动刷新）
 *
 * 架构：ws-client 全局事件总线；预览是独立功能域，不侵入聊天消息流（useSSE/useGridChat），
 * 对齐 Hermes handleDesktopGatewayEvent 的职责边界。
 */

import { WsEvent, WsMethod } from '@/types/ws-contract.generated';
import { getWsClient } from '@/services/ws-client'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { getCurrentSessionCwd } from '@/lib/session-cwd'
import { resolveActivePreviewWebviewLabel } from '@/lib/preview-webview-registry'
import { buildPreviewActJs } from '@/lib/preview-act-engine'
import { getPreviewStoreState } from '@/store/preview'
import { notifyWorkspaceChanged, toolMayMutateFiles, toolChangedPath } from '@/lib/workspace-events'
import {
  closeAllTabs,
  closePreviewMatching,
  completePreviewRestart,
  openPreview,
  progressPreviewRestart,
  renderedHtmlTarget,
  requestPreviewReload,
} from '@/store/preview';

export interface PreviewEventsOptions {
  /** 当前聚焦会话 ID（preview.open 过滤：后台 turn 不劫持，对齐 Hermes $focusedRuntimeId） */
  getFocusedSessionId: () => string | null | undefined
  /** 🔴 2026-08-29 对齐 Hermes sessionIsOnScreen（use-preview-routing.ts sessionIsOnScreen）：
   *  "Honor it for any session that's ON SCREEN — the primary chat or an open
   *  tile — not only the focused one"。仅 focused 门禁会让可见 tile 会话的
   *  open/close 静默消失（Agent 明确响应了用户请求却被丢弃）。 */
  isSessionOnScreen: (sessionId: string) => boolean
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

/** 🔴 2026-08-29 对齐 Hermes PREVIEW_READ_MAX_CHARS（right-rail/preview-reader.ts）：
 *  单次读取硬上限——页面 innerText 可达数 MB，而读取结果要跨网关进入模型上下文 */
const PREVIEW_READ_MAX_CHARS = 24_000

/** 🔴 2026-08-29 drive_preview 应答（对齐 Hermes desktop-bridge act 引擎：
 *  WS RPC preview.act.respond，与 read 应答同形） */
async function respondPreviewAct(requestId: string, result: string): Promise<void> {
  try {
    const ws = getWsClient()
    await ws.sendRpc(WsMethod.PREVIEW_ACT_RESPOND, { request_id: requestId, text: result })
  } catch {
    /* 工具侧已超时/连接断开，忽略 */
  }
}

/**
 * 🔴 2026-08-29 drive_preview 请求处理：把 act 引擎注入活跃 url tab 的子
 * webview 执行（preview_webview_eval_js），应答结果 JSON。与 read_preview
 * 对称——同一 preview_gateway oneshot 桥；无活跃 webview 立即回错误 JSON
 * （工具侧报"无预览/超时"而不是干等）。
 */
async function handlePreviewActRequest(
  payload: Record<string, unknown>,
  options: PreviewEventsOptions,
  sessionId: string | undefined,
): Promise<void> {
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
  if (!requestId) return

  const respondError = (message: string) => {
    void respondPreviewAct(
      requestId,
      JSON.stringify({ ok: false, error: message }),
    )
  }

  // 🔴 2026-10-23 对齐 Hermes act 会话闸门（use-message-stream/gateway-event/
  //  server-requests.ts previewAct isActiveSession）："a background turn (including
  //  one in a tile this window hosts) must never reach into the page the user is
  //  working in (desktop AGENTS.md: offer, don't hijack)"。非聚焦会话的 drive_preview
  //  收到明确拒绝而非驱动用户正看的页面
  if (sessionId && sessionId !== options.getFocusedSessionId()) {
    respondError('The in-app browser only takes actions in the session the user is looking at.')
    return
  }

  // 🔴 S1：经 store 解析激活 url tab，再经 registry 取其 webview label
  // （对齐 Hermes act 走"该会话可见 tabs"的解析链，而非全局单值）
  const state = getPreviewStoreState()
  const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0] ?? null
  const label = active && active.target.kind === 'url' ? resolveActivePreviewWebviewLabel(active.id) : null
  if (!label) {
    respondError('No browser webview is active. Open a page with open_preview first.')
    return
  }

  const action = typeof payload.action === 'string' ? payload.action : ''
  const actPayload: Record<string, unknown> = { action }
  for (const key of ['ref', 'selector', 'text', 'key', 'to']) {
    if (typeof payload[key] === 'string') actPayload[key] = payload[key]
  }
  for (const key of ['submit', 'full', 'allowShortcut']) {
    if (typeof payload[key] === 'boolean') actPayload[key] = payload[key]
  }
  for (const key of ['amount', 'max']) {
    if (typeof payload[key] === 'number') actPayload[key] = payload[key]
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const js = buildPreviewActJs(actPayload)
    const raw = await invoke<string>('preview_webview_eval_js', { label, js })
    await respondPreviewAct(requestId, raw)
  } catch (e) {
    respondError(`Failed to act on the in-app browser: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 🔴 2026-08-20 read_preview 应答（对齐 Hermes _respond：WS RPC preview.read.respond） */
async function respondPreviewRead(requestId: string, text: string): Promise<void> {
  try {
    const ws = getWsClient()
    await ws.sendRpc(WsMethod.PREVIEW_READ_RESPOND, { request_id: requestId, text })
  } catch {
    /* 工具侧已超时/连接断开，忽略 */
  }
}

/** 🔴 2026-08-20 read_preview 请求处理：读活跃 url tab 页面文本（webview eval）→ respond */
async function handlePreviewReadRequest(
  payload: Record<string, unknown>,
  options: PreviewEventsOptions,
  sessionId: string | undefined,
): Promise<void> {
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
  if (!requestId) return
  const start = typeof payload.start === 'number' ? payload.start : undefined
  const count = typeof payload.count === 'number' ? payload.count : undefined

  // 🔴 2026-10-23 对齐 Hermes read 会话闸门（server-requests.ts：与 act 同款
  //  isActiveSession 判定——"A local read sees only the tabs the requesting
  //  session can see"）：非聚焦会话的 read_preview 回拒绝 note，不读用户正看的页面
  if (sessionId && sessionId !== options.getFocusedSessionId()) {
    void respondPreviewRead(
      requestId,
      JSON.stringify({
        kind: 'none',
        url: '',
        title: '',
        text: '',
        start: 0,
        end: 0,
        total_chars: 0,
        note: 'The in-app browser only reads the page in the session the user is looking at.',
      }),
    )
    return
  }

  const state = getPreviewStoreState()
  const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0] ?? null
  if (!active) {
    void respondPreviewRead(
      requestId,
      JSON.stringify({ kind: 'none', url: '', title: '', text: '', start: 0, end: 0, total_chars: 0, note: 'No preview tab is open.' }),
    )
    return
  }
  if (active.target.kind !== 'url') {
    // file tab：只回身份（对齐 Hermes preview-reader：文件用 read_file 直读）
    void respondPreviewRead(
      requestId,
      JSON.stringify({ kind: 'file', url: active.target.url, title: '', text: '', start: 0, end: 0, total_chars: 0, note: 'File tab — read the file with read_file.' }),
    )
    return
  }

  const label = resolveActivePreviewWebviewLabel(active.id)
  if (!label) {
    void respondPreviewRead(
      requestId,
      JSON.stringify({ kind: 'url', url: active.target.url, title: '', text: '', start: 0, end: 0, total_chars: 0, note: 'No browser webview is active.' }),
    )
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke<string>('preview_webview_read_text', { label })
    let parsed: { title?: string; text?: string; error?: string }
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { text: raw }
    }
    const fullText = parsed.text ?? ''
    const total = fullText.length
    const startIdx = typeof start === 'number' && start >= 0 ? start : 0
    // 🔴 2026-10-23 修正对齐 Hermes windowText（right-rail/preview-reader.ts）：
    // want = min(max(1, count ?? MAX), MAX)——count<=0 归一为 1 字符（此前 count=0
    // 误走 MAX 返回 24_000 字符，与 Hermes 边界相反）
    const countN =
      typeof count === 'number'
        ? Math.min(Math.max(1, count), PREVIEW_READ_MAX_CHARS)
        : PREVIEW_READ_MAX_CHARS
    const text = fullText.slice(startIdx, startIdx + countN)
    void respondPreviewRead(
      requestId,
      JSON.stringify({
        kind: 'url',
        url: active.target.url,
        title: parsed.title ?? '',
        text,
        start: startIdx,
        end: startIdx + text.length,
        total_chars: total,
      }),
    )
  } catch (e) {
    void respondPreviewRead(
      requestId,
      JSON.stringify({
        kind: 'url',
        url: active.target.url,
        title: '',
        text: '',
        start: 0,
        end: 0,
        total_chars: 0,
        note: `Failed to read preview: ${e instanceof Error ? e.message : String(e)}`,
      }),
    )
  }
}

export function initPreviewEvents(options: PreviewEventsOptions): () => void {
  const wsClient = getWsClient()

  const handleEvent = (eventName: string, data: unknown): void => {
    const raw = asRecord(data)
    // payload 内聚（对齐 routeWsEvent 的 chunkBase 提取）
    const payload = (raw.payload && typeof raw.payload === 'object'
      ? raw.payload
      : raw) as Record<string, unknown>

    switch (eventName) {
      case WsEvent.PREVIEW_RESTART_PROGRESS: {
        const taskId = payload.task_id as string
        if (taskId) progressPreviewRestart(taskId, (payload.text as string) || '')
        return
      }

      case WsEvent.PREVIEW_RESTART_COMPLETE: {
        const taskId = payload.task_id as string
        if (taskId) completePreviewRestart(taskId, (payload.text as string) || '')
        return
      }

      case WsEvent.PREVIEW_READ_REQUEST: {
        // 🔴 2026-08-20 对齐 Hermes read_preview：agent 读取预览活跃 tab 内容
        // 🔴 2026-10-23 加会话闸门（对齐 server-requests isActiveSession）：
        // 后台 turn 的 read_preview 不读用户正看的页面
        void handlePreviewReadRequest(payload, options, raw.session_id as string | undefined)
        return
      }

      case WsEvent.PREVIEW_ACT_REQUEST: {
        // 🔴 2026-08-29 对齐 Hermes drive_preview：agent 驱动预览活跃 tab 页面
        // 🔴 2026-10-23 加会话闸门（对齐 server-requests previewAct isActiveSession）
        void handlePreviewActRequest(payload, options, raw.session_id as string | undefined)
        return
      }

      case WsEvent.PREVIEW_OPEN: {
        // 🔴 2026-08-29 对齐 Hermes sessionIsOnScreen 门禁（此前仅聚焦会话生效，
        // 宫格下可见 tile 会话的 open_preview 会静默消失）。ELEVE 服务端已按
        // session_id 路由到对应 WS 客户端，此处过滤为防御性兜底
        const sessionId = raw.session_id as string | undefined
        if (sessionId && !options.isSessionOnScreen(sessionId)) return

        const target = typeof payload.url === 'string' ? payload.url.trim() : ''
        if (!target) return

        const label = typeof payload.label === 'string' ? payload.label.trim() : ''
        // 🔴 cwd 取全局单例（lib/session-cwd.ts，对齐 Hermes $currentCwd）——
        //   与 markdown 链接点击同源，消除 App 闭包双轨
        const resolved = normalizeOrLocalPreviewTarget(target, getCurrentSessionCwd())
        if (resolved) {
          // 🔴 S2.3 对齐 Hermes use-preview-routing：agent 交付的 HTML 经
          // renderedHtmlTarget 强制渲染（"an agent hand-over means show the page"）
          openPreview(renderedHtmlTarget(label ? { ...resolved, label } : resolved), 'tool-result')
        }
        return
      }

      case WsEvent.PREVIEW_CLOSE: {
        // 🔴 2026-08-29 对齐 Hermes preview.close（use-preview-routing:108-140）：
        // 与 open 同款 onScreen 门禁——"a session the user can see may tidy the
        // pane it opened; a hidden background turn must not dismiss it"
        const sessionId = raw.session_id as string | undefined
        if (sessionId && !options.isSessionOnScreen(sessionId)) return

        const target = typeof payload.url === 'string' ? payload.url.trim() : ''
        if (!target) {
          // 无 url = 关整个预览面板（对齐 Hermes closeRightRail()：清全部 tabs）
          closeAllTabs()
          return
        }
        // 有 url = 只关匹配 tab（对齐 Hermes closePreviewMatching：按
        // source/url/label 匹配。🔴 2026-10-23 S3.1 差异如实标注：Hermes 的
        // candidates 含 resolved.source 原始串——ELEVE 的 target.source 是
        // 枚举元数据（'tool-result' 等）而非原始串，不可作匹配候选；close
        // 匹配靠 [原始 target, 归一化 url] + closePreviewMatching 内部的
        // url/label 字段兜底，语义等价覆盖）
        const candidates = [target]
        const resolved = normalizeOrLocalPreviewTarget(target, getCurrentSessionCwd())
        if (resolved) candidates.push(resolved.url)
        closePreviewMatching(...candidates)
        return
      }

      case WsEvent.TOOL_COMPLETE: {
        // 文件变更自动刷新：工具结果带 inline_diff → 已打开的 url 预览重载
        // （对齐 Hermes gatewayEventCompletedFileDiff；后端 tool.complete 需携带 inline_diff）
        // 🔴 2026-10-23 补齐双门禁（对齐 use-preview-routing.ts handleGatewayEvent）：
        // ① 事件会话 = 聚焦会话（后台会话改文件不得刷用户正看的预览）；
        // ② 已有 url tab 才刷新——"Only refresh an already-open live preview
        //    when a file changes; never open one unprompted"
        const diff = payload.inline_diff
        const diffSessionId = raw.session_id as string | undefined
        if (
          typeof diff === 'string' &&
          diff.trim().length > 0 &&
          (!diffSessionId || diffSessionId === options.getFocusedSessionId()) &&
          getPreviewStoreState().tabs.some((t) => t.target.kind === 'url')
        ) {
          requestPreviewReload()
        }
        // 工作区变化信号 → 文件树等消费方自动刷新（对齐 Hermes
        // notifyWorkspaceChanged(toolChangedPath(payload))：精准目录失效，
        // terminal/多路径无法锚定 → 全量）
        if (toolMayMutateFiles(payload)) {
          notifyWorkspaceChanged(toolChangedPath(payload))
        }
        return
      }
    }
  }

  wsClient.addEventListener(handleEvent)
  return () => {
    wsClient.removeEventListener(handleEvent)
  }
}
