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

import { getWsClient } from '@/services/ws-client'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { getCurrentSessionCwd } from '@/lib/session-cwd'
import { getActivePreviewWebview } from '@/lib/preview-reader'
import { getPreviewStoreState } from '@/store/preview'
import { notifyWorkspaceChanged, toolMayMutateFiles, toolChangedPath } from '@/lib/workspace-events'
import {
  beginPreviewRestart,
  closeAllTabs,
  closeTab,
  completePreviewRestart,
  openPreview,
  progressPreviewRestart,
  requestPreviewReload,
} from '@/store/preview'

export interface PreviewEventsOptions {
  /** 当前聚焦会话 ID（preview.open 过滤：后台 turn 不劫持，对齐 Hermes $focusedRuntimeId） */
  getFocusedSessionId: () => string | null | undefined
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

/** 🔴 2026-08-20 read_preview 应答（对齐 Hermes _respond：WS RPC preview.read.respond） */
async function respondPreviewRead(requestId: string, text: string): Promise<void> {
  try {
    const ws = getWsClient()
    await ws.sendRpc('preview.read.respond', { request_id: requestId, text })
  } catch {
    /* 工具侧已超时/连接断开，忽略 */
  }
}

/** 🔴 2026-08-20 read_preview 请求处理：读活跃 url tab 页面文本（webview eval）→ respond */
async function handlePreviewReadRequest(payload: Record<string, unknown>): Promise<void> {
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : ''
  if (!requestId) return
  const start = typeof payload.start === 'number' ? payload.start : undefined
  const count = typeof payload.count === 'number' ? payload.count : undefined

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

  const label = getActivePreviewWebview()
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
    const countN = typeof count === 'number' && count > 0 ? count : 4000
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
      case 'preview.restart.progress': {
        const taskId = payload.task_id as string
        if (taskId) progressPreviewRestart(taskId, (payload.text as string) || '')
        return
      }

      case 'preview.restart.complete': {
        const taskId = payload.task_id as string
        if (taskId) completePreviewRestart(taskId, (payload.text as string) || '')
        return
      }

      case 'preview.read.request': {
        // 🔴 2026-08-20 对齐 Hermes read_preview：agent 读取预览活跃 tab 内容
        void handlePreviewReadRequest(payload)
        return
      }

      case 'preview.open': {
        // 对齐 Hermes：仅聚焦会话生效。ELEVE 服务端（api_server）已按 session_id
        // 路由到对应 WS 客户端（terminal.close 6-G 同款），此处过滤为防御性兜底
        const sessionId = raw.session_id as string | undefined
        if (sessionId && sessionId !== options.getFocusedSessionId()) return

        const target = typeof payload.url === 'string' ? payload.url.trim() : ''
        if (!target) return

        const label = typeof payload.label === 'string' ? payload.label.trim() : ''
        // 🔴 cwd 取全局单例（lib/session-cwd.ts，对齐 Hermes $currentCwd）——
        //   与 markdown 链接点击同源，消除 App 闭包双轨
        const resolved = normalizeOrLocalPreviewTarget(target, getCurrentSessionCwd())
        if (resolved) {
          openPreview(label ? { ...resolved, label } : resolved)
        }
        return
      }

      case 'preview.close': {
        // 🔴 2026-08-28 对齐 Hermes preview.close（close_preview 工具 →
        //   use-preview-routing:108-140）：与 open 同款聚焦会话门禁——
        //   "a session the user can see may tidy the pane it opened; a hidden
        //   background turn must not dismiss the user's preview"
        const sessionId = raw.session_id as string | undefined
        if (sessionId && sessionId !== options.getFocusedSessionId()) return

        const target = typeof payload.url === 'string' ? payload.url.trim() : ''
        if (!target) {
          // 无 url = 关整个预览面板（对齐 Hermes closeRightRail()：清全部 tabs）
          closeAllTabs()
          return
        }
        // 有 url = 只关匹配 tab。candidates 对齐 Hermes closePreviewMatching：
        // [原始 target, 归一化后 url]——归一化补 scheme 后与 tab 记录的 url 匹配
        const candidates = new Set<string>([target])
        const resolved = normalizeOrLocalPreviewTarget(target, getCurrentSessionCwd())
        if (resolved) candidates.add(resolved.url)
        const state = getPreviewStoreState()
        for (const tab of state.tabs) {
          if (candidates.has(tab.target.url)) closeTab(tab.id)
        }
        return
      }

      case 'tool.complete': {
        // 文件变更自动刷新：工具结果带 inline_diff → 已打开的 url 预览重载
        // （对齐 Hermes gatewayEventCompletedFileDiff；后端 tool.complete 需携带 inline_diff）
        const diff = payload.inline_diff
        if (typeof diff === 'string' && diff.trim().length > 0) {
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
