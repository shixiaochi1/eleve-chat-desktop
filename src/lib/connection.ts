/**
 * connection.ts — 连接管理（对齐 Hermes $connection / connection-config）
 *
 * 模式：
 * - local：Tauri 壳本地 spawn eleved（127.0.0.1 动态端口，discoverPort 发现）
 * - remote：前端直连远程 eleved（--listen/--port 部署，对齐 Hermes remote gateway）
 *
 * 架构洞察：ELEVE 所有操作（files/process/terminal/git/会话）都经 WS RPC 打到
 * 后端——后端在哪，操作就在哪。remote 化 = 换 base 地址（setHttpBase），
 * ws-client 每次连接/重连都从 getApiBase() 动态解析，无需 Hermes 那套
 * Electron fs 双分支（ELEVE 无 Electron main fs）。
 *
 * 鉴权：当前 LAN 信任（后端无鉴权）；/api/status 返回 auth_required 字段，
 * 后续加 token 时前端契约不变（对齐 Hermes probe 语义）。
 */
import { setHttpBase } from '../utils/bridge';
import { loadSettings, saveSettings } from '../utils/settings-store';

export type ConnectionMode = 'local' | 'remote';

export interface ConnectionState {
  mode: ConnectionMode;
  /** remote 模式的后端 base URL（http://host:port）；local 忽略 */
  baseUrl: string;
  /** 远程后端版本（探测结果缓存，用于版本提示） */
  remoteVersion?: string | null;
}

export const DEFAULT_CONNECTION: ConnectionState = {
  mode: 'local',
  baseUrl: '',
  remoteVersion: null,
};

export function normalizeRemoteBaseUrl(rawUrl: string): string {
  const value = String(rawUrl || '').trim();
  // 用户常粘贴无 scheme 的 "host:port"（Tailscale IP / LAN hostname）——自动补 http://
  // （对齐 Hermes coerceRemoteUrlScheme：只有真实 scheme:// 前缀才跳过补全）
  if (!value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  return `http://${value}`;
}

/**
 * 探测远程后端（对齐 Hermes probeConnectionConfig 双通道语义）：
 * ① HTTP GET /api/status → reachable + version
 * ② 真实 WS 连接 /api/ws → 确认聊天通道可用（Hermes 教训：HTTP 可达但 WS
 *    被代理/防火墙/Origin 守卫挡掉 → 假阳性“可达”；必须两段都过才算通）
 */
export async function probeRemote(baseUrl: string): Promise<{
  reachable: boolean;
  version: string | null;
  authRequired: boolean;
  error: string | null;
}> {
  const url = normalizeRemoteBaseUrl(baseUrl);
  if (!url) {
    return { reachable: false, version: null, authRequired: false, error: '远程地址为空' };
  }
  let version: string | null = null;
  let authRequired = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/status`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { reachable: false, version: null, authRequired: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { version?: string; auth_required?: boolean; status?: string };
    version = data.version ?? null;
    authRequired = Boolean(data.auth_required);
  } catch (err) {
    return {
      reachable: false,
      version: null,
      authRequired: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ② WS 通道（对齐 Hermes gateway-ws-probe：upgrade 接受 + post-handshake
  // 750ms grace 防“接受后立即拒绝”；收到任何帧 = 明确成功）
  const wsBase = url.replace(/^http/, 'ws');
  const wsProbe = await probeWebSocket(`${wsBase.replace(/\/+$/, '')}/api/ws`);
  if (!wsProbe.ok) {
    return {
      reachable: false,
      version,
      authRequired,
      error: `HTTP 可达但 WebSocket 失败：${wsProbe.reason}（可能被代理/防火墙/网关守卫拦截）`,
    };
  }

  return { reachable: true, version, authRequired, error: null };
}

/** 真实 WS 连接探测（对齐 Hermes probeGatewayWebSocket 语义） */
function probeWebSocket(
  wsUrl: string,
  connectTimeoutMs = 10_000,
  readyGraceMs = 750,
): Promise<{ ok: boolean; reason: string | null }> {
  return new Promise(resolve => {
    let settled = false;
    let opened = false;
    let socket: WebSocket | null = null;
    const timers: number[] = [];

    const finish = (ok: boolean, reason: string | null) => {
      if (settled) return;
      settled = true;
      timers.forEach(t => window.clearTimeout(t));
      try {
        socket?.close();
      } catch {
        // best effort teardown
      }
      resolve({ ok, reason });
    };

    try {
      socket = new WebSocket(wsUrl);
    } catch (err) {
      finish(false, err instanceof Error ? err.message : String(err));
      return;
    }

    const onOpen = () => {
      if (settled) return;
      opened = true;
      // Upgrade 已接受：留 grace 窗口防 post-handshake 凭据拒绝（对齐 Hermes）
      timers.push(window.setTimeout(() => finish(true, null), readyGraceMs));
    };
    const onMessage = () => finish(true, null);
    const onError = () => finish(false, 'WebSocket 连接失败');
    const onClose = (ev: CloseEvent) => {
      if (settled) return;
      if (opened) {
        finish(false, '网关接受了连接但在握手后关闭（可能被服务端拒绝）');
      } else {
        finish(false, `网关在连接建立前关闭了 WebSocket${ev.code ? `（code ${ev.code}）` : ''}`);
      }
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    timers.push(window.setTimeout(() => finish(false, `连接超时（${connectTimeoutMs}ms）`), connectTimeoutMs));
  });
}

/**
 * 应用连接配置：切换 base（ws-client 每次连接/重连动态读 getApiBase）。
 * local → 还原为 discoverPort 目标（127.0.0.1:<port>，下次 discoverPort 覆盖）；
 * remote → 固定远程 base。
 */
export function applyConnection(conn: ConnectionState): void {
  if (conn.mode === 'remote' && conn.baseUrl) {
    setHttpBase(normalizeRemoteBaseUrl(conn.baseUrl));
  }
  // local：不设 base，保持默认/discoverPort 行为（bridge._httpBaseSet=false 语义
  // 由调用方处理——见 App.tsx 启动分支）
}

/** 当前是否为 remote 模式（对齐 Hermes isDesktopFsRemoteMode） */
export function isRemoteMode(conn: ConnectionState | null | undefined): boolean {
  return conn?.mode === 'remote';
}

/** 从 settings.json 读取连接配置（无配置 → local 默认） */
export function loadConnection(): ConnectionState {
  const s = loadSettings();
  const c = s.connection;
  if (!c || (c.mode !== 'local' && c.mode !== 'remote')) {
    return { ...DEFAULT_CONNECTION };
  }
  return {
    mode: c.mode,
    baseUrl: c.baseUrl || '',
    remoteVersion: c.remoteVersion ?? null,
  };
}

/** 持久化连接配置到 settings.json */
export async function saveConnection(conn: ConnectionState): Promise<void> {
  const s = loadSettings();
  s.connection = {
    mode: conn.mode,
    baseUrl: conn.baseUrl || '',
    remoteVersion: conn.remoteVersion ?? null,
  };
  await saveSettings(s);
}
