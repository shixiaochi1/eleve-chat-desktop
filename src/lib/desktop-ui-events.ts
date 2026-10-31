/**
 * desktop-ui-events — 桌面表面工具（apply_layout / show_tip）的 WS 事件路由
 *
 * 对齐 Hermes `tools/apply_layout_tool.py` 与 `tools/tip_tool.py` 的协议形状：
 * 工具只发一条事件（`layout.apply {preset}` / `tip.show {target,text,title?,side?}`），
 * 渲染进程解析并执行；工具不等回执（tip 不是提问，阻塞会拖住回复）。
 *
 * 与 Hermes 的差异：Hermes 的 tip 锚点是 `data-tour` selector、布局是渲染进程的
 * 预设注册表；ELEVE 目前只把**面板**作为稳定锚点（与 focus_pane 同一套词表），
 * 布局预设也收敛为 ELEVE 实际拥有的右栏组合。
 */

import { getWsClient } from '@/services/ws-client'

export interface ShowTipPayload {
  target: string
  text: string
  title?: string
  side?: string
}

export interface TourStepPayload {
  target: string
  text: string
  title?: string
  side?: string
}

export interface StartChatPayload {
  message: string
  title?: string
}

export interface DesktopUiEventOptions {
  /** 当前聚焦会话（后台 turn 不得改布局 / 弹气泡 / 开新会话） */
  getFocusedSessionId: () => string | null | undefined
  onApplyLayout: (preset: string) => void
  onShowTip: (tip: ShowTipPayload) => void
  onStartTour: (steps: TourStepPayload[]) => void
  onStopTour: () => void
  onStartChat: (payload: StartChatPayload) => void
}

/** 右栏可承载的面板（apply_layout 的预设名与 focus_pane 词表一致） */
export const RIGHT_RAIL_PANES = new Set(['files', 'terminal', 'preview', 'artifacts'])

function payloadOf(data: unknown): Record<string, unknown> {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return raw.payload && typeof raw.payload === 'object'
    ? (raw.payload as Record<string, unknown>)
    : raw
}

/** `tour.start` 的 steps 归一（丢掉缺 target/text 的条目，未知字段忽略）。 */
export function parseTourSteps(raw: unknown): TourStepPayload[] {
  if (!Array.isArray(raw)) return []
  const steps: TourStepPayload[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const step = item as Record<string, unknown>
    const target = typeof step.target === 'string' ? step.target.trim().toLowerCase() : ''
    const text = typeof step.text === 'string' ? step.text.trim() : ''
    if (!target || !text) continue
    steps.push({
      target,
      text,
      title: typeof step.title === 'string' ? step.title : undefined,
      side: typeof step.side === 'string' ? step.side : undefined,
    })
  }
  return steps
}

function sessionOf(data: unknown): string | undefined {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return typeof raw.session_id === 'string' ? raw.session_id : undefined
}

export function initDesktopUiEvents(options: DesktopUiEventOptions): () => void {
  const wsClient = getWsClient()

  const KNOWN_EVENTS = new Set([
    'layout.apply',
    'tip.show',
    'tour.start',
    'tour.stop',
    'chat.start',
  ])

  const handleEvent = (eventName: string, data: unknown): void => {
    if (!KNOWN_EVENTS.has(eventName)) return

    // 聚焦会话门禁（与 pane-reveal 同款：后台 turn 不劫持用户界面）
    const sessionId = sessionOf(data)
    if (sessionId && sessionId !== options.getFocusedSessionId()) return

    const payload = payloadOf(data)

    if (eventName === 'layout.apply') {
      const preset = typeof payload.preset === 'string' ? payload.preset.trim().toLowerCase() : ''
      if (!preset) return
      options.onApplyLayout(preset)
      return
    }

    if (eventName === 'tour.stop') {
      options.onStopTour()
      return
    }

    if (eventName === 'tour.start') {
      const steps = parseTourSteps(payload.steps)
      if (steps.length > 0) options.onStartTour(steps)
      return
    }

    if (eventName === 'chat.start') {
      const message = typeof payload.message === 'string' ? payload.message.trim() : ''
      if (!message) return
      options.onStartChat({
        message,
        title: typeof payload.title === 'string' ? payload.title : undefined,
      })
      return
    }

    // tip.show
    const target = typeof payload.target === 'string' ? payload.target.trim().toLowerCase() : ''
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!target || !text) return
    options.onShowTip({
      target,
      text,
      title: typeof payload.title === 'string' ? payload.title : undefined,
      side: typeof payload.side === 'string' ? payload.side : undefined,
    })
  }

  wsClient.addEventListener(handleEvent)
  return () => {
    wsClient.removeEventListener(handleEvent)
  }
}

/** 布局预设 → 右栏状态（null = 关闭右栏） */
export function layoutPresetToRail(
  preset: string,
): { rightOpen: boolean; rightTab?: string; focusComposer?: boolean } {
  if (preset === 'focus') return { rightOpen: false, focusComposer: true }
  if (preset === 'default') return { rightOpen: true, rightTab: 'files' }
  if (RIGHT_RAIL_PANES.has(preset)) return { rightOpen: true, rightTab: preset }
  // 未知预设：前端也已由工具侧拦截，这里保守不动
  return { rightOpen: true }
}
