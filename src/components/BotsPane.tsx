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
import { HelpCircle, Loader, Plus, Pencil, UsersRound, WifiOff, X } from 'lucide-react';
import { formatRowAge } from '../utils/time';
import { memberAvailability, memberPickLabel, pickableMembers } from '../lib/bot-members';
import {
  createBotRoom, ensureBotChat, fetchBotRoomReplicas, promoteBotRoomReplica,
} from '../utils/api';
import type { BotRoom } from '../utils/api';
import { requestForBot } from '../services/connections';
import { ingestBotRoster, markBotRead, useBotUnread } from '../hooks/useBotUnread';
import { BotRosterRow } from './BotsView';
import {
  closeRemoteChat, isRoomsLoaded, openRemoteChat, refreshRooms, refreshUnionRoster,
  selectRoom, useRooms, useRoomsLoaded, useRoomsNeedingYou, useSelectedRoomId,
  useUnionRoster,
  type UnionRosterRow,
} from '../plugins/bots/state';
import { onProfilesChanged } from '../lib/global-events';

interface BotsPaneProps {
  onOpenBotChat: (id: string) => void;
  onOpenBotRoom: (roomId: string) => void;
  onEditAgent?: (profile: string) => void;
  /** 🔴 round-78：远端会话视图置位后的主区导航（RemoteBotChatView 只在
   * viewMode==='bots' 主区渲染；缺导航则非 bots 主区下点远端行"没反应"） */
  onRemoteChatOpened?: () => void;
}

interface ReplicaMetaRow {
  room_id: string;
  room_name: string;
  authority_gateway_id: string;
  authority_epoch: number;
  last_ingested_seq: number;
  state: string;
}

/** 🔴 round-95 G4+G6：房间行的两个派生读数（对齐 Hermes bot-row.tsx GroupRow）。
 *
 * 纯函数——房间行、未来的房间头部、@提及面板都读同一份答案，不做第二套推导。 */
function roomRowReads(room: BotRoom, roster: UnionRosterRow[]) {
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
function RoomCard({ room, active, needsYou, roster, onOpen }: {
  room: BotRoom; active: boolean; needsYou: boolean; roster: UnionRosterRow[]; onOpen: () => void;
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
      {/* 名称行（对齐 Hermes GroupRow：名称 → needs-you → 年龄） */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center justify-center w-6 h-6 rounded-md shrink-0 overflow-hidden bg-muted/40">
          <UsersRound size={13} strokeWidth={1.5} className={degraded ? 'text-amber-500' : 'text-muted-foreground'} />
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

export default function BotsPane({ onOpenBotChat, onOpenBotRoom, onEditAgent, onRemoteChatOpened }: BotsPaneProps) {
  // 🔴 round-78：roster = union store（单一权威；此前组件 useState 本地副本
  // 与轮询双轨——store 化对齐 round-75 rooms 同款裁定）
  const bots = useUnionRoster();
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
  // 🔴 round-95：成员选择改走共享派生（含远端 + 不可达禁用 + 跨连接消歧）。
  // 此前创建弹层只列 localBots → 远端 bot 进不了群聊；本地不足 2 个时连
  // 创建入口都被"至少需要 2 个"提示挡死（即使远端连着一堆 bot）。
  const pickRows = useMemo(() => pickableMembers(bots), [bots]);
  const pickableCount = useMemo(() => pickRows.filter(r => !r.disabled).length, [pickRows]);
  const [replicas, setReplicas] = useState<ReplicaMetaRow[]>([]);
  const takeableReplicas = useMemo(() => replicas.filter(r => r.state === 'replica'), [replicas]);

  const loadList = useCallback(async () => {
    try {
      // 🔴 round-78：roster 经 store（refreshUnionRoster in-flight 合并；
      // 拉取者 = useBotUnread 轮询 + 此处手动/挂载刷新，写入口唯一）
      const unionRows = await refreshUnionRoster();
      // 🔴 2026-09-05 round-54：远端行一并 ingest（此前 filter !isRemote →
      // 远端 bot 无未读信号）；键由 canonical_session_id 区分，同名 profile
      // 不冲突。useBotUnread 轮询已挂远端帧，此处保留全量喂给 UI 即时性。
      ingestBotRoster(unionRows.map(r => r.entry));
      // 🔴 round-75：rooms 刷新归 store 的 refreshRooms（与主区/自动选房同源）
      void refreshRooms();
      // 🔴 round-78 P0：replicas 命令收编 api.ts——此前裸 requestForBot(null)
      // 落 bridge 无映射 → 抛 "No WS/HTTP mapping" → 待接管区块死路
      try {
        setReplicas(await fetchBotRoomReplicas());
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
  // 🔴 2026-09-08 round-76 端到端审查：Agent 新建/删除/改名 → 花名册自动重拉
  // （后端 profiles.create/delete/rename 成功后广播 profiles.changed；对齐
  // Hermes roster 随 profiles.* 即时更新——此前 loadList 仅挂载一次，新建
  // Agent 后必须手点刷新才出现在花名册）。
  useEffect(() => onProfilesChanged(() => { void loadList(); }), [loadList]);
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
      .map((p) => pickRows.find((r) => r.profile === p))
      .map((r) => r?.displayName || '')
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
      // 🔴 round-76：profile 与 sid 两个键都清（键会随 canonical 出现而漂移）
      markBotRead(profile, sid);
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
      markBotRead(row.entry.profile, res?.session_id || row.entry.canonical_session_id || undefined);
      if (res?.session_id) {
        // 🔴 2026-09-08 round-76：点远端行 = **打开远端会话**（对齐 Hermes
        // "requestForBot 骑 owner route → session 开在远端网关、行点击即达"）。
        // 此前只 ensure + 弹 notice，用户看不见任何会话。
        openRemoteChat({
          connId: row.connectionId,
          profile: row.entry.profile,
          sessionId: res.session_id,
          label: row.connectionLabel || row.entry.handle,
        });
        // 🔴 round-78 P0：补主区导航（与本地行 onOpenBotChat 的切换语义等价；
        // 此前只置 store 状态，single/grid 主区下点远端行纹丝不动）
        onRemoteChatOpened?.();
      } else {
        setNotice(
          `已在远程连接「${row.connectionLabel}」就绪 @${row.entry.handle} 的 Bot Chat，` +
          `但未返回会话 id（跨网关私信仍可经 relay 管道投递：message_agent 目标用 @${row.entry.handle}@${row.connectionId}）`,
        );
      }
    } catch (e) {
      setError(`远程 Bot Chat 就绪失败：${(e as Error).message}`);
    }
  };

  const openRoom = (room: BotRoom) => {
    // 🔴 2026-09-08 round-76：房间选择与远端会话视图互斥——否则 remoteChat
    // 激活时点群聊行，主区仍被远端视图遮蔽（"点了没反应"）
    closeRemoteChat();
    selectRoom(room.room_id);
    onOpenBotRoom(room.room_id);
  };

  // 🔴 2026-09-05 round-52：群聊卡片选中态（选中房间 = 主区正在显示的房间）
  const selectedRoomId = useSelectedRoomId();
  const roomsNeedingYou = useRoomsNeedingYou();

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
                        const epoch = await promoteBotRoomReplica(r.room_id);
                        setNotice(`房间「${r.room_name}」已在本机接管（epoch ${epoch || '?'}）——讨论可继续`);
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
                  needsYou={roomsNeedingYou.has(room.room_id)}
                  roster={bots}
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
                      .map((p) => pickRows.find((r) => r.profile === p))
                      .map((r) => r?.displayName || '')
                      .filter(Boolean)
                      .join('、')
                      .slice(0, 40) || '群聊名称（可空）'
                  : '群聊名称（可空）'
              }
              className="w-full px-2.5 py-1.5 rounded-md bg-accent/30 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="max-h-44 overflow-y-auto space-y-1">
              {pickableCount < 2 && (
                <div className="text-xs text-muted-foreground px-2 py-1.5">
                  当前可选 Agent 只有 {pickableCount} 个（本机 {localBots.length}
                  {remoteCount > 0 ? ` · 远端 ${remoteCount}` : ''}）——群聊至少需要 2 个。
                  请先新建 Agent，或连接远端机器。
                </div>
              )}
              {pickRows.map((row) => {
                const checked = newMembers.includes(row.profile);
                return (
                  <label
                    key={row.key}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/30',
                      row.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                    )}
                    title={row.disabledReason || (row.isRemote ? `远端 · ${row.connectionLabel}` : undefined)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={row.disabled}
                      onChange={() => setNewMembers((cur) =>
                        checked ? cur.filter((p) => p !== row.profile) : [...cur, row.profile])}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-sm text-foreground truncate">{row.displayName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{memberPickLabel(row)}</span>
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
