/**
 * pane-reveal — 面板显示/聚焦域 WS 事件路由（🔴 2026-08-28 对齐 Hermes
 * focus_pane_tool.py → use-preview-routing 同域事件）
 *
 * 工具侧 focus_pane → desktop_events 桥 emit `pane.reveal {pane}` → 此处消费：
 * 仅聚焦会话生效（后台 turn 绝不挪动用户焦点，对齐 Hermes sessionIsOnScreen 门禁）。
 *
 * panes（ELEVE 布局语义）：
 * - files / terminal / preview / artifacts → 开右栏切对应 tab
 * - chat → 聚焦消息输入框
 * - sessions → 打开左侧面板的会话列表
 */

import { getWsClient } from '@/services/ws-client'

export interface PaneRevealOptions {
  getFocusedSessionId: () => string | null | undefined
  onRevealPane: (pane: string) => void
}

const VALID_PANES = new Set(['chat', 'files', 'terminal', 'preview', 'artifacts', 'sessions'])

export function initPaneReveal(options: PaneRevealOptions): () => void {
  const wsClient = getWsClient()

  const handleEvent = (eventName: string, data: unknown): void => {
    if (eventName !== 'pane.reveal') return
    const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    const payload =
      raw.payload && typeof raw.payload === 'object'
        ? (raw.payload as Record<string, unknown>)
        : raw

    // 聚焦会话门禁（对齐 Hermes preview.open/close 同款：后台 turn 不劫持）
    const sessionId = raw.session_id as string | undefined
    if (sessionId && sessionId !== options.getFocusedSessionId()) return

    const pane = typeof payload.pane === 'string' ? payload.pane.trim().toLowerCase() : ''
    if (!VALID_PANES.has(pane)) return
    options.onRevealPane(pane)
  }

  wsClient.addEventListener(handleEvent)
  return () => {
    wsClient.removeEventListener(handleEvent)
  }
}
