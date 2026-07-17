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

/** Phase 1: 统一 RPC 错误格式，对齐 HTTP 错误语义 */
export class RpcError extends Error {
  code: number
  constructor(message: string, code: number = -1) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
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
const RECONNECT_MAX_MS = 15000  // 对齐 Hermes: 上限 15s（1s→2s→4s→8s→15s→15s...）
const RECONNECT_MAX_ATTEMPTS = 20
const IDLE_PING_INTERVAL_MS = 30000

// ── WS 客户端类 ──

export class GatewayWsClient {
  private ws: WebSocket | null = null
  private url: string = ''
  public sessionId: string | null = null  // 对齐 Hermes: session 通过 RPC 管理，不需要 WS 重连
  private rpcId = 0
  private pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  // Phase 1: WS 未连接时排队等待的 RPC 请求
  private pendingQueue: Array<{ method: string; params: Record<string, unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = []
  private connCallbacks: WsConnectionCallbacks | null = null
  private eventListeners = new Set<WsEventHandler>()
  private reconnectCallback: ((wasReconnect: boolean) => void) | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private intentionallyClosed = false
  private _state: WsConnectionState = 'disconnected'
  private stateListeners = new Set<(s: WsConnectionState) => void>()
  // 对齐 Hermes: 唤醒信号（online + visibilitychange）触发立即重连
  private onOnlineHandler: (() => void) | null = null
  private onVisibleHandler: (() => void) | null = null

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

  connect(sessionId?: string, callbacks?: WsConnectionCallbacks): void {
    // 对齐 Hermes Desktop: WS 连接不传 session_id
    // Hermes Desktop: gateway.connect(wsUrl) — URL 里没有 session_id
    // Session 是连接建立后通过 WS RPC (prompt.submit 的 session_id 参数) 管理的
    this.sessionId = sessionId ?? null
    this.connCallbacks = callbacks ?? null
    this.intentionallyClosed = false

    const httpBase = getApiBase()
    const wsBase = httpBase.replace(/^http/, 'ws')
    // 对齐 Hermes: WS URL 不带 session_id，纯连接
    this.url = `${wsBase}/api/ws`

    this.doConnect()
    this.registerWakeSignals()  // 对齐 Hermes: online + visibilitychange 唤醒信号
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

    // 重连时重新获取 URL（端口可能因 eleved 重启而变化）
    const httpBase = getApiBase()
    const wsBase = httpBase.replace(/^http/, 'ws')
    // 对齐 Hermes: WS URL 不带 session_id
    this.url = `${wsBase}/api/ws`

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
      this.flushPendingQueue()  // Phase 1: flush 排队的 RPC 请求
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
      // Phase 1: reject 排队中的 RPC 请求
      this.rejectPendingQueue(`WebSocket closed (code=${ev.code})`)
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

  /** 等待 WS 连接建立（最多 timeout 毫秒）
   * 对齐 Hermes Desktop: 即使当前是 disconnected，也等待（因为调用方可能已触发重连）
   */
  waitForConnected(timeout = 3000): Promise<boolean> {
    if (this._state === 'connected') return Promise.resolve(true)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub()
        resolve(this._state === 'connected')
      }, timeout)

      const unsub = this.onStateChange((state) => {
        if (state === 'connected') {
          clearTimeout(timer)
          unsub()
          resolve(true)
        } else if (state === 'disconnected') {
          // 不立即返回 false — 重连可能还在进行中
          // 等超时再判定
        }
      })
    })
  }

  disconnect(): void {
    this.intentionallyClosed = true
    this.clearReconnect()
    this.stopPing()
    this.unregisterWakeSignals()  // 对齐 Hermes: 断连时移除唤醒信号

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

  // ── 唤醒信号（对齐 Hermes use-gateway-boot.ts:270-290）──

  /** 立即重连 — 对齐 Hermes reconnectNow() */
  private reconnectNow(): void {
    if (this.intentionallyClosed || this._state === 'connected') return
    this.clearReconnect()
    this.reconnectAttempts = 0
    this.doConnect()
  }

  /** 注册唤醒信号：online + visibilitychange */
  private registerWakeSignals(): void {
    this.unregisterWakeSignals()  // 防重复注册

    this.onOnlineHandler = () => this.reconnectNow()
    this.onVisibleHandler = () => {
      if (document.visibilityState === 'visible') {
        this.reconnectNow()
      }
    }

    window.addEventListener('online', this.onOnlineHandler)
    document.addEventListener('visibilitychange', this.onVisibleHandler)
  }

  /** 移除唤醒信号 */
  private unregisterWakeSignals(): void {
    if (this.onOnlineHandler) {
      window.removeEventListener('online', this.onOnlineHandler)
      this.onOnlineHandler = null
    }
    if (this.onVisibleHandler) {
      document.removeEventListener('visibilitychange', this.onVisibleHandler)
      this.onVisibleHandler = null
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

  /** 发送 JSON-RPC 请求，返回 Promise<result>
   *  Phase 1: WS 未连接时排队等待，连接后自动发送 */
  sendRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // WS 已连接：直接发送
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.doSendRpc(method, params, resolve, reject)
        return
      }

      // WS 正在连接/重连中：排队等待
      if (this._state === 'connecting' || this._state === 'reconnecting') {
        const timeoutMs = method === 'prompt.submit' ? 1_800_000 : 60_000
        const timer = setTimeout(() => {
          // 超时：从队列移除并 reject
          const idx = this.pendingQueue.findIndex(e => e.method === method && e.resolve === resolve)
          if (idx >= 0) this.pendingQueue.splice(idx, 1)
          reject(new RpcError(`RPC timeout waiting for connection: ${method}`, -1))
        }, timeoutMs)
        this.pendingQueue.push({ method, params, resolve, reject, timer })
        return
      }

      // WS 未连接且不在重连中：reject
      reject(new RpcError(`WebSocket not connected (state=${this._state})`, -1))
    })
  }

  /** 内部：实际发送 RPC 请求 */
  private doSendRpc(method: string, params: Record<string, unknown>, resolve: (v: unknown) => void, reject: (e: Error) => void): void {
    const id = ++this.rpcId
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    this.pendingRpc.set(id, { resolve, reject })
    this.ws!.send(JSON.stringify(msg))

    // 对齐 Hermes: prompt.submit 1800s（30分钟），其他 60s
    const timeoutMs = method === 'prompt.submit' ? 1_800_000 : 60_000
    setTimeout(() => {
      if (this.pendingRpc.delete(id)) {
        reject(new RpcError(`RPC timeout: ${method}`, -1))
      }
    }, timeoutMs)
  }

  /** WS 连接成功后 flush 排队的 RPC 请求 */
  private flushPendingQueue(): void {
    const queue = this.pendingQueue.splice(0)
    for (const entry of queue) {
      clearTimeout(entry.timer)
      this.doSendRpc(entry.method, entry.params, entry.resolve, entry.reject)
    }
  }

  /** WS 断连时 reject 排队中的 RPC 请求 */
  private rejectPendingQueue(reason: string): void {
    const queue = this.pendingQueue.splice(0)
    for (const entry of queue) {
      clearTimeout(entry.timer)
      entry.reject(new RpcError(reason, -1))
    }
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
            pending.reject(new RpcError(msg.error.message || `RPC error ${msg.error.code}`, msg.error.code))
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

  /** 切换会话 — 对齐 Hermes Desktop: 只更新 sessionId，不断开WS重连
   * Hermes Desktop: session 变化时只更新本地状态，不发 disconnect/connect
   * WS 连接是长连接，session 通过 RPC prompt.submit 的 session_id 参数切换
   */
  switchSession(newSessionId: string): void {
    this.sessionId = newSessionId
    // 不断开 WS — 后端 prompt.submit 会带 session_id 做 get_or_create
  }

  // ── 便捷方法 ──

  /** 发送 prompt — 对齐 Eleve prompt.submit（参数 text） */
  async promptSubmit(text: string, sessionId?: string, options?: { model?: string; provider?: string }): Promise<unknown> {
    return this.sendRpc('prompt.submit', {
      session_id: sessionId || this.sessionId || '',
      text,
      // 对齐架构原则：后端是 session 生命周期权威源
      // model/provider 直接传给 prompt.submit，后端自动创建 session 时应用
      model: options?.model || '',
      provider: options?.provider || '',
    })
  }

  /** 中止当前流 — 对齐 Eleve session.interrupt */
  async abortStream(sessionId?: string): Promise<unknown> {
    return this.sendRpc('session.interrupt', {
      session_id: sessionId || this.sessionId || '',
    })
  }

  /** 执行 slash 命令 — 对齐 Eleve slash.exec */
  async slashExec(command: string, sessionId?: string): Promise<unknown> {
    return this.sendRpc('slash.exec', { command, session_id: sessionId || this.sessionId || '' })
  }

  /** 命令路由分发 — 对齐 Eleve command.dispatch */
  async commandDispatch(name: string, arg?: string, sessionId?: string): Promise<unknown> {
    return this.sendRpc('command.dispatch', { name, arg: arg || '', session_id: sessionId || this.sessionId || '' })
  }

  /** 获取命令目录 — 对齐 Eleve commands.catalog */
  async commandsCatalog(): Promise<unknown> {
    return this.sendRpc('commands.catalog', {})
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
