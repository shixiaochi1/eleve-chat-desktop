/**
 * 🔴 2026-09-05 round-42：BotsPane — Bot Mode 左栏面板（布局 1:1 对齐
 * Hermes Desktop hermes-bots 的 BotsPane / roster-pane.tsx）。
 *
 * Hermes 规格（取证 docs）：
 * - Bots 不是主区 tab，而是左侧 sidebar zone 内与 Sessions 并列的 tab
 *   （260px；点击 BOTS tab 后主区不换内容）
 * - BotsPane = 单列窄侧栏：Header（标题 + New 下拉）→ 工具/搜索行 →
 *   列表滚动区（群聊 section → Bot 行）→ 尾部对话框
 * - 点 bot 行 → 主区打开 canonical Bot Chat（openSession in-place）
 * - 点群聊行 → 主区打开房间视图（main tab）
 *
 * ELEVE 形态映射：SidePanel 的 activePanel 互斥切换 = SESSIONS | BOTS
 * tab strip 的等价语义（同一左栏区域，单面板在屏）。
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { Loader, Plus, Pencil, UsersRound, X } from 'lucide-react';
import {
  createBotRoom, ensureBotChat,
} from '../utils/api';
import type { BotRosterEntry, BotRoom } from '../utils/api';
import { fetchUnionRoster, type UnionRosterRow } from '../services/bot-relay';
import { requestForBot } from '../services/connections';
import { ingestBotRoster, markBotRead, useBotUnread } from '../hooks/useBotUnread';
import { BotRosterRow } from './BotsView';
import {
  isRoomsLoaded, refreshRooms, selectRoom, useRooms, useRoomsLoaded,
  useSelectedRoomId,
} from '../plugins/bots/state';

interface BotsPaneProps {
  onOpenBotChat: (id: string) => void;
  onOpenBotRoom: (roomId: string) => void;
  onEditAgent?: (profile: string) => void;
}

interface ReplicaMetaRow {
  room_id: string;
  room_name: string;
  authority_gateway_id: string;
  authority_epoch: number;
  last_ingested_seq: number;
  state: string;
}

/** 🔴 2026-09-05 round-52：群聊小卡片——与 Agent 卡片（ProfilePanel）/项目卡片
 *  （ProjectTreeItems）同构：rounded-lg 卡片底 + 主题色 30% 描边 + 选中发光竖条
 *  /光环投影/扫光（card-selected-sweep）。结构 = 名称行（色块图标 + 房间名 +
 *  成员数徽标）+ 成员 @handle 副行。 */
function RoomCard({ room, active, onOpen }: { room: BotRoom; active: boolean; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className={cn(
        'group relative w-full text-left px-2.5 py-2 rounded-lg border bg-card shadow-sm transition-all duration-150 cursor-pointer overflow-hidden space-y-1 hover:bg-accent/30',
        active && 'card-selected-sweep',
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
      {/* 名称行 */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 overflow-hidden bg-muted/40">
          <UsersRound size={13} strokeWidth={1.5} className="text-muted-foreground" />
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">{room.name}</span>
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] bg-muted text-muted-foreground shrink-0" title={`${room.members.length} 个成员`}>
          {room.members.length} 人
        </span>
      </div>
      {/* 成员副行 */}
      <div className="text-xs text-muted-foreground truncate pl-[26px]">
        {room.members.map((m) => `@${m.handle}`).join(' ')}
      </div>
    </div>
  );
}

export default function BotsPane({ onOpenBotChat, onOpenBotRoom, onEditAgent }: BotsPaneProps) {
  const [bots, setBots] = useState<UnionRosterRow[]>([]);
  // 🔴 2026-09-07 round-75：rooms 改由 plugin store 单一权威提供（useRooms）
  // ——本地副本与 WS 订阅删除（三处 fetch 合并，见 plugins/bots/state.ts）。
  const rooms = useRooms();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{ profile: string; x: number; y: number } | null>(null);
  const localBots = useMemo(() => bots.filter(b => !b.isRemote).map(b => b.entry), [bots]);
  const remoteCount = useMemo(() => bots.filter(b => b.isRemote).length, [bots]);
  const [replicas, setReplicas] = useState<ReplicaMetaRow[]>([]);
  const takeableReplicas = useMemo(() => replicas.filter(r => r.state === 'replica'), [replicas]);

  const loadList = useCallback(async () => {
    try {
      const unionRows = await fetchUnionRoster();
      setBots(unionRows);
      // 🔴 2026-09-05 round-54：远端行一并 ingest（此前 filter !isRemote →
      // 远端 bot 无未读信号）；键由 canonical_session_id 区分，同名 profile
      // 不冲突。useBotUnread 轮询已挂远端帧，此处保留全量喂给 UI 即时性。
      ingestBotRoster(unionRows.map(r => r.entry));
      // 🔴 round-75：rooms 刷新归 store 的 refreshRooms（与主区/自动选房同源）
      void refreshRooms();
      try {
        const res = await requestForBot<{ replicas?: ReplicaMetaRow[] }>(
          null, 'bot.rooms.replicas.list', {}, 15_000,
        );
        setReplicas(Array.isArray(res?.replicas) ? res.replicas : []);
      } catch {
        setReplicas([]);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  // 🔴 round-75：首挂补拉房间列表（store 的 roomsLoaded 门控——loadList 只管
  // roster/replicas；若 store 已拉过则跳过，不重复打 RPC）。
  useEffect(() => {
    if (!isRoomsLoaded()) void refreshRooms();
  }, []);

  // 🔴 round-75：房间元信息的 WS 刷新已收编进 plugin store 的模块级订阅
  // （created/renamed/members_changed/disbanded → 150ms 防抖 refreshRooms），
  // 组件级订阅删除——刷新责任单一化（store 唯一写入口）。

  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [rowMenu]);

  // 🔴 2026-09-07 round-70（对齐 Hermes create-dialog.tsx create() 语义）：
  // ①名字可空——空名兜底选中成员显示名拼接（Hermes placeholder 语义）；
  // ②超长截断 60（= 后端上限；Hermes 同为截断非拒绝）；
  // ③同名 uniquify " 2"/" 3" 后缀——"Creating a group is always a FRESH
  //   room"（Hermes：同名重建静默重开旧房读作"不是新群"）+ 同名卡片在
  //   列表难分辨；taken=活房名（解散房名可复用）；base 先截断再加后缀
  //   （防上限碰撞，对齐 uniqueGroupChatName）；
  // ④创建成功自动进入新房间（对齐 roster-pane onCreated → openGroupChat）；
  // ⑤成功 notice 反馈（对齐 host.notify "created with N bots"）。
  const submitCreate = async () => {
    if (newMembers.length < 2 || newMembers.length > 6) return;
    const fallback = newMembers
      .map((p) => localBots.find((b) => b.profile === p))
      .map((b) => b?.display_name || b?.handle || b?.profile || '')
      .filter(Boolean)
      .join('、');
    const base = (newName.trim() || fallback).trim().slice(0, 60);
    if (!base) return;
    const taken = new Set(rooms.filter((r) => !r.disbanded_at).map((r) => r.name));
    let name = base;
    if (taken.has(name)) {
      for (let n = 2; n < 100; n++) {
        const suffix = ` ${n}`;
        const candidate = base.slice(0, 60 - suffix.length) + suffix;
        if (!taken.has(candidate)) { name = candidate; break; }
      }
    }
    setCreating(true);
    try {
      const room = await createBotRoom(name, newMembers);
      setNewName('');
      setNewMembers([]);
      setShowCreate(false);
      await loadList();
      // 🔴 round-70：自动进入新房间（对齐 Hermes onCreated → openGroupChat）
      if (room?.room_id) {
        selectRoom(room.room_id);
        onOpenBotRoom(room.room_id);
      }
      setNotice(`已创建「${name}」（${newMembers.length} 个 Agent）`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const openBotChat = async (profile: string) => {
    try {
      const sid = await ensureBotChat(profile);
      // 🔴 2026-09-05 round-54：ack 锚定 canonical 会话（未读键公式），
      // profile 仅作无会话回退。
      markBotRead(sid || profile);
      if (sid) onOpenBotChat(sid);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openRemoteBotChat = async (row: UnionRosterRow) => {
    if (!row.reachable) {
      setError(`远程连接「${row.connectionLabel}」当前不可达——无法就绪 @${row.entry.handle} 的 Bot Chat`);
      return;
    }
    try {
      // 🔴 2026-09-05 round-54 P0 修复配套：requestForBot 不再注入
      // params.profile——此处显式传目标 profile，ensure 的才是点中的 bot
      // （此前被 route.profile='default' 覆盖，远端建的是 default 的 Bot Chat）。
      const res = await requestForBot<{ session_id?: string }>(
        { connectionId: row.connectionId, profile: 'default' },
        'bot.chat.ensure',
        { profile: row.entry.profile },
        15_000,
      );
      markBotRead(res?.session_id || row.entry.canonical_session_id || row.entry.profile);
      setNotice(
        `已在远程连接「${row.connectionLabel}」就绪 @${row.entry.handle} 的 Bot Chat。` +
        `Agent 间的跨网关私信已可经 relay 管道投递（message_agent 目标用 @${row.entry.handle}@${row.connectionId}）`,
      );
    } catch (e) {
      setError(`远程 Bot Chat 就绪失败：${(e as Error).message}`);
    }
  };

  const openRoom = (room: BotRoom) => {
    selectRoom(room.room_id);
    onOpenBotRoom(room.room_id);
  };

  // 🔴 2026-09-05 round-52：群聊卡片选中态（选中房间 = 主区正在显示的房间）
  const selectedRoomId = useSelectedRoomId();

  return (
    <div className="relative h-full flex flex-col min-h-0">
      {/* Header（对齐 Hermes roster-pane Header：标题 + New） */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--ui-stroke-tertiary)] shrink-0">
        <span className="text-xs text-muted-foreground">
          {/* 🔴 round-75：rooms 与 roster 双源加载态——roster 好了但房间列表
              还在首拉时不显示误导性的"0 个群聊" */}
          {loading || !isRoomsLoaded()
            ? '加载中…'
            : `${localBots.length} 本地${remoteCount > 0 ? ` · ${remoteCount} 远程` : ''} · ${rooms.length} 个群聊`}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground"
            title="刷新"
            onClick={() => { setLoading(true); loadList(); }}
          >
            <Loader size={14} className={cn(loading && 'animate-spin')} />
          </button>
          {/* 🔴 2026-09-05 round-59：新建群聊按钮 1:1 对齐 Agent 侧栏新建按钮
              （ProfilePanel 胶囊形 primary 渐变 + 发光阴影 + hover 上浮） */}
          <button
            className="inline-flex items-center gap-1.5 pl-1 pr-2.5 h-[22px] rounded-full text-[11px] leading-normal font-semibold transition-all duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.12),0_3px_8px_var(--theme-shadow-color)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.16),0_6px_16px_var(--theme-shadow-color-heavy)] hover:brightness-[1.06] hover:-translate-y-[1.5px] shrink-0"
            title="新建群聊"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={12} strokeWidth={2.5} className="shrink-0" />
            新建群聊
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs shrink-0">
          {error}
        </div>
      )}
      {notice && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-md bg-accent/40 text-muted-foreground text-xs shrink-0">
          {notice}
          <button className="ml-2 underline hover:text-foreground" onClick={() => setNotice(null)}>关闭</button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-4">
        {takeableReplicas.length > 0 && (
          <section>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">待接管房间</div>
            <div className="space-y-1">
              {takeableReplicas.map((r) => (
                <div
                  key={r.room_id}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-accent/20 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground truncate">{r.room_name}</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      原权威「{r.authority_gateway_id}」 · epoch {r.authority_epoch} · 已同步 {r.last_ingested_seq} 条
                    </span>
                  </span>
                  <button
                    className="px-2 py-1 rounded-md bg-primary/20 text-primary text-xs shrink-0 hover:bg-primary/30 transition-colors"
                    onClick={() => void (async () => {
                      try {
                        const res = await requestForBot<{ epoch?: number }>(
                          null, 'bot.rooms.replica.promote', { room_id: r.room_id },
                        );
                        setNotice(`房间「${r.room_name}」已在本机接管（epoch ${res?.epoch ?? '?'}）——讨论可继续`);
                        await loadList();
                      } catch (e) {
                        setError(`接管失败：${(e as Error).message}`);
                      }
                    })()}
                  >
                    接管
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 群聊 section（点卡片 → 主区房间视图）── */}
        {rooms.length > 0 && (
          <section>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">群聊</div>
            <div className="space-y-1.5">
              {rooms.map((room) => (
                <RoomCard
                  key={room.room_id}
                  room={room}
                  active={selectedRoomId === room.room_id}
                  onOpen={() => openRoom(room)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Bot 花名册 UNION（点行 → 主区 Bot Chat；右键编辑 Agent）── */}
        <section>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Agent</div>
          <div className="space-y-1">
            {bots.map((row) => (
              <BotRosterRow
                key={`${row.connectionId}:${row.entry.profile}`}
                row={row}
                onOpen={() => (row.isRemote ? openRemoteBotChat(row) : openBotChat(row.entry.profile))}
                onRowMenu={(x, y) => setRowMenu({ profile: row.entry.profile, x, y })}
              />
            ))}
            {!loading && bots.length === 0 && (
              <div className="text-xs text-muted-foreground px-2 py-1.5">暂无已注册 Agent</div>
            )}
          </div>
        </section>
      </div>

      {/* ── 新建群聊弹层 ── */}
      {showCreate && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div
            className="w-full max-w-xs rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-card-bg)] p-4 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">新建群聊</span>
              <button className="p-1 rounded hover:bg-accent/50" onClick={() => setShowCreate(false)}>
                <X size={14} className="text-muted-foreground" />
              </button>
            </div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={
                // 🔴 round-70：名字可空——placeholder 预览默认名（选中成员拼接，
                // 对齐 Hermes placeholder 语义）
                newMembers.length
                  ? newMembers
                      .map((p) => localBots.find((b) => b.profile === p))
                      .map((b) => b?.display_name || b?.handle || '')
                      .filter(Boolean)
                      .join('、')
                      .slice(0, 40) || '群聊名称（可空）'
                  : '群聊名称（可空）'
              }
              className="w-full px-2.5 py-1.5 rounded-md bg-accent/30 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="max-h-44 overflow-y-auto space-y-1">
              {localBots.length < 2 && (
                <div className="text-xs text-muted-foreground px-2 py-1.5">
                  当前只有 {localBots.length} 个本地 Agent——群聊至少需要 2 个。请先到「Agent」页面新建更多 Agent。
                </div>
              )}
              {localBots.map((bot) => {
                const checked = newMembers.includes(bot.profile);
                return (
                  <label key={bot.profile} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setNewMembers((cur) =>
                        checked ? cur.filter((p) => p !== bot.profile) : [...cur, bot.profile])}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-sm text-foreground">{bot.display_name || bot.handle}</span>
                    <span className="text-xs text-muted-foreground">@{bot.handle}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <span className={cn('text-xs', newMembers.length >= 2 && newMembers.length <= 6 ? 'text-muted-foreground' : 'text-destructive')}>
                已选 {newMembers.length}/2-6
              </span>
              <button
                className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-40"
                disabled={newMembers.length < 2 || newMembers.length > 6 || creating}
                onClick={submitCreate}
              >
                {creating ? <Loader size={14} className="animate-spin" /> : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 花名册行右键菜单 ── */}
      {rowMenu && (
        <div
          className="fixed z-50 min-w-36 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-popover text-popover-foreground py-1 shadow-xl"
          style={{ left: rowMenu.x, top: Math.min(rowMenu.y, window.innerHeight - 90) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 text-left"
            onClick={() => { onEditAgent?.(rowMenu.profile); setRowMenu(null); }}
          >
            <Pencil size={13} className="text-muted-foreground" />
            编辑 Agent
          </button>
        </div>
      )}
    </div>
  );
}
