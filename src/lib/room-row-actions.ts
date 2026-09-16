/**
 * room-row-actions — 群聊分组行的**动作实现**（从旧 `components/BotsPane.tsx` 抽出）。
 *
 * 🔴 2026-09-16 round-116 P3b（Agent 面板整合）：群聊分组（Agent 面板第③段）
 * 需要的房间级动作集中在此，语义与旧实现逐条一致：
 *   - `setRoomPrefs`：置顶 / 隐藏写服务端（`bot.rooms.set_prefs`，落 `bot_rooms` 表）
 *   - `moveRoom`：上/下移（band = 同一 pinned 状态 ∩ 当前可见；写**全部**新下标，
 *     只换两行会让"从未排过序"的行继续 NULL，下次再拖又按活动度漂移）
 *   - `openRoom`：选中房间 + 关闭远端私聊视图（两者互斥，否则"点了没反应"）
 *   - `promoteReplica`：本机接管副本房间（权威晋升）
 *
 * ⚠️ 迁移期：旧 `BotsPane` 内的同名局部函数保持不动（P5 随该文件删除），
 * 两处调用同一批 lib/RPC（`lib/group-order`、`plugins/bots/state`、`utils/api`）。
 */
import { setBotRoomPrefs, promoteBotRoomReplica } from '../utils/api';
import type { BotRoom } from '../utils/api';
import { reorderRosterRooms, rosterOrderWrites } from './group-order';
import { closeRemoteChat, refreshRooms, selectRoom } from '../plugins/bots/state';

/** 改房间展示偏好（置顶 / 隐藏）。服务端才是 source of truth；写后重拉房间列表。 */
export async function setRoomPrefs(
  room: BotRoom,
  patch: { pinned?: boolean; hidden?: boolean },
): Promise<void> {
  await setBotRoomPrefs(room.room_id, patch);
  await refreshRooms();
}

/**
 * 房间上/下移。
 * @param ordered    展示序**全部**房间（含隐藏/被筛掉的——它们保留槽位）
 * @param visibleIds 当前可见房间 id（band 判定的邻居范围）
 * @returns 是否真的发生了移动（band 边缘 / 目标已消失 → false，按钮本应禁用）
 */
export async function moveRoom(
  ordered: BotRoom[],
  visibleIds: string[],
  room: BotRoom,
  delta: -1 | 1,
): Promise<boolean> {
  const next = reorderRosterRooms(ordered, room.room_id, delta, visibleIds);
  if (!next) return false;

  const writes = rosterOrderWrites(ordered, next);
  if (!writes.length) return false;

  for (const w of writes) {
    await setBotRoomPrefs(w.roomId, { roster_order: w.rosterOrder });
  }
  await refreshRooms();
  return true;
}

/** 打开房间：选中 + 关闭远端私聊视图（互斥），主区导航由调用方（`openView('bots')`）负责。 */
export function openRoom(roomId: string): void {
  closeRemoteChat();
  selectRoom(roomId);
}

/** 本机接管副本房间（权威晋升）。返回新 epoch（拿不到为 null）。 */
export async function promoteReplica(roomId: string): Promise<number | null> {
  const epoch = await promoteBotRoomReplica(roomId);
  await refreshRooms();
  return typeof epoch === 'number' ? epoch : null;
}
