/**
 * 房间级**窗口本地草稿**（对齐 Hermes `group-panes.ts` 的 `groupComposerDrafts`）。
 *
 * Hermes 的定位（实现体注释原文）：
 * *"Group composer drafts are window-local UI state. They must survive pane
 * parking/re-registration and owner switches, but must never enter shared room
 * metadata (where another Desktop would see half-typed text or attachment
 * bytes)."*
 *
 * ⇒ 三条硬约束：
 * 1. **模块级 Map**，不是 React state —— 组件重挂（ELEVE 的
 *    `<BotsRoomView key={room.room_id}>` 每次切房都重挂）不能把草稿带走；
 * 2. **不持久化**（不进 localStorage / 房间元数据）——半截文本不该跨端可见；
 * 3. **按不可变的 room id 分桶** —— ELEVE 的 room_id 是 uuid、重命名不变，
 *    所以**不需要** Hermes 的 `migrateGroupComposerDraft`（那套是给以显示名
 *    为 key 的 legacy 房间做 key 升级的）。
 */

import type { RoomAttachmentDraft } from '../utils/api';

export interface BotRoomDraft {
  /** 主输入框草稿（发送它 = 开新线程） */
  main: string;
  /** 线程内回复框草稿，按 thread id 分桶（对齐 Hermes `replies`） */
  replies: Record<string, string>;
  /** 主输入框待发附件（对齐 Hermes `pendingAttachments`） */
  attachments: RoomAttachmentDraft[];
  /** 用户显式展开的历史线程（最近活跃那个恒展开，不入此集）
   *  —— 对应 Hermes `GroupComposerDraft.activeReplyThread` 的"哪个线程占着
   *  输入区"那一位，ELEVE 允许多个同时展开故用数组。 */
  expandedThreads: string[];
  /** 乐观恢复用的版本号（对齐 Hermes `revision`） */
  revision: number;
}

const drafts = new Map<string, BotRoomDraft>();

function emptyDraft(): BotRoomDraft {
  return { main: '', replies: {}, attachments: [], expandedThreads: [], revision: 0 };
}

/** 深拷贝一份（防止调用方原地改到库里的对象）。 */
function cloneDraft(d: BotRoomDraft): BotRoomDraft {
  return {
    main: d.main,
    replies: { ...(d.replies || {}) },
    attachments: [...(d.attachments || [])],
    expandedThreads: [...(d.expandedThreads || [])],
    revision: d.revision,
  };
}

/** 读某房间的草稿快照（不存在 = 空草稿）。返回**副本**。 */
export function botRoomDraftSnapshot(roomId: string): BotRoomDraft {
  const current = drafts.get(roomId);
  return cloneDraft(current ?? emptyDraft());
}

/** 改某房间草稿的若干字段（**字段级替换**，不是深合并）+ `revision` 自增。
 *
 *  替换而非合并：调用方（房间视图）是这些字段的唯一写者，且每次切房都从
 *  本库重读，所以它手上的就是权威状态；隐藏的合并语义只会制造"这个 patch
 *  到底会不会吃掉另一个线程的草稿"这类疑问。返回新快照。 */
export function patchBotRoomDraft(
  roomId: string,
  patch: Partial<Omit<BotRoomDraft, 'revision'>>,
): BotRoomDraft {
  const current = drafts.get(roomId) ?? emptyDraft();
  const next: BotRoomDraft = {
    main: patch.main ?? current.main,
    replies: { ...(patch.replies ?? current.replies) },
    attachments: [...(patch.attachments ?? current.attachments)],
    expandedThreads: [...(patch.expandedThreads ?? current.expandedThreads)],
    revision: current.revision + 1,
  };
  drafts.set(roomId, next);
  return cloneDraft(next);
}

/** 清掉某房间的草稿（房间解散等显式丢弃场景）。
 *
 *  发送成功后**不走这里**——那是"清空输入区字段"，走 `patch`（对齐 Hermes：
 *  发送清的是 draft 字段，只有房间退役才 `clearGroupComposerDraft`）。 */
export function clearBotRoomDraft(roomId: string): void {
  drafts.delete(roomId);
}

/**
 * 乐观恢复：把 `snapshot` 写回，**但仅当**当前草稿仍是 `expectedRevision`
 * （对齐 Hermes `restoreGroupComposerDraft`）。
 *
 * 用途 = 发送失败把草稿放回去。守卫的意义：清空（发送时）到失败（异步返回）
 * 之间用户可能已经敲了新内容——无守卫的恢复会把它覆盖掉。
 *
 * 返回 `null` = 期间草稿已被改动，**不恢复**。
 */
export function restoreBotRoomDraft(
  roomId: string,
  expectedRevision: number,
  snapshot: BotRoomDraft,
): BotRoomDraft | null {
  const current = drafts.get(roomId) ?? emptyDraft();
  if (current.revision !== expectedRevision) {
    return null;
  }
  const restored: BotRoomDraft = {
    ...cloneDraft(snapshot),
    revision: current.revision + 1,
  };
  drafts.set(roomId, restored);
  return cloneDraft(restored);
}
