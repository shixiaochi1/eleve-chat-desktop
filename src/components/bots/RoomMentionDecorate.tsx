/**
 * RoomMentionDecorate — 房间消息文本的 @提及 accent 内联渲染
 * （2026-10-24，对齐 Hermes `group-mention-text.tsx`）。
 *
 * 形态与约束：
 * - accent 内联引用（**非 pill**）；染色判定 = 路由认不认（词表与后端
 *   `policy.rs::resolve_mentions` 同源：成员 handle/display + everyone/all
 *   + user）；
 * - 纯装饰：存储文本 / 复制 / prompt 零改动（DOM 后处理，markdown 管线不动）；
 * - code span / 链接 / 未知 @word / 邮箱保持原文（walker SKIP 集合）。
 *
 * 为什么挂在气泡外层而不是 markdown 管线里：StreamBlocks 是 innerHTML 管线
 * （无组件覆盖点），且装饰是**房间域**语义——单视图/宫格的普通会话不染色。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { BotRoom } from '../../utils/api';
import { decorateRoomMentions } from '../../lib/room-mention-decorate';

export function RoomMentionDecorate({
  members,
  children,
}: {
  members: BotRoom['members'];
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 无 deps（每次渲染后重扫）：StreamBlocks 落定/流式更新会重建 innerHTML，
  // 装饰必须跟随；decorateRoomMentions 幂等（已装饰 span 在 SKIP 集合内）。
  useEffect(() => {
    if (ref.current) decorateRoomMentions(ref.current, members);
  });
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}

export default RoomMentionDecorate;
