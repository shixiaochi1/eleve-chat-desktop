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

// ── 多 Profile：当前活动 profile（对齐 Hermes setApiRequestProfile 模式）──
// 单点注入：sendRpc 自动给作用域 RPC 盖章 params.profile，避免逐调用点遗漏。
// 对齐 Hermes hermes-profile-scope 契约："every backend-targeted action must carry the active gateway profile"。
// 单 profile / default → null（省略），后端回退 launch profile（default），行为不变。
let activeProfile: string | null = null
export function setWsActiveProfile(profile: string | null | undefined): void {
  activeProfile = profile && profile !== 'default' ? profile : null
}
/** 获取当前 WS 层活跃 profile（null = default） */
export function getWsActiveProfile(): string | null {
  return activeProfile
}

// ── WS 客户端类 ──

export class GatewayWsClient {
  private ws: WebSocket | null = null
  private url: string = ''
  public sessionId: string | null = null  // 对齐 Hermes: session 通过 RPC 管理，不需要 WS 重连
  /** 🔴 订阅注册表：已 attach 的 session 集合（重连后自动 re-attach，pub/sub 标准模式） */
  private attachedSessions = new Set<string>()
  private rpcId = 0
  private pendingRpc = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  // Phase 1: WS 未连接时排队等待的 RPC 请求
  private pendingQueue: Array<{ method: string; params: Record<string, unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = []
  private connCallbacks: WsConnectionCallbacks | null = null
  private eventListeners = new Set<WsEventHandler>()
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

  /**
   * 等待 WS 连接就绪（已连接立即 resolve；否则订阅状态变化，连接后 resolve）。
   * 冷启动竞态修复：面板 mount 时 WS 可能仍在 connecting（后端启动慢），
   * 此时 sendRpc 在 disconnected 态直接 reject（不排队）→ 不能立即发 RPC，必须等连接。
   * 对齐 App 启动链模式（storage.init 失败不封死 + onOpen 补拉）。
   * 超时 reject（默认 60s），由调用方决定降级提示。
   */
  whenConnected(timeoutMs = 60_000): Promise<void> {
    if (this._state === 'connected') return Promise.resolve()
    return new Promise((resolve, reject) => {
      const unsub = this.onStateChange((s) => {
        if (s === 'connected') {
          clearTimeout(timer)
          unsub()
          resolve()
        }
      })
      const timer = setTimeout(() => {
        unsub()
        reject(new RpcError('等待网关连接超时', -1))
      }, timeoutMs)
    })
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
    // 🔴 恢复链修复：重连时带 session_id → 后端自动注册 ws_clients + 推送 session.info
    // 首次连接 sessionId=null 不带（对齐 Hermes）；重连/切换后 sessionId 已设置则带上
    this.url = this.sessionId
      ? `${wsBase}/api/ws?session_id=${encodeURIComponent(this.sessionId)}`
      : `${wsBase}/api/ws`

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
      // 🔴 重连恢复订阅：pub/sub 标准模式——订阅者重连后重新声明订阅
      // 遍历注册表批量 re-attach，后端重新注册 ws_clients + 推 session.info（状态全量对齐）
      if (wasReconnect && this.attachedSessions.size > 0) {
        for (const sid of this.attachedSessions) {
          // 🔴 审查 P3: 与 switchSession 的 session.attach 错误处理一致（P2-2），失败显式 warn 便于排查重连恢复断线
          this.sendRpc('session.attach', { session_id: sid }).catch((e) => { console.warn('[ws] re-attach failed:', sid, e) })
        }
      }
      this.connCallbacks?.onOpen?.(wasReconnect)
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

  /** 确保 WS 已连接：disconnected 时触发重连，connecting/reconnecting 时等待。
   *  与 connect() 不同：不重置 sessionId / connCallbacks（仅补连，非初始化）。
   *  返回 timeout 内是否连上。 */
  async ensureConnected(timeout = 10000): Promise<boolean> {
    if (this._state === 'connected') return true
    if (this._state === 'disconnected') {
      this.intentionallyClosed = false
      this.doConnect()
    }
    return this.waitForConnected(timeout)
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
    // 🔴 S1: 始终盖章 profile（default 也传）— 消灭 null 语义分裂。
    // 桌面端请求永不 fallback 到 ③（R-B 铁则）。
    // activeProfile=null 时盖章 "default"，后端按来源判别：桌面 None→default 永不读 ③。
    if (params.profile === undefined) {
      params = { ...params, profile: activeProfile ?? 'default' }
    }
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
    // 🔴 订阅注册表：记录已 attach 的 session（重连后自动 re-attach）
    if (newSessionId) this.attachedSessions.add(newSessionId)
    // 🔴 恢复链修复：切换 session 时通知后端注册 ws_clients 事件路由 + 推送 session.info
    // 保证切换后流式事件有投递目标 + pending 交互可恢复（不依赖 prompt.submit 才注册）
    if (newSessionId && this._state === 'connected') {
      this.sendRpc('session.attach', { session_id: newSessionId }).catch((e) => { console.warn('[ws] session.attach failed:', e) })
    }
  }

  /** 取消订阅（会话删除时调用，从注册表移除，重连后不再 re-attach） */
  detachSession(sessionId: string): void {
    this.attachedSessions.delete(sessionId)
  }

  // ── 便捷方法 ──

  /** 发送 prompt — 对齐 Eleve prompt.submit（参数 text）
   * 对齐 Hermes pending_title: title 参数由后端在 message.complete 后应用到 DB
   */
  async promptSubmit(
    text: string,
    sessionId?: string,
    options?: { model?: string; provider?: string; title?: string },
  ): Promise<unknown> {
    return this.sendRpc('prompt.submit', {
      session_id: sessionId || this.sessionId || '',
      text,
      // 对齐架构原则：后端是 session 生命周期权威源
      // model/provider 直接传给 prompt.submit，后端自动创建 session 时应用
      model: options?.model || '',
      provider: options?.provider || '',
      // 对齐 Hermes pending_title: 首次消息时传入标题，后端完成 turn 后应用
      title: options?.title || '',
    })
  }

  /** 创建会话 — 对齐 Eleve session.create（后端是 session 生命周期权威源）
   * 用于“有图片附件但尚无会话”时在 submit 前懒创建（对齐 Hermes createBackendSessionForSend）。
   * model/provider 不在此传：随后的 prompt.submit 会携带并应用 per-session override（复用既有 switch_model 路径）。
   */
  async sessionCreate(options?: { profile?: string; title?: string; cwd?: string }): Promise<SessionCreateResponse> {
    const result = await this.sendRpc('session.create', {
      ...(options?.profile ? { profile: options.profile } : {}),
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.cwd ? { cwd: options.cwd } : {}),
    })
    return result as SessionCreateResponse
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

  /** 附加图片（base64）— 对齐 Eleve image.attach_bytes
   * 后端接收 content_base64，写入 ELEVE_HOME/images/，返回 {attached, path, count, bytes, text}
   */
  async imageAttachBytes(contentBase64: string, filename?: string, sessionId?: string): Promise<ImageAttachResponse> {
    const result = await this.sendRpc('image.attach_bytes', {
      session_id: sessionId || this.sessionId || '',
      content_base64: contentBase64,
      filename: filename || '',
    })
    return result as ImageAttachResponse
  }

  /** 分离图片 — 对齐 Eleve image.detach
   * 后端接收 path，从 session.attached_images 移除，返回 {detached, count}
   */
  async imageDetach(path: string, sessionId?: string): Promise<ImageDetachResponse> {
    const result = await this.sendRpc('image.detach', {
      session_id: sessionId || this.sessionId || '',
      path,
    })
    return result as ImageDetachResponse
  }

  // ── 语音 RPC（对齐后端 ws/mod.rs voice.record）──

  /**
   * 语音录制 — 对齐 Hermes voice.record
   * action: start（开始 VAD 录音）/ stop（停止并转录）/ status（查询状态）
   * 转录结果由后端通过 voice.transcript 事件推送回前端（见 useVoice 钩子）
   */
  async voiceRecord(action: 'start' | 'stop' | 'status' = 'status'): Promise<VoiceRecordResponse> {
    const result = await this.sendRpc('voice.record', { action })
    return result as VoiceRecordResponse
  }

  // ── 配置读写 RPC（对齐后端 ws/mod.rs config.get / config.set）──

  /** 读配置 — config.get { key } */
  async configGet(key: string): Promise<ConfigGetResponse> {
    const result = await this.sendRpc('config.get', { key })
    return result as ConfigGetResponse
  }

  /** 写配置 — config.set { key, value }，内存+磁盘原子更新、立即生效 */
  async configSet(key: string, value: unknown): Promise<ConfigSetResponse> {
    const result = await this.sendRpc('config.set', { key, value })
    return result as ConfigSetResponse
  }

  // ── 浏览器自动化 RPC（对齐后端 ws/rpc_browser.rs browser.manage）──

  /** 浏览器管理 — browser.manage { action: status/connect/disconnect, url? }（CDP 连接） */
  async browserManage(action: 'status' | 'connect' | 'disconnect', url?: string): Promise<BrowserManageResponse> {
    const params: Record<string, unknown> = { action }
    if (url) params.url = url
    const result = await this.sendRpc('browser.manage', params)
    return result as BrowserManageResponse
  }

}

// ── 图片附件 RPC 响应类型（对齐后端 ws/mod.rs image.attach_bytes / image.detach）──

export interface ImageAttachResponse {
  attached?: boolean
  path?: string
  count?: number
  bytes?: number
  text?: string
}

export interface ImageDetachResponse {
  detached?: boolean
  count?: number
}

// ── 会话创建 RPC 响应类型（对齐后端 ws/rpc_session.rs session.create）──

export interface SessionCreateResponse {
  session_id: string
  stored_session_id?: string
  message_count?: number
  info?: { model?: string; cwd?: string; [key: string]: unknown }
}

// ── 语音 RPC 响应类型（对齐后端 ws/mod.rs voice.*）──

export interface VoiceRecordResponse {
  ok?: boolean
  status?: 'recording' | 'transcribing' | 'idle' | string
}

// ── 配置 RPC 响应类型（对齐后端 ws/mod.rs config.get / config.set）──

export interface ConfigGetResponse {
  ok?: boolean
  value?: unknown
  [key: string]: unknown
}

export interface ConfigSetResponse {
  ok?: boolean
  [key: string]: unknown
}

// ── 浏览器 RPC 响应类型（对齐后端 ws/rpc_browser.rs browser.manage）──

export interface BrowserManageResponse {
  connected?: boolean
  url?: string | null
  [key: string]: unknown
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
