/**
 * RoomCard / roomRowReads — 群聊分组的行渲染与派生读数。
 *
 * 🔴 2026-09-17 round-116 P4.5（架构收敛）：从 components/BotsPane.tsx 迁出。
 * 原先是「新面板 import 旧面板」的反向依赖——旧面板（BotsPane）将在 P5 删除，
 * 新面板（bots/RoomListSection）必须拥有自己的渲染实现，故定义落在这里；
 * BotsPane 改为从本文件再导出，旧调用点零改动。
 *
 * 渲染逻辑逐字未改（视觉与旧面板一致）；roomRowReads 仍是房间行/房间头/
 * @提及面板共用的唯一派生实现。
 */
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronUp, EyeOff, HelpCircle, Pin, UsersRound, WifiOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { memberAvailability } from '../../lib/bot-members';
import { formatRowAge } from '../../utils/time';
import type { BotRoom } from '../../utils/api';
import type { UnionRosterRow } from '../../plugins/bots/state';

/** 🔴 round-95 G4+G6：房间行的两个派生读数（对齐 Hermes bot-row.tsx GroupRow）。
 *
 * 纯函数——房间行、未来的房间头部、@提及面板都读同一份答案，不做第二套推导。 */
export function roomRowReads(room: BotRoom, roster: UnionRosterRow[]) {
  // G4 可达性——派生走共享实现（房间头与房间行必须是同一个答案）
  const { known, available } = memberAvailability(room.members, roster);

  // G6 预览：Hermes = `You: …` / `@handle: …`，无消息则回落到成员数。
  // 带作者是刻意的——群聊里没有作者的预览是歧义的（"这段是谁说的？"）。
  const last = room.last_message ?? null;
  const who = last ? (last.actor_kind === 'user' ? '你' : `@${last.actor_handle || '成员'}`) : '';
  const body = last ? last.text.replace(/\s+/g, ' ').trim() : '';
  const preview = last ? `${who}：${body || '…'}` : `${room.members.length} 个成员`;

  return { known, available, preview, lastAt: last ? last.created_at : 0 };
}

/** 🔴 2026-09-05 round-52：群聊小卡片——与 Agent 卡片（ProfilePanel）/项目卡片
 *  （ProjectTreeItems）同构：rounded-lg 卡片底 + 主题色 30% 描边 + 选中发光竖条
 *  /光环投影/扫光（card-selected-sweep）。结构 = 名称行（色块图标 + 房间名 +
 *  成员数徽标）+ 成员 @handle 副行。 */
export function RoomCard({ room, active, needsYou, roster, pinned, hidden, canMoveUp, canMoveDown, onTogglePin, onToggleHide, onMoveUp, onMoveDown, onOpen }: {
  room: BotRoom; active: boolean; needsYou: boolean; roster: UnionRosterRow[];
  pinned: boolean; hidden: boolean;
  /** 🔴 round-111：能否在**同一 pin band 的可见邻居**间移动（对齐 Hermes
   *  `reorderGroupRows` 的 band 判定——band 边缘即禁用，而不是绕到别处）。 */
  canMoveUp: boolean; canMoveDown: boolean;
  onTogglePin: () => void; onToggleHide: () => void;
  onMoveUp: () => void; onMoveDown: () => void;
  onOpen: () => void;
}) {
  const { known, available, preview, lastAt } = roomRowReads(room, roster);
  // 🔴 G4：可达性徽标（对齐 Hermes bot-row.tsx:522-531 的 debug-disconnect
  // 角标 + "N of M available"）——成员失联不提示，用户会把"没人回话"误读成
  // "成员在思考"，一直干等。
  const degraded = known && available < room.members.length;
  const age = lastAt ? formatRowAge(lastAt) : '';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      // 🔴 副行从 @handle 列表换成末条消息预览（对齐 Hermes GroupRow）后，
      // 成员清单不能就此丢失——收进行 tooltip。
      title={room.members.map((m) => `@${m.handle}`).join(' ')}
      className={cn(
        'group/room relative w-full text-left px-2.5 py-2 rounded-lg border bg-card shadow-sm transition-all duration-150 cursor-pointer overflow-hidden space-y-1 hover:bg-accent/30',
        active && 'card-selected-sweep',
        // 已隐藏项在开关打开时出现 → 淡化（对齐 Hermes "reveal hidden bots (dimmed)")
        hidden && 'opacity-55',
      )}
      style={{
        // 描边 = 主题 primary 30% 透明混合（选中/未选中一致；与 Agent/项目卡片同构）
        borderColor: 'color-mix(in srgb, var(--dt-primary) 30%, transparent)',
        boxShadow: active
          ? '0 0 0 1px color-mix(in srgb, var(--dt-primary) 45%, transparent), 0 6px 18px var(--theme-shadow-color-heavy)'
          : undefined,
      } as CSSProperties}
    >
      {/* 选中发光竖条（主题 primary；与 Agent/项目卡片同款） */}
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
          style={{
            background: 'var(--dt-primary)',
            boxShadow: '0 0 8px color-mix(in srgb, var(--dt-primary) 65%, transparent)',
          }}
        />
      )}
      {/* 名称行（对齐 Hermes GroupRow：名称 → needs-you → 年龄） */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center justify-center w-6 h-6 rounded-md shrink-0 overflow-hidden bg-muted/40">
          {/* 🔴 round-97：房间图（对齐 Hermes bot-row.tsx:503-510——有图用图，
              无图用组织字形） */}
          {room.image ? (
            <img src={room.image} alt="" className="size-full object-cover" />
          ) : (
            <UsersRound size={13} strokeWidth={1.5} className={degraded ? 'text-amber-500' : 'text-muted-foreground'} />
          )}
          {degraded && (
            <span
              className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-3 h-3 rounded-full bg-card text-amber-500"
              title={`${available} / ${room.members.length} 个成员可用`}
            >
              <WifiOff size={8} strokeWidth={2.5} />
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">{room.name}</span>
        {/* 🔴 round-94 G1：needs-you 徽标（对齐 Hermes bot-row.tsx:536-540
             Codicon question + tooltip needsYourInput）。房间里有未决的澄清 /
             审批卡 = 讨论卡在等人，不看这个标用户根本不知道要点进来。 */}
        {needsYou && (
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white shrink-0"
            title="需要你处理：有成员正在等待澄清或审批"
            aria-label="需要你处理"
          >
            <HelpCircle size={11} strokeWidth={2.5} />
          </span>
        )}
        {/* G6：相对时间（与同栏会话行同一套拼写，见 utils/time.ts formatRowAge） */}
        {age && (
          <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums" title={new Date(lastAt * 1000).toLocaleString('zh-CN')}>
            {age}
          </span>
        )}
        {/* 🔴 round-104：roster 展示偏好（对齐 Hermes：right-click → Hide Bot / 置顶）。
            用 hover 操作区而非右键菜单：不引入浮层，与本面板其余交互一致。 */}
        {pinned && (
          <Pin size={10} className="shrink-0 text-muted-foreground" aria-label="已置顶" />
        )}
        <div className="hidden group-hover/room:flex items-center gap-0.5 shrink-0">
          {/* 🔴 round-111：手动顺序（对齐 Hermes group-order 的 Move up / Move down）。
              只在**同 pin band 的可见**邻居间交换；band 边缘禁用而非绕行。 */}
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            title="上移（同置顶组内）"
            disabled={!canMoveUp}
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          >
            <ChevronUp size={11} />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            title="下移（同置顶组内）"
            disabled={!canMoveDown}
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          >
            <ChevronDown size={11} />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            title={pinned ? '取消置顶' : '置顶（排在最前）'}
            onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          >
            <Pin size={11} />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            title={hidden ? '取消隐藏' : '隐藏（不移除成员，仍可 @提及）'}
            onClick={(e) => { e.stopPropagation(); onToggleHide(); }}
          >
            <EyeOff size={11} />
          </button>
        </div>
      </div>
      {/* 副行：末条消息预览 + 成员数（对齐 Hermes GroupRow 的 preview 行） */}
      <div className="flex items-center gap-1.5 pl-[26px]">
        <span className="text-xs text-muted-foreground truncate flex-1" title={preview}>{preview}</span>
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] bg-muted text-muted-foreground shrink-0" title={`${room.members.length} 个成员`}>
          {room.members.length} 人
        </span>
      </div>
    </div>
  );
}
