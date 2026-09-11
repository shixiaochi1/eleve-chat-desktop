/**
 * 群聊**线程分组**的唯一派生入口（对齐 Hermes `group-chat-view.tsx:1064-1069`
 * 的 Slack/Discord 形状）。
 *
 * Hermes 侧语义（`group-chat.ts:1555-1588`）：
 * - `groupThreadOf(entry)` = `entry.thread || 'legacy'`（老日志用哨兵 `'legacy'`）
 * - 主输入框发送**铸造新线程**；线程内回复框**继续**该线程
 * - 按线程分组、按最后活跃排序（最旧在前 → 最新线程贴着输入框）
 * - **最近活跃的线程展开**，更早的折叠成摘要行（除非显式展开）
 *
 * ELEVE 侧的等价物（后端 round-97）：
 * - `message.user.payload.thread` = 线程身份（主输入框 = 本条消息自己的
 *   `event_id`；线程内回复 = 被续接的原线程 id）
 * - `message.member.payload.thread` = 该发言所属线程（由 driver 从任务转发）
 * - `room.activity.payload.thread_id` = 该轮收敛标记的线程身份
 *
 * 三者任一在场即可定组；**都没有**（round-96 之前的日志）→ 回落到
 * "最后一条 message.user 之后的事件都算它的线程"——这与后端 policy 的
 * `thread_end = 下一条用户消息` 边界**同口径**，所以老房间的分组不会错乱。
 */

import type { BotRoomEvent } from '../utils/api';

/** 无线程上下文的房间级事件桶（对齐 Hermes 的 `'legacy'` 哨兵）。 */
export const LEGACY_THREAD = 'legacy';

export interface ThreadSection {
  /** 线程身份；`LEGACY_THREAD` = 首条用户消息之前的房间级事件 */
  thread: string;
  events: BotRoomEvent[];
  /** 该线程最后一条事件的时间（Unix 秒）——排序与摘要行用 */
  lastAt: number;
  /**
   * 该线程的锚（首条 `message.user`）；无线程上下文时 null。
   * 摘要行标题取自它。
   */
  head: BotRoomEvent | null;
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
 * 按线程分组。返回顺序 = 最后活跃时间升序——**最新的线程在最后**（贴着输入框，
 * 对齐 Hermes "so the busiest/newest thread sits at the bottom by the composer"）。
 */
export function groupEventsByThread(events: BotRoomEvent[]): ThreadSection[] {
  const order: string[] = [];
  const byThread = new Map<string, ThreadSection>();
  let current: string | null = null;

  for (const ev of events) {
    const explicit = explicitThread(ev);
    if (ev.kind === 'message.user') {
      // 主输入框：thread 缺省 = 本条消息自己的 event_id（= 开新线程）
      current = explicit ?? ev.event_id;
    } else if (explicit) {
      // 成员发言 / 收敛标记自带线程身份 → 同步游标（跨刷新恢复时游标可能还是空的）
      current = explicit;
    }
    const key = explicit ?? current ?? LEGACY_THREAD;

    let sec = byThread.get(key);
    if (!sec) {
      sec = { thread: key, events: [], lastAt: 0, head: null };
      byThread.set(key, sec);
      order.push(key);
    }
    sec.events.push(ev);
    const at = Number(ev.created_at) || 0;
    if (at >= sec.lastAt) sec.lastAt = at;
    if (!sec.head && ev.kind === 'message.user') sec.head = ev;
  }

  const sections = order.map((k) => byThread.get(k)!);
  // 稳定排序：lastAt 相同（同秒）时保持写入顺序，避免分组在重渲染间跳动
  return sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.lastAt - b.s.lastAt || a.i - b.i)
    .map((x) => x.s);
}

/** 摘要行的标题：首条用户消息文本（截断），无用户消息时给个兜底描述。 */
export function threadSummaryLabel(sec: ThreadSection, limit = 48): string {
  const text = String(sec.head?.payload?.text ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '（房间动态）';
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 摘要行的计数：线程内**成员发言**条数（用户消息不算——Hermes 摘要行给的是回复数）。 */
export function threadReplyCount(sec: ThreadSection): number {
  return sec.events.filter((e) => e.kind === 'message.member').length;
}
