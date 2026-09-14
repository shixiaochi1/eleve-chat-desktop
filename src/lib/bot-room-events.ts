/**
 * 房间**事件集**的两个维护判据的唯一实现：合并（增量去重 + 排序）与保留上限。
 *
 * 🔴 2026-09-15（前端审查 D3，报告 §7-1）：
 *
 * ① `mergeRoomEvents`——此前内联在 `BotsView.tsx` 的 `mergeEvents`：每次增量都
 *    重建 `Set`（O(n)）+ `sort`（O(n log n)）。实时推送的常态是"严格递增地接在
 *    尾部"，这种情况下既不需要去重也不需要排序。快路径把它降回 O(1) 追加，
 *    非单调输入（重连补齐、向上翻历史）才走通用路径。
 *
 * ② `retainLoadedEvents`——ELEVE 的 `events` 是"已载入集"，此前**无上限**：
 *    长时间开着的房间只增不减（每来一条都要再走一遍 `runActivity` / `inflightTurnsOf`
 *    的全量扫描）。Hermes 的 renderer-owned 对应物是**有界本地记录**
 *    （`trimGroupChatLog(log, watermarks, GROUP_CHAT_HISTORY_LIMIT * 4 = 96)`，
 *    `group-chat.ts:1259-1284`，每次 `updateGroupChat` 施加）。这里取同一哲学但更宽松：
 *    只保留最新 [`RETAINED_EVENTS`] 条——**且绝不越过"在飞轮的开轮事件"**
 *    （忙态配对必须看得到 `turn.started`，见 `lib/bot-turn-status.ts` 的 r115f 教训：
 *    配对丢边 = 发送键永久停在停止态 = 界面级死锁）。
 *
 * 调用方的额外约束（见 `BotsView.tsx`）：**用户展开历史 / 正在加载更早页时不得裁**
 * ——否则刚加载进来（并已渲染）的更早事件会被立刻丢掉（F1 那个 bug 的反面）。
 */

import type { BotRoomEvent } from '../utils/api';
import { inflightTurnsOf, turnIdOf } from './bot-turn-status';

/** 本地保留事件条数上限（渲染窗口 [`MESSAGE_WINDOW_PAGE`] 的两倍，留一页余量）。 */
export const RETAINED_EVENTS = 400;

/**
 * 增量并入：按 `seq` 去重 + 升序。无新增时**返回原数组引用**（调用方据此跳过 setState）。
 *
 * 快路径：`incoming` 严格递增且整体在 `current` 之后（实时推送 / 尾部页的常态）
 * ⇒ 直接追加，不建 `Set`、不排序。`incoming` 必须是升序才可走快路径（否则会破坏
 * 有序不变量），故先判单调再判是否在尾部之后。
 */
export function mergeRoomEvents(
  current: BotRoomEvent[],
  incoming: BotRoomEvent[],
): BotRoomEvent[] {
  if (!incoming.length) return current;

  const last = current.length ? current[current.length - 1].seq : 0;
  let ascending = true;
  let allBeyond = true;
  for (let i = 0; i < incoming.length; i++) {
    if (i > 0 && incoming[i].seq <= incoming[i - 1].seq) ascending = false;
    if (incoming[i].seq <= last) allBeyond = false;
  }
  if (ascending && allBeyond) return [...current, ...incoming];

  const seen = new Set(current.map((e) => e.seq));
  const fresh = incoming.filter((e) => !seen.has(e.seq));
  if (!fresh.length) return current;
  return [...current, ...fresh].sort((a, b) => a.seq - b.seq);
}

/**
 * 最早的"仍在飞轮"的开轮事件下标（`-1` = 没有在飞轮）。
 *
 * 用途：保留上限的**下界锚**——裁掉它就会让 `inflightTurnsOf` 少一个开边，
 * 忙态只增不减（r115f 的故障形态）。
 */
export function oldestInflightStartIndex(events: BotRoomEvent[]): number {
  const inflight = inflightTurnsOf(events);
  if (!inflight.size) return -1;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind !== 'turn.started') continue;
    const turnId = turnIdOf(ev.event_id);
    if (turnId && inflight.has(turnId)) return i;
  }
  return -1;
}

/**
 * 最早的**未决交互请求**下标（`interaction.request` 且此后没有同 `request_id` 的
 * `interaction.resolved`）；`-1` = 没有未决请求。
 *
 * 用途：第二枚**裁剪下界锚**。卡片本身从 `pendingInteractions` state 渲染（只增不减），
 * 但"卡片存在 ⇒ 左栏徽标亮"这条一致性是由**按 `events` 派生的回灌**保证的
 * （`BotsView.tsx` 的 `seedRoomClarify` 是**替换**语义，注释点名过这正是
 * Hermes `ad08688bc6` 修的那类双源分歧）。请求若被裁掉，回灌集里就没有它 ⇒
 * "卡还在、徽标灭"。实际可达性极低（成员阻塞在 clarify 时房间基本不再产生事件流），
 * 但锚定它零成本。
 */
export function oldestPendingInteractionIndex(events: BotRoomEvent[]): number {
  const pending = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind !== 'interaction.request' && ev.kind !== 'interaction.resolved') continue;
    const rid = String((ev.payload as Record<string, unknown> | undefined)?.request_id ?? '');
    if (!rid) continue;
    if (ev.kind === 'interaction.request') {
      if (!pending.has(rid)) pending.set(rid, i);
    } else {
      pending.delete(rid);
    }
  }
  if (!pending.size) return -1;
  return Math.min(...pending.values());
}

/**
 * 前向裁剪已载入事件：只保留最新 `keep` 条，但**不越过**任何"下界锚"——
 * 最早的在飞开轮事件（[`oldestInflightStartIndex`]）与最早的未决交互请求
 * （[`oldestPendingInteractionIndex`]）。
 *
 * 返回 `{ events, dropped }`；`dropped === 0` 时 `events` 与原引用相同。
 * 负/非有限 `keep` 视为 0（= 只保住锚点及其之后）。
 */
export function retainLoadedEvents(
  events: BotRoomEvent[],
  keep: number = RETAINED_EVENTS,
): { events: BotRoomEvent[]; dropped: number } {
  const limit = Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : 0;
  const target = events.length - limit;
  if (target <= 0) return { events, dropped: 0 };

  const anchors = [oldestInflightStartIndex(events), oldestPendingInteractionIndex(events)]
    .filter((i) => i >= 0);
  const cut = anchors.length ? Math.min(target, ...anchors) : target;
  if (cut <= 0) return { events, dropped: 0 };
  return { events: events.slice(cut), dropped: cut };
}
