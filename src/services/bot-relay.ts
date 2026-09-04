/**
 * Bot Mode cross-connection relay — Desktop-as-router（stage-3）。
 *
 * 🔴 2026-09-04 对齐 Hermes apps/desktop/src/plugins/hermes-bots/relay.ts：
 * connections ARE the peer set——Desktop 持有的每条网关连接（本地 + 远程）
 * 都是持久线路；Desktop 是 relay，拥有全部 socket，做所有跨连接 I/O。
 * 两个循环：
 *  - roster loop：把"其它连接"的 agent 联合名册推给每个网关
 *    （bot_relay.roster.sync），message_agent 据此解析跨网关目标；
 *  - drain loop：收集每个网关 outbox 的信封（bot_relay.outbox.drain），
 *    在目标连接自己的 socket 上投递（bot_relay.deliver），把回信写回
 *    发送方网关（bot_relay.reply）——waiter 唤醒发送 agent。
 * 旧后端缺 RPC 时逐调用失败并跳过——relay 降级到连接子集支持的范围。
 *
 * 文件管道语义（网关侧）见根仓 crates/eleve-app/src/bot_relay.rs。
 */
import { requestForBot, listRemoteConnections } from './connections';
import type { RemoteConnection } from './connections';
import { fetchBotsRoster, type BotRosterEntry } from '../utils/api';

// ── 节奏常量（对齐 relay.ts）──
const RELAY_ROSTER_INTERVAL_MS = 60_000;
/** backstop 节奏：push 信号（bot_relay.outbox.pending，v2）承载信封延迟，
 *  30s 轮询兜旧后端/丢事件（对齐 #93594 注释） */
const RELAY_DRAIN_INTERVAL_MS = 30_000;
/** deliver 客户端预算：目标网关一轮 Bot Chat（REPLY_WAIT_SECONDS=900s）
 *  + 结算/传输余量（对齐 Hermes ceiling+margin 形态） */
const RELAY_DELIVER_TIMEOUT_MS = 1_500_000;

/** 本地（主）连接的稳定 id */
export const LOCAL_CONNECTION_ID = 'local';

interface RelayAgentRow {
  profile: string;
  handle: string;
  connection_id: string;
  connection_label: string;
  title?: string;
  description?: string;
}

interface RelayEnvelope {
  id: string;
  created_at: number;
  from_profile: string;
  from_handle: string;
  target_connection: string;
  target_profile: string;
  target_handle: string;
  message: string;
}

/** Desktop 当前可达的全部连接（本地 + 远程注册表）。 */
function relayConnections(): Array<{ id: string; label: string; remote: RemoteConnection | null }> {
  const conns: Array<{ id: string; label: string; remote: RemoteConnection | null }> = [
    { id: LOCAL_CONNECTION_ID, label: '本机', remote: null },
  ];
  for (const c of listRemoteConnections()) {
    conns.push({ id: c.id, label: c.name, remote: c });
  }
  return conns;
}

function routeOf(conn: { id: string; remote: RemoteConnection | null }) {
  return conn.remote ? { connectionId: conn.remote.id, profile: 'default' } : null;
}

// ── 每连接的 last-good agent rows：拉取闪断复用上次数据，防止把"活着
// 的机器"误推成缺席（网关侧 liveness 把新鲜 roster 的缺席读作确定离线
// → 假 runtime_offline 拒绝，对齐 relay.ts relayAgentsCache 注释）──
const relayAgentsCache = new Map<string, RelayAgentRow[]>();
const RELAY_AGENTS_CACHE_MAX = 32;

/** 拉一个连接上的 agents（失败返回 null ≠ 真空列表，两者语义不同）。 */
async function relayAgentsOn(
  conn: { id: string; label: string; remote: RemoteConnection | null },
): Promise<RelayAgentRow[] | null> {
  try {
    const roster = await requestForBot<BotRosterEntry[]>(routeOf(conn), 'bots.roster', {});
    const rows = Array.isArray(roster) ? roster : [];
    return rows.map(e => ({
      profile: String(e.profile || ''),
      handle: String(e.handle || e.profile || ''),
      connection_id: conn.id,
      connection_label: conn.label,
      title: String(e.display_name || ''),
    })).filter(r => r.profile);
  } catch {
    return null;
  }
}

/** roster loop 单步：每连接推"其它连接"的 agents 联合名册。 */
async function syncRelayRosters(): Promise<void> {
  const connections = relayConnections();
  if (connections.length < 2) return;

  const agentsByConnection = new Map<string, RelayAgentRow[]>();
  await Promise.all(
    connections.map(async conn => {
      const agents = await relayAgentsOn(conn);
      if (agents === null) {
        // 瞬时失败：复用该连接的 last-good（没有则本轮贡献空——绝不把
        // 失败读成"这台机器的 agent 都没了"）
        agentsByConnection.set(conn.id, relayAgentsCache.get(conn.id) || []);
      } else {
        if (relayAgentsCache.size >= RELAY_AGENTS_CACHE_MAX) relayAgentsCache.clear();
        relayAgentsCache.set(conn.id, agents);
        agentsByConnection.set(conn.id, agents);
      }
    }),
  );

  // 从注册表消失的连接是真断连——清缓存，重连后从活数据开始
  const liveIds = new Set(connections.map(c => c.id));
  for (const id of [...relayAgentsCache.keys()]) {
    if (!liveIds.has(id)) relayAgentsCache.delete(id);
  }

  await Promise.all(
    connections.map(async conn => {
      const others: RelayAgentRow[] = [];
      for (const [id, agents] of agentsByConnection) {
        if (id !== conn.id) others.push(...agents);
      }
      try {
        await requestForBot(routeOf(conn), 'bot_relay.roster.sync', { agents: others });
      } catch {
        // 旧后端没有 relay RPC——跳过该连接
      }
    }),
  );
}

/** drain loop 单步：收每个网关的 outbox → 目标连接投递 → 回信写回发送方。 */
async function drainRelayOutboxes(): Promise<void> {
  if (drainBusy) {
    // push 信号与在飞 drain 竞态：网关签名单调（每个新信封只广播一次），
    // 不重跑就会等满轮询间隔——记住并排一次跟进
    drainRerun = true;
    return;
  }
  drainBusy = true;
  try {
    const connections = relayConnections();
    if (connections.length < 2) return;
    const byId = new Map(connections.map(c => [c.id, c]));

    for (const sender of connections) {
      let envelopes: RelayEnvelope[] = [];
      try {
        const res = await requestForBot<{ envelopes?: RelayEnvelope[] }>(
          routeOf(sender), 'bot_relay.outbox.drain', {},
        );
        envelopes = Array.isArray(res?.envelopes) ? res.envelopes : [];
      } catch {
        continue;
      }

      for (const envelope of envelopes) {
        const envelopeId = String(envelope?.id || '');
        if (!envelopeId) continue;
        const target = byId.get(String(envelope?.target_connection || ''));

        const postReply = async (payload: { error?: string; reason?: string; reply?: string }) => {
          try {
            await requestForBot(routeOf(sender), 'bot_relay.reply', { id: envelopeId, ...payload });
          } catch {
            // 发送方网关不可达——其 waiter 按 900s 超时与提示收场
          }
        };

        if (!target) {
          await postReply({
            error: `connection '${envelope?.target_connection}' is not connected to this Desktop right now`,
            reason: 'runtime_offline',
          });
          continue;
        }

        try {
          const res = await requestForBot<{ reply?: string }>(
            routeOf(target),
            'bot_relay.deliver',
            { profile: String(envelope?.target_profile || ''), message: String(envelope?.message || '') },
            RELAY_DELIVER_TIMEOUT_MS,
          );
          await postReply({ reply: String(res?.reply || '') });
        } catch (error) {
          // typed reason 编码在后端错误文本 `[reason=xxx]` 后缀里——解析出来
          // 转成结构化 reason（发送 agent 按类分支：auth/rate limit/offline）
          const msg = error instanceof Error ? error.message : String(error);
          const m = /\[reason=([a-z_]+)\]/.exec(msg);
          await postReply({ error: msg, ...(m ? { reason: m[1] } : {}) });
        }
      }
    }

    // 🔴 stage-5 P1-b：authority 的 remote 成员轮投递队列（hosted rooms）
    void drainPeerDispatches();
  } finally {
    drainBusy = false;
    if (drainRerun) {
      drainRerun = false;
      void sleep(RELAY_PUSH_DEBOUNCE_MS).then(() => void drainRelayOutboxes());
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// 🔴 stage-5 P1-b：跨网关群聊成员轮骑行投递（authority-as-dispatcher）
// authority 网关的讨论驱动遇 remote 成员 → 签发 grant 入队 → 本循环拉取
// → 按 UNION roster 找目标连接 → 骑 route 调 bot.rooms.peer.dispatch →
// 轮询目标 status → 回写 bot.rooms.peer_result（authority 驱动收口）。
// Desktop 只持有 socket 中转，grant 由 authority 签好（Desktop 无 secret）。
// ══════════════════════════════════════════════════════════════════

interface PendingDispatch {
  id: string;
  room_id: string;
  room_name: string;
  turn_id: string;
  member_id: string;
  member_profile: string;
  grant_token: string;
  dispatch: Record<string, unknown>;
  prompt: string;
}

interface PeerTurnStatus {
  state: 'running' | 'completed' | 'cancelled';
  reply?: string | null;
}

/** 在飞轮询防重入（dispatchId → true） */
const dispatchPollers = new Map<string, boolean>();
const PEER_POLL_INTERVAL_MS = 5_000;
const PEER_POLL_MAX_TICKS = 180; // 900s 预算（与后端 REPLY_WAIT_SECONDS 对齐）

/** 按 profile 找归属连接（UNION last-good 缓存是拉取结果的镜像） */
function findConnectionForProfile(profile: string) {
  for (const [connId, entries] of unionLastGood) {
    if (entries.some(e => e.profile === profile)) {
      const conn = relayConnections().find(c => c.id === connId);
      if (conn) return conn;
    }
  }
  return undefined;
}

/** 拉各 authority 的 pending 队列（drain 循环每 tick 调用） */
async function drainPeerDispatches(): Promise<void> {
  for (const conn of relayConnections()) {
    let items: PendingDispatch[] = [];
    try {
      const res = await requestForBot<{ dispatches?: PendingDispatch[] }>(
        routeOf(conn), 'bot.rooms.peer_dispatches.pending', {}, 15_000,
      );
      items = Array.isArray(res?.dispatches) ? res.dispatches : [];
    } catch {
      continue; // 旧后端/离线——跳过
    }
    for (const d of items) {
      if (d?.id && d?.grant_token && d?.dispatch) void deliverPeerDispatch(conn, d);
    }
  }
}

// ── 🔴 stage-5 P2.5：replica 维护循环（参与者网关持权威日志副本——
// authority 死亡后可显式接管）──

interface ReplicaTarget {
  authorityId: string;
  roomId: string;
  targetConnId: string;
}

/** peer dispatch 投递成功的房间 → 副本维护三元组 */
const replicaTargets = new Map<string, ReplicaTarget>(); // key: `${authorityId}:${roomId}`

/** 同步各副本：从 authority 拉房间 + 全量日志（讨论线程 ≤10 条发言，全量
 *  幂等最简单），骑行写 target 的 replica（ingest 幂等跳过已有序列）。 */
async function syncReplicas(): Promise<void> {
  const connections = relayConnections();
  for (const t of replicaTargets.values()) {
    const authority = connections.find(c => c.id === t.authorityId);
    const target = connections.find(c => c.id === t.targetConnId);
    if (!authority || !target) continue;
    try {
      const [roomRes, evRes] = await Promise.all([
        requestForBot<{ rooms?: Array<{ room_id: string; name: string; members?: unknown[] }> }>(
          routeOf(authority), 'bot.rooms.list', {}, 15_000,
        ),
        requestForBot<{ events?: unknown[] }>(
          routeOf(authority), 'bot.rooms.events', { room_id: t.roomId, since_seq: 0, limit: 500 }, 15_000,
        ),
      ]);
      const room = roomRes?.rooms?.find(r => r.room_id === t.roomId);
      if (!room) continue; // authority 侧房间已散（disband/接管转移）——副本保留
      await requestForBot(
        routeOf(target),
        'bot.rooms.replica.ingest',
        {
          meta: {
            room_id: t.roomId,
            room_name: room.name,
            members_json: JSON.stringify(room.members ?? []),
            authority_gateway_id: t.authorityId,
            authority_epoch: 1,
          },
          events: evRes?.events ?? [],
        },
        15_000,
      );
    } catch {
      // authority/target 暂不可达——下轮重试
    }
  }
}

/** 单条投递：目标连接 dispatch → 轮询 status → peer_result 回写 */
async function deliverPeerDispatch(authority: { id: string; remote: RemoteConnection | null }, d: PendingDispatch): Promise<void> {
  if (dispatchPollers.has(d.id)) return;
  dispatchPollers.set(d.id, true);
  try {
    const postResult = async (payload: { reply?: string; error?: string }) => {
      try {
        await requestForBot(routeOf(authority), 'bot.rooms.peer_result', { id: d.id, ...payload });
      } catch {
        // authority 暂不可达——轮询照跑，authority 超时兜底
      }
    };

    const target = findConnectionForProfile(d.member_profile);
    if (!target) {
      await postResult({ error: `no connected machine hosts profile '${d.member_profile}'` });
      return;
    }

    try {
      await requestForBot(
        routeOf(target),
        'bot.rooms.peer.dispatch',
        { grant_token: d.grant_token, dispatch: d.dispatch, prompt: d.prompt },
      );
      // 🔴 stage-5 P2.5：本目标网关成为该房间的 replica 持有者——纳入副本
      // 维护循环（authority 日志增量 → target ingest），authority 死后可接管
      replicaTargets.set(`${authority.id}:${d.room_id}`, {
        authorityId: authority.id,
        roomId: d.room_id,
        targetConnId: target.id,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const m = /\[reason=([a-z_]+)\]/.exec(msg);
      await postResult({ error: msg, ...(m ? { reason: m[1] } : {}) });
      return;
    }

    // 轮询目标侧成员轮收口（预算内；cursor 增量）
    let since = 0;
    for (let _tick = 0; _tick < PEER_POLL_MAX_TICKS; _tick++) {
      await sleep(PEER_POLL_INTERVAL_MS);
      try {
        const res = await requestForBot<{ status?: PeerTurnStatus; cursor?: number }>(
          routeOf(target),
          'bot.rooms.peer.status',
          { grant_token: d.grant_token, dispatch: d.dispatch, since_seq: since },
        );
        since = Number(res?.cursor ?? since);
        const st = res?.status;
        if (st?.state === 'completed') {
          await postResult({ reply: String(st.reply || '') });
          return;
        }
        if (st?.state === 'cancelled') {
          await postResult({ error: 'cancelled by authority stop fence' });
          return;
        }
      } catch {
        // 目标暂不可达——预算内继续重试
      }
    }
    await postResult({ error: 'member turn did not finish within budget' });
  } finally {
    dispatchPollers.delete(d.id);
  }
}

const RELAY_PUSH_DEBOUNCE_MS = 250;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── 循环生命周期（模块级：relay 无 UI 消费者；对齐 relay.ts lifecycle record）──
let rosterTimer: ReturnType<typeof setInterval> | null = null;
let drainTimer: ReturnType<typeof setInterval> | null = null;
let drainBusy = false;
let drainRerun = false;

export function startBotRelay(): void {
  if (rosterTimer === null) {
    // 🔴 stage-5 P2.5：副本维护随 roster 循环节奏（60s）——权威日志增量同步
    rosterTimer = setInterval(() => {
      void syncRelayRosters();
      void syncReplicas();
    }, RELAY_ROSTER_INTERVAL_MS);
    void syncRelayRosters();
    void syncReplicas();
  }
  if (drainTimer === null) {
    drainTimer = setInterval(() => void drainRelayOutboxes(), RELAY_DRAIN_INTERVAL_MS);
  }
}

export function stopBotRelay(): void {
  drainRerun = false;
  if (rosterTimer !== null) { clearInterval(rosterTimer); rosterTimer = null; }
  if (drainTimer !== null) { clearInterval(drainTimer); drainTimer = null; }
}

// ══════════════════════════════════════════════════════════════════
// 花名册 UNION（BotsView 消费）：本地 bots.roster + 每个远程连接的
// bots.roster → 行带来源/可达性（对齐 Hermes useRoster 全连接 union，
// mergeMultiSourceRoster + annotateBotSource）。
// ══════════════════════════════════════════════════════════════════

export interface UnionRosterRow {
  entry: BotRosterEntry;
  /** LOCAL_CONNECTION_ID 或远程连接 id */
  connectionId: string;
  /** 连接展示名（远端行标记用） */
  connectionLabel: string;
  isRemote: boolean;
  /** false = 该连接拉取失败 → 行降级 ghost（可读不可点开聊天） */
  reachable: boolean;
}

/** union 拉取的 last-good（远端闪断时行保留 + reachable=false，不消失） */
const unionLastGood = new Map<string, BotRosterEntry[]>();

/** 拉全连接联合花名册。本地失败抛错（主连接都没了 UI 自会报错）；
 *  远端失败行降级 ghost。 */
export async function fetchUnionRoster(): Promise<UnionRosterRow[]> {
  const rows: UnionRosterRow[] = [];

  // 本地（主连接）
  const local = await fetchBotsRoster();
  rows.push(...local.map(entry => ({
    entry, connectionId: LOCAL_CONNECTION_ID, connectionLabel: '本机', isRemote: false, reachable: true,
  })));

  // 远程连接（并发拉取；失败 → last-good + ghost）
  await Promise.all(
    listRemoteConnections().map(async conn => {
      try {
        const roster = await requestForBot<BotRosterEntry[]>(
          { connectionId: conn.id, profile: 'default' }, 'bots.roster', {}, 15_000,
        );
        const entries = Array.isArray(roster) ? roster : [];
        unionLastGood.set(conn.id, entries);
        rows.push(...entries.map(entry => ({
          entry, connectionId: conn.id, connectionLabel: conn.name, isRemote: true, reachable: true,
        })));
      } catch {
        const last = unionLastGood.get(conn.id) || [];
        rows.push(...last.map(entry => ({
          entry, connectionId: conn.id, connectionLabel: conn.name, isRemote: true, reachable: false,
        })));
      }
    }),
  );
  return rows;
}
