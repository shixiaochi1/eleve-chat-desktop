/**
 * WebSocket 客户端 — 对齐 Eleve WS 协议
 *
 * 职责：
 * 1. 维护与 Gateway 的 WS 长连接
 * 2. JSON-RPC 2.0 收发（prompt.submit / abort 等）
 * 3. 接收服务端推送事件 → 分发到已注册的事件监听器
 * 4. 自动重连（指数退避）
 * 5. 事件名与 useSSE 完全一致，上层 useMessageStream 零改动
 *
 * 架构：事件监听器模式（非单一 callbacks）
 * - App.tsx 调 connect() 建立连接
 * - useSSE 通过 addEventListener 注册 routeWsEvent
 * - 多个组件可同时监听，互不干扰
 */

import { getApiBase } from '../utils/api';

// ── JSON-RPC 类型 ──

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ── 事件回调 ──

export type WsEventHandler = (eventName: string, data: unknown) => void

export interface WsConnectionCallbacks {
  onOpen?: (wasReconnect: boolean) => void
  onClose?: (code: number, reason: string) => void
  onError?: (error: Event) => void
}

// ── 连接状态 ──

export type WsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// ── 配置 ──

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const RECONNECT_MAX_ATTEMPTS = 20
const IDLE_PING_INTERVAL_MS = 30000

// ── WS 客户端类 ──

export class GatewayWsClient {
  private ws: WebSocket | null = null
  private url: string = ''
  private sessionId: string | null = null
  private rpcId = 0
  private pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private connCallbacks: WsConnectionCallbacks | null = null
  private eventListeners = new Set<WsEventHandler>()
  private reconnectCallback: ((wasReconnect: boolean) => void) | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private intentionallyClosed = false
  private _state: WsConnectionState = 'disconnected'
  private stateListeners = new Set<(s: WsConnectionState) => void>()

  // ── 公共状态 ──

  get state(): WsConnectionState { return this._state }

  private setState(s: WsConnectionState) {
    if (this._state === s) return
    this._state = s
    for (const fn of this.stateListeners) fn(s)
  }

  onStateChange(fn: (s: WsConnectionState) => void): () => void {
    this.stateListeners.add(fn)
    return () => this.stateListeners.delete(fn)
  }

  // ── 事件监听器 ──

  /** 注册事件监听器，返回取消注册函数 */
  addEventListener(handler: WsEventHandler): () => void {
    this.eventListeners.add(handler)
    return () => this.eventListeners.delete(handler)
  }

  /** 移除事件监听器 */
  removeEventListener(handler: WsEventHandler): void {
    this.eventListeners.delete(handler)
  }

  /** 分发事件到所有监听器 */
  private emit(eventName: string, data: unknown): void {
    for (const handler of this.eventListeners) {
      try {
        handler(eventName, data)
      } catch (e) {
        console.error('[WS] Event handler error:', e)
      }
    }
  }

  // ── 连接管理 ──

  connect(sessionId: string, callbacks?: WsConnectionCallbacks): void {
    this.sessionId = sessionId
    this.connCallbacks = callbacks ?? null
    this.intentionallyClosed = false

    const httpBase = getApiBase()
    // http://127.0.0.1:3001 → ws://127.0.0.1:3001/api/ws
    // 对齐后端路由: .route("/api/ws", get(ws_handler))
    const wsBase = httpBase.replace(/^http/, 'ws')
    this.url = `${wsBase}/api/ws?session_id=${encodeURIComponent(sessionId)}`

    this.doConnect()
  }

  private doConnect(): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }

    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    try {
      this.ws = new WebSocket(this.url)
    } catch (e) {
      console.error('[WS] Failed to create WebSocket:', e)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      console.log('[WS] Connected to', this.url)
      const wasReconnect = this.reconnectAttempts > 0
      this.reconnectAttempts = 0
      this.setState('connected')
      this.startPing()
      this.connCallbacks?.onOpen?.(wasReconnect)
      // 触发重连恢复回调（对齐 Eleve session.resume）
      if (wasReconnect && this.reconnectCallback) {
        this.reconnectCallback(true)
      }
    }

    this.ws.onclose = (ev) => {
      console.log('[WS] Closed:', ev.code, ev.reason)
      this.stopPing()
      this.setState('disconnected')
      this.connCallbacks?.onClose?.(ev.code, ev.reason)

      if (!this.intentionallyClosed) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = (ev) => {
      console.error('[WS] Error:', ev)
      this.connCallbacks?.onError?.(ev)
    }

    this.ws.onmessage = (ev) => {
      this.handleMessage(ev.data)
    }
  }

  disconnect(): void {
    this.intentionallyClosed = true
    this.clearReconnect()
    this.stopPing()

    // Reject all pending RPC
    for (const [, p] of this.pendingRpc) {
      p.reject(new Error('WebSocket closed'))
    }
    this.pendingRpc.clear()

    if (this.ws) {
      this.ws.onclose = null // prevent reconnect
      this.ws.close(1000, 'client disconnect')
      this.ws = null
    }
    this.setState('disconnected')
  }

  // ── 重连 ──

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error('[WS] Max reconnect attempts reached')
      return
    }

    this.clearReconnect()
    this.reconnectAttempts++

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 500,
      RECONNECT_MAX_MS
    )
    console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.doConnect()
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ── 心跳 ──

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // 发送 JSON-RPC ping（对齐 Eleve WS protocol）
        this.sendRpc('ping', {}).catch(() => {})
      }
    }, IDLE_PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  // ── 消息收发 ──

  /** 发送 JSON-RPC 请求，返回 Promise<result> */
  sendRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error(`WebSocket not open (state=${this.ws?.readyState})`))
        return
      }

      const id = ++this.rpcId
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
      this.pendingRpc.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(msg))

      // 超时 30s
      setTimeout(() => {
        if (this.pendingRpc.delete(id)) {
          reject(new Error(`RPC timeout: ${method}`))
        }
      }, 30000)
    })
  }

  /** 发送 JSON-RPC 通知（无 id，不等响应） */
  sendNotify(method: string, params: Record<string, unknown> = {}): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const msg = { jsonrpc: '2.0', method, params }
    this.ws.send(JSON.stringify(msg))
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw)

      // ── JSON-RPC 响应 ──
      if (msg.id !== undefined && msg.id !== null) {
        const id = msg.id as number
        const pending = this.pendingRpc.get(id)
        if (pending) {
          this.pendingRpc.delete(id)
          if (msg.error) {
            pending.reject(new Error(msg.error.message || `RPC error ${msg.error.code}`))
          } else {
            pending.resolve(msg.result)
          }
        }
        return
      }

      // ── 服务端推送事件 ──
      // 后端 sse_ws_broadcast 发送 JSON-RPC event 帧:
      // { "jsonrpc": "2.0", "method": "event", "params": { "type": "assistant.delta", ... } }
      // 需要从 params.type 提取实际事件名
      if (msg.method === 'event' && msg.params?.type) {
        // JSON-RPC event 帧：从 params.type 提取事件名
        const { type, ...rest } = msg.params as { type: string; [k: string]: unknown };
        
        // 对齐 Hermes: 监听 gateway.ready 事件作为连接就绪信号
        if (type === 'gateway.ready') {
          console.log('[WS] Gateway ready:', rest);
          // 触发连接就绪回调（对齐 Hermes gateway.ready 事件）
          // 如果 onopen 还没触发过，这里作为备用触发点
          if (this._state === 'connected' && this.connCallbacks?.onOpen) {
            // 已经 connected 状态，说明 onopen 已触发，这里只是日志
          } else {
            // 如果还没 connected，说明 WebSocket 已建立但 gateway 还没 ready
            // 这里可以触发一些初始化逻辑
            console.log('[WS] Gateway ready event received, connection fully initialized');
          }
        }
        
        this.emit(type, rest);
      } else if (msg.event) {
        // 兼容：{ event: "...", data: {...} } 格式
        this.emit(msg.event as string, msg.data ?? msg.params);
      } else if (msg.method && msg.method !== 'event') {
        // JSON-RPC notification 形式的推送（非 event 包装）
        this.emit(msg.method, msg.params);
      }
    } catch (e) {
      console.warn('[WS] Parse error:', e, raw?.slice(0, 200))
    }
  }

  // ── 会话切换 ──

  /** 切换会话 — 关闭旧连接，重连新 session */
  switchSession(newSessionId: string): void {
    const wasConnected = this._state === 'connected'
    this.disconnect()
    this.sessionId = newSessionId
    if (wasConnected) {
      this.connect(newSessionId, this.connCallbacks ?? undefined)
    }
  }

  // ── 便捷方法 ──

  /** 发送 prompt — 对齐 Eleve prompt.submit */
  async promptSubmit(text: string, sessionId?: string): Promise<unknown> {
    return this.sendRpc('prompt.submit', {
      session_id: sessionId || this.sessionId || '',
      message: text,  // 后端参数名为 message（对齐 Eleve JSON-RPC 协议）
    })
  }

  /** 中止当前流 */
  async abortStream(sessionId?: string): Promise<unknown> {
    return this.sendRpc('abort', {
      session_id: sessionId || this.sessionId || '',
    })
  }

  /** 设置重连恢复回调（对齐 Eleve gateway.ready → session.resume） */
  setReconnectCallback(cb: ((wasReconnect: boolean) => void) | null): void {
    this.reconnectCallback = cb
  }
}

// ── 单例 ──

let _instance: GatewayWsClient | null = null

export function getWsClient(): GatewayWsClient {
  if (!_instance) {
    _instance = new GatewayWsClient()
  }
  return _instance
}

export function resetWsClient(): void {
  if (_instance) {
    _instance.disconnect()
    _instance = null
  }
}
