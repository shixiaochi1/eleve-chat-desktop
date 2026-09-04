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
    return sock.sendRpc(method, { ...params, profile: route.profile }, timeoutMs) as Promise<T>;
  }
  const { call } = await import('../utils/bridge');
  return call(method, params) as Promise<T>;
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
