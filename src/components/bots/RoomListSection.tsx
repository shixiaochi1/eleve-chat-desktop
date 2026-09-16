/**
 * RoomListSection — Agent 面板「③群聊 + 私聊区」的**群聊分组**。
 *
 * 🔴 2026-09-16 round-116 P3b（Agent 面板整合）：群聊从独立的「群聊」面板
 * 并入 Agent 侧边页（IconBar 群聊按钮取消），房间行单击进房间视图（主区）。
 *
 * 复用而非重写：
 *   - 行渲染 = 旧面板的 `RoomCard` / `roomRowReads`（`components/BotsPane.tsx`
 *     仅加 `export`，**逻辑零改动**）——群聊行视觉与旧面板逐像素一致
 *   - 编排 = `useRoomRows`（`hooks/useAgentPanelData.ts`；判据全在 lib）
 *   - 动作 = `lib/room-row-actions.ts`（置顶/隐藏/上移下移/接管）
 *
 * 语义依据（见审查报告追加 6）：群聊是**跨 Agent 共享房间**（无 owner 字段、
 * `bot.rooms.list` 不按 profile 过滤）⇒ 只能是独立分组，不能挂到某个 Agent 之下。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RotateCw, ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RoomCard } from './RoomCard';
import { useRoomRows, type AgentPanelFilterState } from '../../hooks/useAgentPanelData';
import { reorderRosterRooms } from '../../lib/group-order';
import { moveRoom, openRoom, promoteReplica, setRoomPrefs } from '../../lib/room-row-actions';
import {
  fetchBotRoomReplicas,
  type BotRoom,
} from '../../utils/api';
import {
  refreshRooms,
  useRoomsNeedingYou,
  useRoomsWithPendingClarify,
  useSelectedRoomId,
  useUnionRoster,
} from '../../plugins/bots/state';

type ReplicaMeta = Awaited<ReturnType<typeof fetchBotRoomReplicas>>[number];

export interface RoomListSectionProps {
  /** 与私聊分组共用同一套筛选态（工具栏只有一条） */
  filters: AgentPanelFilterState;
  /** 打开房间视图（主区导航：`host.openView('bots')`） */
  onOpenRoomView: () => void;
  /** 新建群聊（弹层由父组件渲染） */
  onCreateRoom: () => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  /** 折叠态（父组件持有 + 持久化） */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  className?: string;
}

export default function RoomListSection({
  filters,
  onOpenRoomView,
  onCreateRoom,
  onError,
  onNotice,
  collapsed = false,
  onToggleCollapsed,
  className,
}: RoomListSectionProps) {
  const { rows, ordered, visibleIds, loaded, hiddenCount, hasConstraint } = useRoomRows(filters);
  const roster = useUnionRoster();

  const selectedRoomId = useSelectedRoomId();
  const roomsNeedingYou = useRoomsNeedingYou();
  const roomsWithClarify = useRoomsWithPendingClarify();

  // ── 副本接管区（本机持有的他机房间副本；权威失联时可接管） ──
  const [replicas, setReplicas] = useState<ReplicaMeta[]>([]);
  const loadReplicas = useCallback(async () => {
    try {
      setReplicas(await fetchBotRoomReplicas());
    } catch {
      /* best-effort：接管区是可选增强，拉取失败不打扰用户 */
    }
  }, []);
  useEffect(() => {
    // 只在挂载时拉一次；后续由「刷新」按钮显式重拉（此前依赖 rows.length，
    // 任何筛选变化都会打一次 replicas RPC —— 无谓请求）
    void loadReplicas();
  }, [loadReplicas]);
  const takeableReplicas = useMemo(
    () => replicas.filter((r) => r.state === 'replica'),
    [replicas],
  );

  // 空态判定与编排**同一份**判据（`hasConstraint` = 搜索 ∨ 类型/活跃度/连接筛选）
  const emptyText = useMemo(() => {
    if (!loaded) return '加载中…';
    if (hasConstraint) return '没有匹配的群聊';
    return hiddenCount > 0 ? '全部群聊已隐藏' : '还没有群聊';
  }, [loaded, hasConstraint, hiddenCount]);

  return (
    <section className={cn('flex flex-col min-h-0', className)} aria-label="群聊">
      {/* 分组头：折叠开关 + 标题 + 计数 + 新建 */}
      <div className="flex items-center gap-1.5 px-1 mb-1.5 shrink-0">
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-muted-foreground/60 hover:text-foreground transition-colors"
            title={collapsed ? '展开群聊' : '收起群聊'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          群聊
        </span>
        {loaded && rows.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/50">{rows.length}</span>
        )}
        <button
          type="button"
          className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          title="刷新房间列表"
          onClick={() => void refreshRooms().then(loadReplicas)}
        >
          <RotateCw size={11} />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 pl-1 pr-2 h-[20px] rounded-full text-[10px] font-medium transition-all duration-150 active:scale-[0.96] bg-primary/15 text-primary hover:bg-primary/25 shrink-0"
          title="新建群聊"
          onClick={onCreateRoom}
        >
          <Plus size={11} strokeWidth={2.5} className="shrink-0" />
          新建
        </button>
      </div>

      {!collapsed && (
      <div className="flex-1 min-h-0 overflow-y-auto px-1 space-y-1.5">
        {/* 待接管房间（副本权威失联时的入口；无候选时不占位） */}
        {takeableReplicas.length > 0 && (
          <div className="space-y-1 pb-1">
            <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider px-1">
              待接管
            </div>
            {takeableReplicas.map((r) => (
              <div
                key={r.room_id}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-accent/20 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-foreground truncate">{r.room_name}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">
                    原权威「{r.authority_gateway_id}」 · epoch {r.authority_epoch}
                  </span>
                </span>
                <button
                  type="button"
                  className="px-2 py-1 rounded-md bg-primary/20 text-primary text-[11px] shrink-0 hover:bg-primary/30 transition-colors"
                  onClick={() => {
                    void (async () => {
                      try {
                        const epoch = await promoteReplica(r.room_id);
                        onNotice?.(`房间「${r.room_name}」已在本机接管（epoch ${epoch ?? '?'}）——讨论可继续`);
                        await loadReplicas();
                      } catch (e) {
                        onError?.(`接管失败：${(e as Error).message}`);
                      }
                    })();
                  }}
                >
                  接管
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 房间行（行渲染复用旧面板 RoomCard：视觉零变化） */}
        {rows.map((room: BotRoom) => (
          <RoomCard
            key={room.room_id}
            room={room}
            active={selectedRoomId === room.room_id}
            needsYou={
              roomsNeedingYou.has(room.room_id) || roomsWithClarify.has(room.room_id)
            }
            roster={roster}
            pinned={Boolean(room.pinned)}
            hidden={Boolean(room.hidden)}
            // 🔴 band ∩ 可见：能否在"同 pin band 的可见邻居"间移动（对齐 round-111）
            canMoveUp={reorderRosterRooms(ordered, room.room_id, -1, visibleIds) !== null}
            canMoveDown={reorderRosterRooms(ordered, room.room_id, 1, visibleIds) !== null}
            onTogglePin={() => void setRoomPrefs(room, { pinned: !room.pinned }).catch((e) => onError?.(`设置展示偏好失败：${(e as Error).message}`))}
            onToggleHide={() => void setRoomPrefs(room, { hidden: !room.hidden }).catch((e) => onError?.(`设置展示偏好失败：${(e as Error).message}`))}
            onMoveUp={() => void moveRoom(ordered, visibleIds, room, -1).catch((e) => onError?.(`调整房间顺序失败：${(e as Error).message}`))}
            onMoveDown={() => void moveRoom(ordered, visibleIds, room, 1).catch((e) => onError?.(`调整房间顺序失败：${(e as Error).message}`))}
            onOpen={() => {
              // 选中房间 + 关闭远端私聊视图（互斥）→ 主区切房间视图
              openRoom(room.room_id);
              onOpenRoomView();
            }}
          />
        ))}

        {rows.length === 0 && (
          <div className="text-[11px] text-muted-foreground/70 px-2 py-1.5">{emptyText}</div>
        )}
      </div>
      )}
    </section>
  );
}
