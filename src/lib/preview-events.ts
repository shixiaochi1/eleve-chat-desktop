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
import { notifyWorkspaceChanged, toolMayMutateFiles, toolChangedPath } from '@/lib/workspace-events'
import {
  beginPreviewRestart,
  completePreviewRestart,
  openPreview,
  progressPreviewRestart,
  requestPreviewReload,
} from '@/store/preview'

export interface PreviewEventsOptions {
  /** 当前聚焦会话 ID（preview.open 过滤：后台 turn 不劫持，对齐 Hermes $focusedRuntimeId） */
  getFocusedSessionId: () => string | null | undefined
  /** 当前会话工作目录（相对路径归一化基准） */
  getCwd: () => string | null | undefined
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
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

      case 'preview.open': {
        // 对齐 Hermes：仅聚焦会话生效。ELEVE 服务端（api_server）已按 session_id
        // 路由到对应 WS 客户端（terminal.close 6-G 同款），此处过滤为防御性兜底
        const sessionId = raw.session_id as string | undefined
        if (sessionId && sessionId !== options.getFocusedSessionId()) return

        const target = typeof payload.url === 'string' ? payload.url.trim() : ''
        if (!target) return

        const label = typeof payload.label === 'string' ? payload.label.trim() : ''
        const resolved = normalizeOrLocalPreviewTarget(target, options.getCwd())
        if (resolved) {
          openPreview(label ? { ...resolved, label } : resolved)
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
