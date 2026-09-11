/**
 * Remote connection registry -- multi-connection base (stage 2).
 *
 * Aligned with Hermes Desktop connections-registry: the Desktop owns EVERY
 * gateway socket; gateways never hold each other's credentials. The main
 * connection (getWsClient) stays untouched -- remote sockets are separate
 * GatewayWsClient instances created lazily per connection id and driven via
 * connectRemote(wsBase). Routing helper requestForBot dispatches an RPC on
 * the owning connection's socket (null route = active/main connection).
 *
 * Persistence: localStorage eleve.connections.remote (id/name/wsUrl).
 */
import { useSyncExternalStore } from 'react';
import { GatewayWsClient } from './ws-client';

export interface RemoteConnection {
  /** stable id */
  id: string;
  /** display name */
  name: string;
  /** ws base, e.g. ws://192.168.1.10:7878 (no path) */
  wsUrl: string;
}

export interface BotRoute {
  connectionId: string;
  profile: string;
}

const KEY = 'eleve.connections.remote';
const PROBE_TIMEOUT_MS = 5000;

let connections: RemoteConnection[] = load();
const listeners = new Set<() => void>();
/** lazy socket per connection id */
const sockets = new Map<string, GatewayWsClient>();
let probeSeq = 0;

function load(): RemoteConnection[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c): c is RemoteConnection => !!c && typeof c.id === 'string' && typeof c.wsUrl === 'string')
      .map(c => ({ id: c.id, name: typeof c.name === 'string' ? c.name : c.id, wsUrl: c.wsUrl }));
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(connections));
  } catch {
    /* private mode: memory only */
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listRemoteConnections(): readonly RemoteConnection[] {
  return connections;
}

export function useRemoteConnections(): readonly RemoteConnection[] {
  return useSyncExternalStore(subscribe, () => connections, () => connections);
}

export function addRemoteConnection(name: string, wsUrl: string): RemoteConnection {
  const conn: RemoteConnection = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)),
    name: name.trim() || 'remote',
    wsUrl: wsUrl.trim().replace(/\/$/, ''),
  };
  connections = [...connections, conn];
  persist();
  return conn;
}

export function updateRemoteConnection(id: string, name: string, wsUrl: string): void {
  connections = connections.map(c =>
    c.id === id ? { ...c, name: name.trim() || c.name, wsUrl: wsUrl.trim().replace(/\/$/, '') } : c,
  );
  // config changed: drop the cached socket so next use reconnects with new URL
  const old = sockets.get(id);
  if (old) {
    old.disconnect();
    sockets.delete(id);
  }
  persist();
}

export function removeRemoteConnection(id: string): void {
  connections = connections.filter(c => c.id !== id);
  const old = sockets.get(id);
  if (old) {
    old.disconnect();
    sockets.delete(id);
  }
  persist();
}

/** Lazy socket per connection (created on first use; reconnect handled inside). */
export function getRemoteSocket(id: string): GatewayWsClient {
  let sock = sockets.get(id);
  if (!sock) {
    const conn = connections.find(c => c.id === id);
    if (!conn) throw new Error('Unknown connection: ' + id);
    sock = new GatewayWsClient();
    sock.connectRemote(conn.wsUrl);
    sockets.set(id, sock);
  }
  return sock;
}

/**
 * Route an RPC to the owning connection (aligned with Hermes requestForBot /
 * host.requestProfile): null route = active (main) connection via bridge.
 * timeoutMs 透传给 sendRpc（bot_relay.deliver 等长处理器需要 900s+ 预算）。
 *
 * 🔴 2026-09-05 round-54 P0 修复：route 只决定骑哪条 socket，**不再往
 * params 注入 profile**。此前 `{ ...params, profile: route.profile }` 把
 * 调用点显式传入的目标 profile 无条件覆盖为 route.profile（routeOf 恒
 * 'default'）——远端 `bot.chat.ensure` 建的是 default 的 Bot Chat 而非
 * 点中的 bot；relay drain 的 `bot_relay.deliver` 恒投给远端 default。
 * Hermes 同语义：requestForBot 仅路由、不改 params，业务参数由调用点自足。
 * route.profile 保留为未来 per-profile 路由的通道标识，不参与参数合成。
 *
 * 🔴 round-96 P0 修复（本机路径的**真断点**）：`method` 是 **RPC 名**
 * （`'bots.roster'` / `'bot_relay.outbox.drain'` / `'bot.rooms.grant.pending'`
 * …），不是 bridge 的 legacy snake_case 命令键。此前本机分支走
 * `call(method)`，而 `call` 是 `COMMAND_TO_WS_METHOD[command]` **按键查表**
 * （键是 `bots_roster` 这种下划线形式）→ RPC 名恒查不到 → 抛
 * "No WS/HTTP mapping" → 被各处 `catch {}` 静默吞掉。于是整条跨机链路在
 * **本机作 authority**（= 建房的那台机器，最常见）时全死：
 *   - `relayConnections()` 首项就是本机，`routeOf(本机)` 返回 null；
 *   - `deliverPeerDispatch` / `runGrantHandshake` 的 `routeOf(authority)`
 *     同理（authority 就是本机）。
 * 症状：本机网关收不到远端 roster（`read_remote_roster` 恒空 → 远端成员被
 * 判"本机跑不了"并被 `ensure_profile` 物化成空 profile）、本机 outbox 永不
 * 被拉、跨机 dispatch 队列永不拉取、peer 结果永远写不回、授权握手永不发起。
 * 修法 = 本机分支与远端分支同构：直接 `sendRpc(RPC 名)`，不经命令表——
 * 命令表只服务组件的 legacy 调用（那些走 `call()` 本身），不该出现在这里。
 * `adaptParams` 对 RPC 名是 `default: return args`（no-op），故无行为损失。
 */
export async function requestForBot<T = unknown>(
  route: BotRoute | null | undefined,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<T> {
  if (route && route.connectionId) {
    const sock = getRemoteSocket(route.connectionId);
    await sock.whenConnected();
    return sock.sendRpc(method, { ...params }, timeoutMs) as Promise<T>;
  }
  const { getWsClient } = await import('./ws-client');
  return getWsClient().sendRpc(method, { ...params }, timeoutMs) as Promise<T>;
}

/** Probe a ws base: resolves { ok, latencyMs } or { ok: false, error }. */
export function probeRemote(wsUrl: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const base = wsUrl.trim().replace(/\/$/, '');
  return new Promise(resolve => {
    const seq = ++probeSeq;
    const started = Date.now();
    let settled = false;
    const finish = (r: { ok: boolean; latencyMs?: number; error?: string }) => {
      if (settled || seq !== probeSeq) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve(r);
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(base + '/api/ws');
    } catch (e) {
      finish({ ok: false, error: String(e) });
      return;
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      finish({ ok: true, latencyMs: Date.now() - started });
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish({ ok: false, error: 'connect failed' });
    };
    ws.onclose = () => {
      clearTimeout(timer);
      finish({ ok: false, error: 'closed before open' });
    };
  });
}
