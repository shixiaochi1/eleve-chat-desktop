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
  const kind = (data as { event?: { kind?: string } })?.event?.kind || '';
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
    kind === 'authority.lost'
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
