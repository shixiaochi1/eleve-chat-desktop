/**
 * 🔴 2026-09-05 round-42：Bots 插件内共享 UI 状态（模块级 store）。
 *
 * 布局 1:1 对齐 Hermes Desktop（roster-pane.tsx / canonical-chat.ts）：
 * Bots 是左栏 pane（SESSIONS | BOTS tab strip），点群聊行 → 主区打开房间
 * 视图。侧栏（BotsPane）与主区（BotsRoomMainView）分属两个贡献组件——
 * "选中哪个群聊"跨组件共享，用插件模块级 store 承载（不进 host 门、
 * 不进 App 状态——插件内聚，对齐 Hermes 插件内自治）。
 */
import { useSyncExternalStore } from 'react';
import { fetchBotRooms, type BotRoom } from '../../utils/api';
import { getWsClient } from '../../services/ws-client';
import { fetchUnionRoster, type UnionRosterRow } from '../../services/bot-relay';
import { isPluginEnabled } from '../../contrib/plugins-store';

// 组件层的行类型经本 store 引用（store 是 union roster 的单一消费入口）
export type { UnionRosterRow };

// 🔴 2026-09-06 round-68：选中房间持久化（localStorage）——点群聊按钮
// 进入群聊界面时自动恢复"上次看的房间"（用户期望：进来即见最近群聊
// 消息，而非空态）；刷新/重启后选中态不丢。解散房残留在主区加载时
// 校验兜底（不在列表 → 回退最新创建房间）。
const SELECTED_ROOM_KEY = 'eleve.bots.selectedRoomId';

function loadInitialSelectedRoom(): string | null {
  try {
    return localStorage.getItem(SELECTED_ROOM_KEY);
  } catch {
    return null;
  }
}

let selectedRoomId: string | null = loadInitialSelectedRoom();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function selectRoom(roomId: string | null): void {
  if (selectedRoomId === roomId) return;
  selectedRoomId = roomId;
  try {
    if (roomId) localStorage.setItem(SELECTED_ROOM_KEY, roomId);
    else localStorage.removeItem(SELECTED_ROOM_KEY);
  } catch {
    /* 存储不可用时选中态退化为内存态（会话内仍一致） */
  }
  emit();
}

export function getSelectedRoomId(): string | null {
  return selectedRoomId;
}

export function useSelectedRoomId(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSelectedRoomId,
    () => null,
  );
}

// ═════════════════════════════════════════════════════════════════════
// 🔴 round-94 G1：「需要你」房间集合（对齐 Hermes `$groupNeedsYou`）。
//
// 🔴 round-111 语义收窄：本集合现在**只承载"成员在回复里 @ 了你"**这一路
// 注意力（Hermes `appendGroupChatEntry` 的 `/@user\b/i` 判定），用户发言即清除
// （group-rounds.ts:977-980）——这符合"用户在房间里回了话 = 回应了那次求助"。
//
// clarify/approval 那一路**不再写这里**，改由 [`useRoomsWithPendingClarify`]
// 派生（见其注释：两个独立来源共写一个可写标志会互相抹掉对方的信号）。
//
// 快照不可变（useSyncExternalStore 用 Object.is 判快照；原地 mutate 同一个
// Set 会被判为"没变"而不重渲染）。
// ═════════════════════════════════════════════════════════════════════

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
let needsYouSnapshot: ReadonlySet<string> = EMPTY_SET;

export function getRoomsNeedingYou(): ReadonlySet<string> {
  return needsYouSnapshot;
}

export function markRoomNeedsYou(roomId: string): void {
  if (!roomId || needsYouSnapshot.has(roomId)) return;
  needsYouSnapshot = new Set(needsYouSnapshot).add(roomId);
  emit();
}

export function clearRoomNeedsYou(roomId: string): void {
  if (!needsYouSnapshot.has(roomId)) return;
  const next = new Set(needsYouSnapshot);
  next.delete(roomId);
  needsYouSnapshot = next;
  emit();
}

export function useRoomsNeedingYou(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getRoomsNeedingYou,
    () => EMPTY_SET,
  );
}

// ═════════════════════════════════════════════════════════════════════
// 🔴 round-111：「有成员卡在澄清/审批」的房间集合——**派生值，不是可写标志**。
//
// 根因（对齐 Hermes `ad08688bc6 fix(bot-mode): derive group clarify/approval
// attention from $groupClarify instead of duplicating it into $groupNeedsYou`）：
// 此前 needs-you 只有一个可写标志集，却被**两个互不感知的来源**写：
//   ① `message.member` 文本含 `@user`（成员在回复里直接求助）；
//   ② 打开房间的 `pendingInteractions` 非空（成员轮 clarify/approval 阻塞）。
// 于是任何一侧的"清位"都会顺手抹掉另一侧**仍然成立**的信号：
//   - 用户发言（本意只回应 ①）会把"成员还在等澄清"一起清掉
//     → 徽标熄灭但房间里卡着一张没人处理的澄清卡；
//   - 回答澄清（清 ②）会把"成员 @ 了你"一起清掉。
// Hermes 的解法同构：`$groupClarify` 才是 clarify/approval 注意力的唯一真值，
// 花名册读 `groupNeedsYou[group] || groupHasPendingClarify(...)`，**不再回写**。
//
// ELEVE 的对应物：本集合由模块级 `bot.room.event` 监听从
// `interaction.request` / `interaction.resolved` 维护——**覆盖所有房间**
// （顺带修掉"只有正在看的那个房间才会亮 clarify 徽标"的覆盖缺口）。
// 渲染处取并集：`mentionNeedsYou.has(id) || pendingClarify.has(id)`。
//
// 键 = 稳定的 `room_id`。Hermes 用房间名做键，所以它额外需要
// `renameGroupClarify` 迁移；ELEVE 改名不改 id，**无此等价物**。
// 快照不可变（useSyncExternalStore 用 Object.is 判快照）。
// ═════════════════════════════════════════════════════════════════════

const EMPTY_ROOM_SET: ReadonlySet<string> = new Set<string>();
let pendingClarifyByRoom: ReadonlyMap<string, ReadonlySet<string>> = new Map();
let pendingClarifyRooms: ReadonlySet<string> = EMPTY_ROOM_SET;
const clarifyListeners = new Set<() => void>();

function emitClarify() {
  for (const fn of clarifyListeners) fn();
}

/** 有未决交互的房间 id 集合（渲染用；与 `roomNeedsYou` 取并集）。 */
export function getRoomsWithPendingClarify(): ReadonlySet<string> {
  return pendingClarifyRooms;
}

/** 某房间的未决 request_id 集（只读；回灌的**替换语义**靠它可测——
 *  "窗口内已 resolved 的条目不得残留"只在 id 粒度上看得出来）。 */
export function getPendingClarifyIds(roomId: string): ReadonlySet<string> {
  return pendingClarifyByRoom.get(roomId) ?? EMPTY_ROOM_SET;
}

/** 登记一条未决交互（`interaction.request` 广播）。 */
export function noteRoomClarify(roomId: string, requestId: string): void {
  if (!roomId || !requestId) return;
  const cur = pendingClarifyByRoom.get(roomId);
  if (cur?.has(requestId)) return;
  const next = new Map(pendingClarifyByRoom);
  next.set(roomId, new Set(cur ?? []).add(requestId));
  pendingClarifyByRoom = next;
  pendingClarifyRooms = new Set(next.keys());
  emitClarify();
}

/** 清除一条未决交互（`interaction.resolved`：answered / expired 都走这里）。 */
export function clearRoomClarify(roomId: string, requestId: string): void {
  const cur = pendingClarifyByRoom.get(roomId);
  if (!cur?.has(requestId)) return;
  const next = new Map(pendingClarifyByRoom);
  const remaining = new Set(cur);
  remaining.delete(requestId);
  if (remaining.size) next.set(roomId, remaining);
  else next.delete(roomId);
  pendingClarifyByRoom = next;
  pendingClarifyRooms = new Set(next.keys());
  emitClarify();
}

/**
 * 🔴 round-111b（自查修复）：用**房间事件日志推导出的未决集**回灌该房间的槽位
 * ——**整体替换**，不是合并。
 *
 * 为什么必须有它：WS 监听只承载"运行期间新到达"的事件，进程重启 / 桌面重连
 * 期间错过的事件**永远不会补**。而房间内的响应卡是打开房间时**从事件日志重建**
 * 的（`BotsView` 的 `pendingInteractions` 派生）——不回灌就会出现"卡在、徽标不亮"
 * 的两处不一致（Hermes `ad08688bc6` 修的正是"徽标与事实不一致"这一类）。
 *
 * 为什么是替换而不是只增：调用方传进来的就是**卡片渲染所用的同一份 events**，
 * 所以替换后"徽标存在性"与"卡片存在性"由构造保证一致（含"日志里已被 resolved
 * 的请求不该再亮"）。只增会让窗口内已 resolved 的条目残留成假徽标。
 *
 * 与 [`noteRoomClarify`] / [`clearRoomClarify`] 的分工：那两个处理**实时**增量，
 * 本函数处理**回灌**（幂等：同集合重复调用不产生新快照）。
 */
export function seedRoomClarify(roomId: string, requestIds: Iterable<string>): void {
  if (!roomId) return;
  const next = new Set([...requestIds].filter(Boolean));
  // 幂等短路（含"房间本就不在表里 + 空集"）：本函数在房间事件流每次变化时都会
  // 被调用（讨论中每个事件一次），无变化时必须不产生新快照——否则 useSyncExternalStore
  // 会按 Object.is 判为变化，左栏每个事件都白重渲染一次。
  const cur = pendingClarifyByRoom.get(roomId) ?? EMPTY_ROOM_SET;
  if (cur.size === next.size && [...next].every((id) => cur.has(id))) return;
  const map = new Map(pendingClarifyByRoom);
  if (next.size) map.set(roomId, next);
  else map.delete(roomId);
  pendingClarifyByRoom = map;
  pendingClarifyRooms = new Set(map.keys());
  emitClarify();
}

/** 房间解散：撤掉它的全部未决交互 —— 对齐 Hermes "retire late work after
 *  disband"。否则房间里那条永远不会再被消费的信号会把徽标永远点亮。 */
export function dropRoomClarify(roomId: string): void {
  if (!pendingClarifyByRoom.has(roomId)) return;
  const next = new Map(pendingClarifyByRoom);
  next.delete(roomId);
  pendingClarifyByRoom = next;
  pendingClarifyRooms = new Set(next.keys());
  emitClarify();
}

export function useRoomsWithPendingClarify(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      clarifyListeners.add(fn);
      return () => clarifyListeners.delete(fn);
    },
    getRoomsWithPendingClarify,
    () => EMPTY_ROOM_SET,
  );
}

// ═════════════════════════════════════════════════════════════════════
// 🔴 2026-09-07 round-75（架构去重落地）：房间列表单一权威 store。
//
// 此前 bot.rooms.list 有三个独立消费点（BotsPane.loadList / 主区元信息
// effect / 自动选房），各持本地副本、各拉各的、WS 订阅过滤条件还不同
// （主区只听选中房间的事件）——侧栏显示新名、主区头部还是旧名的一致性
// 风险 + 请求冗余。
//
// 对齐 Hermes：前端群聊列表的事件驱动失效语义（group-chat.ts "Log +
// watermarks persist via plugin storage"——数据归插件域、事件到达即更新）。
// 形态对齐 session-status.ts 惯例：模块级 store + 模块加载时注册一次 WS
// 订阅 + useSyncExternalStore 消费。
//
// 刷新责任唯一化：①元信息事件（created/renamed/members_changed/disbanded）
// 到达 → 150ms 防抖 → refreshRooms（合并群聊轮转的多事件 burst）；
// ②消费者挂载时 roomsLoaded=false 触发首拉（懒，不在模块加载时打 RPC）。
// 组件（BotsPane/BotsRoomMainView）一律只读 useRooms()，不再自持副本。
// ═════════════════════════════════════════════════════════════════════

let rooms: BotRoom[] = [];
let roomsLoaded = false;
let refreshInFlight: Promise<BotRoom[]> | null = null;
const roomsListeners = new Set<() => void>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function emitRooms() {
  for (const fn of roomsListeners) fn();
}

/** 拉取房间列表并写入 store（唯一写入口；并发调用合并为单次在飞请求）。 */
export function refreshRooms(): Promise<BotRoom[]> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = fetchBotRooms()
    .then((list) => {
      rooms = list;
      roomsLoaded = true;
      emitRooms();
      return list;
    })
    .finally(() => {
      refreshInFlight = null;
      // 🔴 round-75 复审修复：在飞期间的 WS 事件已排入防抖队列（debounceTimer
      // 非 null）——其数据变更不包含在本次响应里，吞掉 = 界面陈旧（改名/解散
      // 丢失直到下一事件）。清队列立即补拉一次（此时 refreshInFlight 已 null，
      // 不会递归重入）。
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
        void refreshRooms().catch(() => undefined);
      }
    });
  return refreshInFlight;
}

/** 防抖触发重拉（WS 元信息事件 burst 合并）。 */
function scheduleRoomsRefresh(): void {
  if (debounceTimer) return; // 已有待执行的重拉
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void refreshRooms().catch(() => undefined);
  }, 150);
}

/** 订阅房间列表变化（组件消费入口）。 */
export function useRooms(): BotRoom[] {
  return useSyncExternalStore(
    (fn) => {
      roomsListeners.add(fn);
      return () => roomsListeners.delete(fn);
    },
    getRooms,
    () => [] as BotRoom[],
  );
}

export function getRooms(): BotRoom[] {
  return rooms;
}

/** 是否已完成过首次拉取（false = 消费者应触发 refreshRooms）。 */
export function isRoomsLoaded(): boolean {
  return roomsLoaded;
}

/** roomsLoaded 的响应式消费（首拉完成 → 组件 loading 解除）。 */
export function useRoomsLoaded(): boolean {
  return useSyncExternalStore(
    (fn) => {
      roomsListeners.add(fn);
      return () => roomsListeners.delete(fn);
    },
    isRoomsLoaded,
    () => false,
  );
}

// ═════════════════════════════════════════════════════════════════════
// 🔴 2026-09-08 round-76：远端 bot 的 canonical 会话视图状态（对齐 Hermes
// "点远端 bot 行 = 打开远端 chat"——requestForBot 骑 owner 连接，本机
// active connection 纹丝不动）。BotsPane.openRemoteBotChat 置位 →
// BotsRoomMainView 顶部拦截渲染 RemoteBotChatView。
// 会话级临时态（不持久化——远端连接断开即失效，重开由用户再点）。
// ═════════════════════════════════════════════════════════════════════

export interface RemoteBotChat {
  /** 远端连接 id（connections.ts RemoteSocket 注册表键） */
  connId: string;
  profile: string;
  sessionId: string;
  /** 展示名（连接标签 / bot handle） */
  label: string;
}

let remoteChat: RemoteBotChat | null = null;
const remoteChatListeners = new Set<() => void>();

function emitRemoteChat() {
  for (const fn of remoteChatListeners) fn();
}

export function openRemoteChat(chat: RemoteBotChat): void {
  remoteChat = chat;
  emitRemoteChat();
}

export function closeRemoteChat(): void {
  remoteChat = null;
  emitRemoteChat();
}

export function useRemoteChat(): RemoteBotChat | null {
  return useSyncExternalStore(
    (fn) => {
      remoteChatListeners.add(fn);
      return () => remoteChatListeners.delete(fn);
    },
    () => remoteChat,
    () => null,
  );
}

// 模块加载时注册一次 WS 元信息事件订阅（生命周期 = 应用，与组件挂载解耦——
// 主区在左栏未开时同样收到刷新；对齐 session-status.ts 的模块级接线惯例）。
// 🔴 round-78：插件禁用即停——禁用 bots 插件后事件不再触发刷新/轮询
// （对齐 Hermes bundled 插件 "disable here if unwanted" 的停机语义；此前
// 禁用后模块级订阅仍消费事件）。
getWsClient().addEventListener((eventName, data) => {
  if (eventName !== 'bot.room.event') return;
  if (!isPluginEnabled('bots')) return;
  const envelope = data as {
    room_id?: string;
    event?: { kind?: string; payload?: Record<string, unknown> };
  };
  const kind = envelope?.event?.kind || '';
  // ═════════════════════════════════════════════════════════════════════
  // 🔴 round-104 D2：needs-you 的**第二置位源**（对齐 Hermes
  // `group-chat.ts:1458-1463` 的 `if (from.kind === 'member' && /@user\b/i.test(
  // entry.text))`）。
  //
  // round-94 只对齐了第一源（`group-turns.ts:496-500`：成员被 clarify/approval
  // 阻塞 → 房间在等人，见下方 BotsView 的 pendingInteractions 派生），漏了这条
  // "成员在回复里**直接 @ 用户**求助"——也是 Hermes 房间行亮徽标的独立入口。
  //
  // 放在模块级监听（而非 BotsView）的原因：未打开的房间同样要能被点亮；且
  // Hermes 的该判定发生在 `appendGroupChatEntry`（房间 append 时刻），与是否
  // 正在观看无关。
  //
  // 清理面：只由**用户发言成功**（BotsView.send/sendInThread）清除——对齐
  // Hermes `sendToGroupChat` 的清位时机。🔴 round-111：此前这里还写着
  // "打开房间（pendingInteractions 派生 effect）"，那条写路径已删除——
  // clarify/approval 注意力改由 `pendingClarifyByRoom` 派生，不再写本标志
  // （两个来源共写一个标志会互相抹掉对方的信号，见上方长注释）。
  // ═════════════════════════════════════════════════════════════════════
  if (kind === 'message.member') {
    const roomId = envelope?.room_id;
    const text = envelope?.event?.payload?.text;
    if (roomId && typeof text === 'string' && /@user\b/i.test(text)) {
      markRoomNeedsYou(roomId);
    }
  }
  // ═════════════════════════════════════════════════════════════════════
  // 🔴 round-111：clarify/approval 注意力的**唯一真值**来源（等价 Hermes
  // `$groupClarify`）。房间事件流本身广播 request/resolved——在这里维护即可
  // 覆盖所有房间，无需依赖"用户正打开着哪个房间"。
  // ═════════════════════════════════════════════════════════════════════
  if (kind === 'interaction.request') {
    const roomId = envelope?.room_id;
    const requestId = envelope?.event?.payload?.request_id;
    if (roomId && typeof requestId === 'string') noteRoomClarify(roomId, requestId);
  } else if (kind === 'interaction.resolved') {
    const roomId = envelope?.room_id;
    const requestId = envelope?.event?.payload?.request_id;
    if (roomId && typeof requestId === 'string') clearRoomClarify(roomId, requestId);
  } else if (kind === 'room.disbanded') {
    // 对齐 Hermes "retire late work after disband"：解散房里残留的未决信号
    // 永远等不到 resolved，必须显式撤掉。
    const roomId = envelope?.room_id;
    if (roomId) dropRoomClarify(roomId);
  }
  if (
    kind === 'room.created' ||
    kind === 'room.renamed' ||
    kind === 'room.members_changed' ||
    kind === 'room.disbanded' ||
    // 🔴 round-78 补齐：room.activity（线程收敛标记）——此前零消费，房间
    // 活跃度/排序依赖的元信息在讨论收敛后不刷新（Hermes 房间元信息随事件失效）
    kind === 'room.activity' ||
    // 🔴 round-78d：authority 接管/退位——房间权威谱系变化需刷新列表
    kind === 'authority.claimed' ||
    kind === 'authority.lost' ||
    // 🔴 round-95 G6：房间行的**末条消息预览 + 时间**由后端 rooms.list 派生，
    // 消息事件不触发重拉 → 左栏房间行会一直停在打开房间那一刻的预览。
    // 150ms 防抖已把一轮讨论的多条消息并成一次重拉。
    kind === 'message.user' ||
    kind === 'message.member' ||
    // 🔴 round-95 G3：hold 集变更 → 房间行摘要里的 holds 需同步
    kind === 'room.holds_changed' ||
    // 🔴 round-97：房间图变更 → 左栏行图标/主区房头需同步（图在 BotRoom 上，
    // 不重拉 rooms.list 就一直是旧图；对齐 Hermes 房间元信息随事件失效）
    kind === 'room.image_changed'
  ) {
    scheduleRoomsRefresh();
  }
});

// ═════════════════════════════════════════════════════════════════════
// 🔴 2026-09-08 round-78：union 花名册单一权威 store（审查建议项收口）。
//
// 此前四路独立拉取（BotsPane.loadList / useBotUnread.pollUnionOnce /
// BotsView 挂载 effect / bot-mentions.loadMentionRoster）各带缓存与失败
// 语义——请求放大（BotsView 只为本地列表也打穿全部远端连接）。
//
// 对齐 Hermes useRoster（≤5s stale）+ mergeMultiSourceRoster：拉取者唯一
// （useBotUnread 轮询，与未读 ingest 同帧），消费者一律读 store；手动刷新
// / 挂载补拉走 refreshUnionRoster（in-flight 合并）。
// ═════════════════════════════════════════════════════════════════════

let unionRoster: UnionRosterRow[] = [];
let unionLoadedAt = 0;
let unionInFlight: Promise<UnionRosterRow[]> | null = null;
const unionListeners = new Set<() => void>();

function emitUnion() {
  for (const fn of unionListeners) fn();
}

/** 拉取 union 花名册并写入 store（唯一写入口；并发合并为单次在飞请求）。 */
export function refreshUnionRoster(): Promise<UnionRosterRow[]> {
  if (unionInFlight) return unionInFlight;
  unionInFlight = fetchUnionRoster()
    .then((rows) => {
      unionRoster = rows;
      unionLoadedAt = Date.now();
      emitUnion();
      return rows;
    })
    .finally(() => {
      unionInFlight = null;
    });
  return unionInFlight;
}

export function getUnionRoster(): UnionRosterRow[] {
  return unionRoster;
}

/** store 是否在 stale 窗口内（bot-mentions 的 ≤5s cache 同步应答判定）。 */
export function isUnionFresh(maxAgeMs: number): boolean {
  return unionLoadedAt > 0 && Date.now() - unionLoadedAt <= maxAgeMs;
}

export function useUnionRoster(): UnionRosterRow[] {
  return useSyncExternalStore(
    (fn) => {
      unionListeners.add(fn);
      return () => unionListeners.delete(fn);
    },
    getUnionRoster,
    () => [] as UnionRosterRow[],
  );
}
