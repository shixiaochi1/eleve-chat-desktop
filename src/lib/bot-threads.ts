/**
 * 群聊**线程布局**的唯一派生入口。
 *
 * 🔴 round-120：对齐 Hermes 的**真实**语义（`group-chat-view.tsx:1044-1056`）：
 * *"The public room is one arrival-ordered conversation. Thread ids scope replies
 * and prompts, **not visibility**: a newer topic must never hide a member's
 * completed answer or move it ahead of intervening messages."*
 *
 * ⇒ 消息区**按到达顺序**渲染（不按线程分组、不排序、不折叠）；线程 id 只决定两件事：
 * ① 事件归哪个会话（后端 delta / prompt 作用域）；② 线程尾的"回复"入口插在哪
 * （Hermes 的 `threadEnds`：插在该线程**最后一个事件**之后）。
 *
 * ⚠️ 本模块此前实现的是"按线程分组 + 按最后活跃排序 + 最近活跃展开、更早折叠"
 * （Slack 形状），并注释自称对齐 Hermes —— **那是误引**：Hermes 明确拒绝重排与
 * 隐藏（见上）。round-120 起按 Hermes 改正，旧 API（`groupEventsByThread` /
 * `ThreadSection` / 摘要辅助）一并退役。
 *
 * ELEVE 的线程身份契约（后端 round-97）：
 * - `message.user.payload.thread` = 线程身份（主输入框 = 本条消息自己的
 *   `event_id`；线程内回复 = 被续接的原线程 id）
 * - `message.member.payload.thread` = 该发言所属线程（由 driver 从任务转发）
 * - `room.activity.payload.thread_id` = 该轮收敛标记的线程身份
 * - 三者都没有（round-96 之前的日志）→ 回落到"最后一条 `message.user` 之后"的
 *   游标——与后端 policy 的 `thread_end = 下一条用户消息` 边界**同口径**，
 *   所以老房间的归属不会错乱。
 */

import type { BotRoomEvent } from '../utils/api';

/**
 * 无线程上下文的**房间级事件**桶——只出现在首条 `message.user` 之前
 * （`room.created` / `room.renamed` / `room.members_changed` / `authority.*`）。
 *
 * ⚠️ round-121 更正：它与 Hermes 的 `legacy-N` **不等价**，也不是"后端不认"的产物
 * （后端对 thread 零校验、policy 对无 thread 事件一律放行）。真实关系是：
 * - Hermes 的 `assignLegacyThreads`（`group-chat.ts:1583-1605`）给无 thread 条目合成
 *   `legacy-N`，但那是**位置派生** id——同文件 `:315-321` 注释原文警示
 *   "not stable across a gateway round-trip"，并在同步合并时把整个 `legacy-\d+`
 *   家族**折叠回一个桶**；
 * - ELEVE 直接用单一常量承载同一批事件，且**不给它回复入口**（房间级元事件没有
 *   可续的对话）。这是有意选择，不是能力缺失。
 *
 * 老日志里的**用户消息**不受影响：`threadLayout` 用其 `event_id` 作线程锚，
 * 所以 round-96 之前的房间，用户消息仍然各自可回复。
 */
export const LEGACY_THREAD = 'legacy';

export interface ThreadLayout {
  /** 与 `events` **等长同序**：第 i 个事件所属的线程 id */
  threadOf: string[];
  /** 线程 id → 该线程**最后一个事件**的索引（对齐 Hermes `threadEnds`） */
  ends: Map<string, number>;
}

/** 事件显式声明的线程身份（`payload.thread` 优先，`thread_id` 兜底）。 */
function explicitThread(ev: BotRoomEvent): string | null {
  const p = ev.payload as Record<string, unknown> | undefined;
  const t = p?.thread;
  if (typeof t === 'string' && t) return t;
  const tid = p?.thread_id;
  if (typeof tid === 'string' && tid) return tid;
  return null;
}

/**
 * 算出"每个事件的线程归属"与"每线程的收尾位置"——**不改变事件顺序**。
 *
 * `ends` 的写法与 Hermes 完全同构（`room.log.forEach((entry, index) =>
 * threadEnds.set(groupThreadOf(entry), index))`）：顺序扫描，最后写入者即该线程
 * 最后一个事件的索引。
 */
export function threadLayout(events: BotRoomEvent[]): ThreadLayout {
  const threadOf: string[] = [];
  const ends = new Map<string, number>();
  let current: string | null = null;

  events.forEach((ev, i) => {
    const explicit = explicitThread(ev);
    if (ev.kind === 'message.user') {
      // 主输入框发送 = 开新线程（thread 缺省 = 本条消息自己的 event_id）
      current = explicit ?? ev.event_id;
    } else if (explicit) {
      // 成员发言 / 收敛标记自带线程身份 → 同步游标（跨刷新恢复时游标可能还是空的）
      current = explicit;
    }
    const key = explicit ?? current ?? LEGACY_THREAD;
    threadOf.push(key);
    ends.set(key, i);
  });

  return { threadOf, ends };
}
