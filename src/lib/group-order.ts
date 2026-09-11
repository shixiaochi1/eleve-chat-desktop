/**
 * 🔴 round-111：房间的手动展示顺序（对齐 Hermes `group-order.ts`，
 * 提交 `9d66e76c5d feat(desktop): let users order Group Chat rooms`）。
 *
 * Hermes 语义（提交信息原文）：
 * - 新字段 `GroupChat.rosterOrder?: number`，注释 *"Local display order,
 *   deliberately excluded from the gateway mirror."*；
 * - `pinned` 是**外层 band**，band 内按 `rosterOrder`（缺省 `Infinity`，
 *   落到队尾）；
 * - **未显式移动过就保持 pin/activity 原序**（legacy 兼容）；
 * - 语义约束：*"No membership or routing writes."*、*"retain hidden room slots"*。
 *
 * ELEVE 的两处形态差异（刻意，非缺失）：
 * 1. Hermes 把 `rosterOrder` 放**前端本地**（不进 gateway mirror）；ELEVE 的
 *    `pinned`/`hidden` 已经在后端 `bot_rooms` 表（round-110 的刻意偏离：与房间
 *    记录同源、清缓存不丢），故 `roster_order` 同层落库走同一个
 *    `bot.rooms.set_prefs`。**同样是"本地展示序"**——`bot.rooms.replica.ingest`
 *    只同步事件日志，展示偏好不参与任何跨网关镜像（与 Hermes 的
 *    "excluded from the gateway mirror" 同效）。
 * 2. Hermes 的花名册是一个 bot + group 混排数组，所以 `sortGroupRosterRows`
 *    只置换**房间 slot**、bot 留在原位；ELEVE 的房间是独立列表，等价物就是
 *    对本列表排序（下面 `sortRosterRooms`）。
 */

import type { BotRoom } from '../utils/api';
import { sortByPinThenActivity } from './roster-filter';

/** 房间行的排序读数（测试可注入；生产用 roomActivityMs）。 */
export type RoomActivityOf = (room: BotRoom) => number;

/** 未显式移动过的房间：排在已排序者之后，且彼此保持原（pin/activity）顺序。 */
const NO_ORDER = Infinity;

/**
 * 房间列表的展示序：**pin 外层 band** → band 内 `roster_order`（缺省 Infinity）
 * → 其余保持传入的顺序。
 *
 * 前置：先按 pin/activity 排出 legacy 序（Hermes 的 `legacy` 基线），再对本数组
 * 做**稳定**排序——稳定是关键：`roster_order` 相同的行（尤其全是 Infinity 的
 * "从未移动过"），必须原样保留活动度顺序，否则一进页面顺序就乱跳。
 */
export function sortRosterRooms(rooms: BotRoom[], activityOf: RoomActivityOf): BotRoom[] {
  const legacy = sortByPinThenActivity(rooms, (r) => Boolean(r.pinned), activityOf);
  // Array.prototype.sort 是稳定排序（ES2019 起为规范要求）
  return legacy.slice().sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      (a.roster_order ?? NO_ORDER) - (b.roster_order ?? NO_ORDER),
  );
}

/**
 * 上/下移一格：只在**同一 pin band** 内与**当前可见**的邻居交换。
 *
 * 返回**全部房间**的新顺序（id 数组）；越界（本 band 边缘）/目标不存在 → `null`
 * （调用方据此禁用按钮）。返回的数组包含隐藏房间的原始槽位——"retain hidden
 * room slots"：过滤只是不显示，不改变它的位置。
 *
 * 对齐 Hermes `reorderGroupRows(rows, name, delta, visible?)`。
 */
export function reorderRosterRooms(
  rooms: BotRoom[],
  roomId: string,
  delta: -1 | 1,
  visible?: readonly string[],
): string[] | null {
  const row = rooms.find((r) => r.room_id === roomId);
  if (!row) return null;

  const band = rooms.filter(
    (c) =>
      Boolean(c.pinned) === Boolean(row.pinned) &&
      (!visible || visible.includes(c.room_id)),
  );
  const index = band.findIndex((c) => c.room_id === roomId);
  const neighbour = index >= 0 ? band[index + delta] : undefined;
  if (!neighbour) return null;

  return rooms.map((c) =>
    c.room_id === roomId ? neighbour.room_id : c.room_id === neighbour.room_id ? roomId : c.room_id,
  );
}

/**
 * 新顺序 → 需要写回的 `roster_order` 值（`index`）。
 *
 * 只返回**确实变化**的行：避免每次拖动都把整张表重写一遍。首次移动会把
 * "从未排过序"的行一起编号（Hermes 同样写全部 rooms 的 rosterOrder）——
 * 这是让顺序从此稳定的必要副作用。
 */
export function rosterOrderWrites(
  rooms: BotRoom[],
  orderedIds: readonly string[],
): Array<{ roomId: string; rosterOrder: number }> {
  const byId = new Map(rooms.map((r) => [r.room_id, r]));
  const writes: Array<{ roomId: string; rosterOrder: number }> = [];
  orderedIds.forEach((id, index) => {
    const room = byId.get(id);
    if (room && room.roster_order !== index) writes.push({ roomId: id, rosterOrder: index });
  });
  return writes;
}
