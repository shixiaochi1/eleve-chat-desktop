/**
 * BotsView — Bot Mode 主区视图。
 *
 * 🔴 2026-09-05 round-42 布局 1:1 对齐 Hermes Desktop（推翻 round-12 判定）：
 * Bots 不是主区 tab，而是左栏 sidebar pane（与 Sessions 并列的 tab strip，
 * 260px）——花名册/群聊列表在 components/BotsPane.tsx；本文件只承载
 * 主区房间视图（BotsRoomMainView，点群聊行后进入）与 BotRosterRow。
 *
 * 数据流：命令 → utils/api.ts（bots 命令层）；事件 → ws-client 监听器。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { ArrowLeft, Bot, ChevronDown, ChevronRight, Loader, PauseCircle, Paperclip, Send, Settings2, Square, Trash2, UserPlus, UserMinus, Users, WifiOff, X } from 'lucide-react';
import {
  approveBotRoomTask, changeBotRoomMembers, disbandBotRoom, fetchBotRoomEvents,
  fetchBotRoomPendingTask, renameBotRoom, respondBotRoomInteraction, retryBotRoomTask,
  setBotRoomImage,
  sendBotRoomMessage, stopBotRoom,
  type BotRoom, type BotRoomEvent, type PendingRoomTask, type RoomAttachmentDraft,
} from '../utils/api';
import { formatRowAge } from '../utils/time';
import { findMemberRoster, memberAvailability, memberPickLabel, pickableMembers } from '../lib/bot-members';
// 🔴 round-97：线程分组（唯一派生；见 lib/bot-threads.ts）
import { groupEventsByThread, LEGACY_THREAD, threadReplyCount, threadSummaryLabel } from '../lib/bot-threads';
// 🔴 round-99：轮终态词表（唯一真值；档位对齐 Hermes groupActivityTone）
import { isRoomBoundedActivity, turnStatusOf, turnToneClass, type TurnTone } from '../lib/bot-turn-status';
// 🔴 round-105：bot roster 行的活跃判定（对齐 Hermes ACTIVE_WINDOW_S）
import { isBotActive, isBotWorkerActive } from '../lib/bot-activity';
// 🔴 round-107：房间级草稿（模块级 Map——切房重挂不丢草稿，对齐 Hermes group-panes.ts）
import {
  botRoomDraftSnapshot,
  patchBotRoomDraft,
  restoreBotRoomDraft,
} from '../lib/bot-room-drafts';
// 🔴 round-97：图片工具上提到 lib（房间图/附件缩略图/头像共用一份 canvas 实现）
import { makeImageThumb, readImageFile } from '../lib/image-file';
import { getWsClient } from '../services/ws-client';
import { formatMessageTime } from '../utils/time';
import {
  clearRoomNeedsYou, closeRemoteChat, isUnionFresh, markRoomNeedsYou, refreshRooms,
  refreshUnionRoster, selectRoom, useRemoteChat, useRooms, useRoomsLoaded,
  useSelectedRoomId, useUnionRoster,
  type UnionRosterRow,
} from '../plugins/bots/state';
import RemoteBotChatView from './RemoteBotChatView';
import RoomImageControls from './RoomImageControls';
import MessageRow from './MessageRow';
import ClarifyCard from './ClarifyCard';
import { ingestBotRoster, markBotRead, unreadKey, useBotUnread } from '../hooks/useBotUnread';

interface BotsViewProps {
  /** 🔴 打开 bot 的 canonical chat（宿主层：宫格/Bots 视图先退 + forceProfile） */
  onOpenBotChat?: (id: string) => void;
  /** 🔴 2026-09-04 对齐 Hermes roster 右键 Edit Profile：编辑该 Agent（宿主层 EditAgentDialog） */
  onEditAgent?: (profile: string) => void;
  /** 面板切换（Agent 不足时引导跳转 Agent 页） */
  onPanelChange?: (panel: string | null) => void;
}

/** 🔴 2026-09-05 stage-5：本机持有的房间副本元数据（bot.rooms.replicas.list）。
 *  🔴 2026-09-05 round-48：主区无 replica UI（接管面在 BotsPane 待接管区块）
 *  ——接口与 requestForBot 导入随之移除（此前为未使用死代码）。 */

const KIND_USER = 'message.user';
const KIND_MEMBER = 'message.member';

/**
 * 🔴 2026-09-05 round-42：BotsRoomMainView — 主区群聊房间容器（布局 1:1
 * 对齐 Hermes Desktop：Bots 是左栏 pane [SESSIONS | BOTS tab strip]，
 * 主区只承载点开的群聊房间视图；花名册/群聊列表已迁 components/BotsPane.tsx）。
 *
 * 选中房间 = plugins/bots/state.ts 插件内 store（侧栏 BotsPane 与本组件
 * 跨贡献共享）。未选中/房间已解散 → 引导空态。
 */
export default function BotsRoomMainView() {
  const selectedRoomId = useSelectedRoomId();
  // 🔴 2026-09-07 round-75：房间数据改由 plugin store 单一权威派生——
  // 自持 fetch/本地副本/WS 订阅全部删除（三处 fetch 合并，详见 state.ts）。
  const rooms = useRooms();
  const roomsLoaded = useRoomsLoaded();
  // 🔴 2026-09-06 round-68：用户显式关闭（onBack/解散回列表）→ 空态不被
  // 自动选房劫持；组件重挂（切走再切回群聊视图/重开应用）ref 重置 →
  // 自动选恢复（"进入群聊界面即见最近群聊"语义只对"进入"生效）。
  const userClosedRef = useRef(false);

  // 🔴 round-75：房间对象 = store 派生（单一权威）。改名/改成员/解散由
  // store 的模块级 WS 订阅驱动刷新（组件级订阅删除）。
  const room = useMemo(
    () => rooms.find((r) => r.room_id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  // 🔴 round-78：本地花名册 = union store 派生（此前挂载 effect 直拉
  // fetchUnionRoster——为本地列表打穿全部远端连接 + 第二份本地副本）。
  // 拉取者唯一（useBotUnread 轮询 + 此处 stale 补拉），消费一律读 store。
  const unionRows = useUnionRoster();
  useEffect(() => {
    if (!isUnionFresh(5_000)) void refreshUnionRoster();
  }, []);

  // 🔴 round-75：首拉 + 自动选房 + 解散回退——全部数据驱动（store 变化
  // 触发本 effect 重评估），组件不再自己打 RPC。
  useEffect(() => {
    if (!roomsLoaded) {
      void refreshRooms(); // 首拉：store 更新 → 重渲染回到本 effect
      return;
    }
    if (userClosedRef.current) return; // 显式关闭 → 尊重空态
    const live = rooms.filter((r) => !r.disbanded_at);
    if (selectedRoomId) {
      // round-69：持久化选中 id 已失效（解散）→ 回退最新创建房间；
      // 回退后 selectRoom 触发重评估，新 id 必在列表 → 收敛无循环。
      if (!live.some((r) => r.room_id === selectedRoomId) && live.length) {
        selectRoom(live[live.length - 1].room_id);
      }
      return;
    }
    // round-68：未选中 → 自动选最近创建房间（无房间才空态）。
    if (live.length) selectRoom(live[live.length - 1].room_id);
  }, [roomsLoaded, rooms, selectedRoomId]);

  // 🔴 事件流刷新：房间事件由 WS 推送增量（BotsRoomView 内部订阅），但
  // 选中切换时需要重置内部状态——BotsRoomView 以 room 对象为 key 重挂。
  // 🔴 round-68：显式关闭打标（自动选房不劫持用户返回空态的意图）。
  const handleClose = useCallback(() => {
    userClosedRef.current = true;
    selectRoom(null);
  }, []);

  // 🔴 2026-09-08 round-76：远端 bot 的 canonical 会话视图（对齐 Hermes
  // "点远端 bot 行 = 打开远端 chat"）——BotsPane.openRemoteBotChat 置位。
  // 此分支在全部 hooks 之后、任何条件 return 之前（hooks 顺序恒定）。
  const remoteChat = useRemoteChat();
  if (remoteChat) {
    return <RemoteBotChatView chat={remoteChat} onBack={closeRemoteChat} />;
  }

  // 🔴 round-75：加载态 = store 首拉未完成（roomsLoaded 响应式）。
  if (!roomsLoaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
        <Loader size={22} className="animate-spin opacity-60" />
        <div className="text-sm">加载群聊…</div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 px-6 text-center">
        <Bot size={28} className="opacity-40" />
        <div className="text-sm">从左侧「群聊」面板选择群聊进入房间，或点击 Agent 打开 Bot Chat 私聊</div>
        <div className="text-xs text-muted-foreground/70 max-w-sm">
          群聊里输入 @ 可唤起成员列表；Agent 之间的私信在各自 Bot Chat 里收发（message_agent 工具）。
        </div>
      </div>
    );
  }

  return (
    <BotsRoomView
      key={room.room_id}
      room={room}
      roster={unionRows}
      onBack={handleClose}
    />
  );
}

// ── 花名册单行（提取组件：未读点需 useBotUnread 订阅，hook 不能进 map） ──
// 未读点视觉语义对齐 SessionStatusDot 的 unread 变体（bg-success 稳态点）；
// 活动权威 = canonical Bot Chat（行点击打开的就是它，点与会话永不描述两回事）。
// 🔴 stage-3 UNION 行：远端行带连接标记（🏷 connectionLabel），拉取失败行
// 降级 ghost（opacity + 不可达提示），不消失（对齐 Hermes annotateBotSource）。
export function BotRosterRow({ row, onOpen, onRowMenu, dimmed }: {
  row: UnionRosterRow;
  onOpen: () => void;
  onRowMenu: (x: number, y: number) => void;
  /** 🔴 round-109：已隐藏但在"显示已隐藏"下露出的行 —— 淡化而非消失
   *  （对齐 Hermes "reveal hidden bots (dimmed)"，与 RoomCard 同款 opacity-55）。 */
  dimmed?: boolean;
}) {
  const bot = row.entry;
  // 🔴 2026-09-05 round-54：未读键 = canonical_session_id ?? profile（与
  // useBotUnread.ingest 同一公式）——union 远端行的同名 profile 不再与本地
  // 行共用水位线；preview identity = click identity（锚定的就是行点击打开的会话）。
  const unread = useBotUnread(unreadKey(bot));
  // 🔴 round-105：活跃指示——`BotRosterEntry.last_active` 此前**零消费**
  // （字段已由后端透传）。
  // 🔴 round-106：补上 Hermes 的**第二路**输入 `workerActive`——worker 会话
  // 不进会话列表，缺了这一路时跑 kanban 任务的 bot 会被显示成空闲（#90268）。
  const workerActive = isBotWorkerActive(bot.worker_session);
  const botActive = isBotActive(bot.last_active) || workerActive;
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left',
        !row.reachable && 'opacity-40',
        dimmed && 'opacity-55',
      )}
      title={
        !row.reachable
          ? `远程连接「${row.connectionLabel}」不可达`
          : row.isRemote
            ? `远程 Agent（${row.connectionLabel}）——点击就绪其 Bot Chat`
            : `打开与 @${bot.handle} 的私聊`
      }
      onClick={onOpen}
      onContextMenu={(e) => { e.preventDefault(); onRowMenu(e.clientX, e.clientY); }}
    >
      <span className="relative shrink-0">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
          style={{ background: bot.color || 'var(--accent)' }}
        >
          {(bot.display_name || bot.handle).slice(0, 1).toUpperCase()}
        </span>
        {/* 🔴 round-105：活跃指示（对齐 Hermes bot-row 的状态点：
            贴在头像上。Hermes 的 `mood` 走 `BotFace（头像）的 work|idle`）。
            用与本面板同款的圆点（未读点也是 `bg-success`）+ 脉冲。
            🔴 round-106：worker 心跳同亮（Hermes `botMood` 的 `workerActive`
            一路）——此时语义是「正在干活」而非「刚刚聊过」。 */}
        {botActive && (
          <span
            className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-success ring-2 ring-card animate-pulse"
            title={workerActive ? '正在执行任务' : '刚刚有活动'}
            aria-label={workerActive ? '正在执行任务' : '活跃'}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground truncate">{bot.display_name || bot.handle}</span>
        <span className="block text-xs text-muted-foreground truncate">
          @{bot.handle}
          {row.isRemote && (
            <span className={cn('ml-1.5 rounded px-1 py-px text-[10px]', row.reachable ? 'bg-accent/60 text-foreground' : 'bg-destructive/20 text-destructive')}>
              {row.connectionLabel}
            </span>
          )}
          {/* 🔴 round-78d：角色描述副行（对齐 Hermes roster role 行——后端
              round-54 已透传 description，此前前端类型未接、无处落地） */}
          {bot.description ? ` · ${bot.description}` : ''}
        </span>
      </span>
      {unread && (
        <span
          className="inline-block size-2 rounded-full bg-success shrink-0"
          role="status"
          title="有新的私聊消息"
          aria-label="有新的私聊消息"
        />
      )}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════
// 房间视图 — 事件流 + 发言 + 停止/解散
// ══════════════════════════════════════════════════════════════════

function BotsRoomView({ room, roster, onBack }: {
  room: BotRoom;
  /** union 花名册（**含远端**）——成员选择/可达性/归属显示的唯一真值。
   *  🔴 round-95：此前只传本地 `BotRosterEntry[]`，远端 bot 既进不了成员
   *  选择器，也无法在房间头判定可达性。 */
  roster: UnionRosterRow[];
  onBack: () => void;
}) {
  const [events, setEvents] = useState<BotRoomEvent[]>([]);
  // 🔴 round-107：草稿初值从模块级库来（切房回来草稿还在）。
  // 本组件以 key={room.room_id} 重挂 ⇒ initializer 每次切房都重跑。
  const [draft, setDraft] = useState(() => botRoomDraftSnapshot(room.room_id).main);
  // 🔴 round-97：线程草稿（按线程 id 分桶——对齐 Hermes replyDrafts[thread]）
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>(
    () => botRoomDraftSnapshot(room.room_id).replies,
  );
  // 被用户显式展开的历史线程（最近活跃的那个恒展开，不在此集合里）
  // 🔴 round-107：展开集也按房分桶。
  // round-97 曾在此处用 useEffect 清空草稿/展开集——那正是"切房丢草稿"的根源
  // （每次切房都把刚恢复的草稿又抹掉），现由"按 room_id 分桶"彻底取代。
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(
    () => new Set(botRoomDraftSnapshot(room.room_id).expandedThreads),
  );
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState(room.name);
  // 🔴 round-97：房间图（编辑中态，随 Save 一起提交——对齐 Hermes
  // group-chat-view.tsx:389 setGroupChatImage(finalName, image)）
  const [editImage, setEditImage] = useState<string | null>(room.image ?? null);
  const [editError, setEditError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestSeq = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  // 🔴 2026-09-08 round-76：向上分页状态（tail 首屏之后是否还有更早历史）
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const oldestSeq = useRef<number | null>(null);

  const memberByHandle = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of room.members) map[m.handle] = m.display_name || m.handle;
    return map;
  }, [room.members]);

  // 🔴 round-78d：成员轮交互镜像（对齐 Hermes GroupClarifyCard）——从事件流
  // 推导未决交互（request 未 resolved 的最新一条），渲染房间内响应卡
  const [pendingInteractions, setPendingInteractions] = useState<Map<string, {
    memberId: string; kind: string; question: string; choices: string[]; multiSelect: boolean;
    command: string; description: string; allowSession: boolean; allowPermanent: boolean;
    sessionId?: string;
    // 🔴 round-94：裁决坐标（随 interaction.request 下发，approve 原样回传，
    // 后端 task_id + execution_generation + request_id 三者全等才受理）
    roomId: string; taskId: string; executionGeneration: number;
  }>>(new Map());
  // 🔴 round-78e：已响应集合（防双击 + 防 effect 重扫把乐观清掉的卡加回——
  // resolved 事件到达后彻底退役；expired 同理由轮收口事件驱动）
  const [respondedInteractions, setRespondedInteractions] = useState<Set<string>>(new Set());
  useEffect(() => {
    // 🔴 round-78e：updater 必须纯函数——先纯收集 additions/resolutions，
    // 再分离提交两个 setState（此前在 updater 内嵌套 setRespondedInteractions，
    // React 严格模式双重执行会误清响应集）
    const additions: Array<[string, {
      memberId: string; kind: string; question: string; choices: string[]; multiSelect: boolean;
      command: string; description: string; allowSession: boolean; allowPermanent: boolean;
      sessionId?: string;
      // 🔴 round-94：裁决坐标（随 interaction.request 下发，approve 原样回传，
      // 后端 task_id + execution_generation + request_id 三者全等才受理）
      roomId: string; taskId: string; executionGeneration: number;
    }]> = [];
    const resolutions: string[] = [];
    for (const ev of events) {
      if (ev.kind === 'interaction.request') {
        const rid = String(ev.payload.request_id || '');
        if (!rid || pendingInteractions.has(rid) || respondedInteractions.has(rid)) continue;
        additions.push([rid, {
          memberId: String(ev.payload.member_id || ''),
          kind: String(ev.payload.kind || 'clarify'),
          question: String(ev.payload.question ?? ''),
          choices: Array.isArray(ev.payload.choices) ? (ev.payload.choices as string[]) : [],
          multiSelect: ev.payload.multi_select === true,
          command: String(ev.payload.command ?? ''),
          description: String(ev.payload.description ?? ''),
          allowSession: ev.payload.allow_session !== false,
          allowPermanent: ev.payload.allow_permanent === true,
          sessionId: ev.payload.session_id ? String(ev.payload.session_id) : undefined,
          roomId: String(ev.payload.room_id || room.room_id),
          taskId: String(ev.payload.task_id || ''),
          executionGeneration: Number(ev.payload.execution_generation ?? 0),
        }]);
      } else if (ev.kind === 'interaction.resolved') {
        const rid = String(ev.payload.request_id || '');
        if (rid) resolutions.push(rid);
      }
    }
    if (resolutions.length) {
      const resolvedSet = new Set(resolutions);
      setRespondedInteractions((s) => {
        const ns = new Set(s);
        for (const rid of resolvedSet) ns.delete(rid);
        return ns;
      });
      setPendingInteractions((cur) => {
        const next = new Map(cur);
        for (const rid of resolvedSet) next.delete(rid);
        return next;
      });
      return;
    }
    if (additions.length) {
      setPendingInteractions((cur) => {
        const next = new Map(cur);
        for (const [rid, item] of additions) {
          if (!next.has(rid) && !respondedInteractions.has(rid)) next.set(rid, item);
        }
        return next;
      });
    }
  }, [events, respondedInteractions, pendingInteractions]);

  // 🔴 阶段2 统一：卡片退役清卡（responded 集合 + pending 槽移除）——
  // ClarifyCard onDone/onExpired 与 approval fallback 共用
  const settleInteraction = useCallback((requestId: string) => {
    setRespondedInteractions((s) => new Set(s).add(requestId));
    setPendingInteractions((cur) => {
      const next = new Map(cur);
      next.delete(requestId);
      return next;
    });
  }, []);

  // 🔴 round-92：回应是成员轮解锁的**唯一通道**。此前"先清卡再发 RPC"把失败
  // 变成静默断点——卡片消失、responded 集合已记账，用户以为回答过了，成员轮
  // 却永远等不到回执（房间卡在这一轮，直到轮预算耗尽）。且 `ok:false`（后端
  // 拒绝/请求已过期）也未曾校验，只判了"有没有抛异常"。
  // 对齐语义：**确认成功才退役卡片**；失败原样保留 + 错误可见 → 可重试。
  const answerInteraction = useCallback(async (requestId: string, answer: string) => {
    try {
      const ok = await respondBotRoomInteraction(requestId, answer);
      if (!ok) {
        setError('回应未被后端接受（请求可能已过期），请重试');
        return; // 卡片保留：等 approval/clarify 事件或用户再次提交
      }
      settleInteraction(requestId);
    } catch (e) {
      setError(`回应失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [settleInteraction]);

  // 🔴 round-94 G1：needs-you 徽标——本房间有未决交互卡（澄清/审批在等用户
  // 响应）时给左栏房间行打标，卡清掉即撤（对齐 Hermes `$groupNeedsYou`：
  // 成员被 clarify/approval 阻塞 = 房间在等人）。
  useEffect(() => {
    if (pendingInteractions.size > 0) markRoomNeedsYou(room.room_id);
    else clearRoomNeedsYou(room.room_id);
  }, [pendingInteractions, room.room_id]);

  // 增量合并：去重（seq 单调）
  const mergeEvents = useCallback((incoming: BotRoomEvent[]) => {
    if (!incoming.length) return;
    setEvents((cur) => {
      const seen = new Set(cur.map((e) => e.seq));
      const fresh = incoming.filter((e) => !seen.has(e.seq));
      if (!fresh.length) return cur;
      return [...cur, ...fresh].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  const refresh = useCallback(async () => {
    const PAGE = 200;
    try {
      if (latestSeq.current === 0) {
        // 🔴 2026-09-08 round-76：首屏走 **tail**（后端倒序窗口）——一次 RPC
        // 拿到**最新**一页。聊天视图的语义是"看最新"，而 forward 接口只能从
        // 最旧往前搬：长房间要么逐页补齐（几十次串行请求），要么把游标推到
        // 全局 MAX 造成中间段永久不可达。
        const { events: page, latest_seq, has_more } = await fetchBotRoomEvents(
          roomRef.current.room_id,
          { beforeSeq: 0, limit: PAGE },
        );
        if (page.length) {
          mergeEvents(page);
          oldestSeq.current = page[0].seq;
        }
        // tail 页本身即最新一页 → 游标直接对齐全局 latest，**无缺口**
        latestSeq.current = Math.max(latestSeq.current, latest_seq);
        setHasOlder(has_more);
        return;
      }
      // 增量：只拉游标之后的新事件，逐页追平（正常情况下 0~几条，一次即止）
      for (let page = 0; page < 20; page++) {
        const before = latestSeq.current;
        const { events: fresh } = await fetchBotRoomEvents(roomRef.current.room_id, {
          sinceSeq: before,
          limit: PAGE,
        });
        const maxSeq = fresh.reduce((m, e) => Math.max(m, e.seq), before);
        latestSeq.current = maxSeq;
        if (fresh.length) mergeEvents(fresh);
        // 本页未满 = 已追平；游标未前进 = 防死循环
        if (fresh.length < PAGE || maxSeq <= before) break;
      }
    } catch { /* 静默（下一次推送/轮询兜底） */ }
  }, [mergeEvents]);

  /** 向上翻历史：以"当前最早 seq"为 before_seq 再取一页更早的 */
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !oldestSeq.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const { events: page, has_more } = await fetchBotRoomEvents(roomRef.current.room_id, {
        beforeSeq: oldestSeq.current,
        limit: 200,
      });
      if (page.length) {
        mergeEvents(page); // mergeEvents 按 seq 去重 + 排序，prepend 结果一致
        oldestSeq.current = page[0].seq;
      }
      setHasOlder(has_more && page.length > 0);
    } catch { /* 静默（下次点击重试） */ } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [mergeEvents]);

  // 初次全量 + 实时推送订阅 + 慢轮询兜底
  useEffect(() => {
    latestSeq.current = 0;
    // 换房间 = 分页状态整体复位（否则上一房间的最早游标/还有更早标志会串味）
    oldestSeq.current = null;
    setHasOlder(false);
    setEvents([]);
    refresh();

    const ws = getWsClient();
    const unsubscribe = ws.addEventListener((eventName, data) => {
      if (eventName !== 'bot.room.event') return;
      const payload = data as { room_id?: string; event?: BotRoomEvent };
      if (payload?.room_id !== roomRef.current.room_id || !payload.event) return;
      const ev = payload.event;
      // 🔴 2026-09-08 round-76：WS 推送**不推进游标**。推送到的永远是最新事件，
      // 若在分页补齐途中把游标顶到该 seq，中间段就被永久跳过——与"首屏把游标
      // 推到全局 MAX"是同一个病根。游标只由 refresh 的分页补齐单调推进，
      // 重复拉取由 mergeEvents 按 seq 去重（幂等）。
      mergeEvents([ev]);
    });
    // 🔴 轮询治理（frontend-chat-unification-2026-09-09）：15s 固定轮询退役
    // ——事件丢失的唯一现实窗口是 **WS 断线期间**（连接中投递由后端 ws_clients
    // 保证），治理对齐 session-status.ts/useBotUnread 先例：重连恢复对账一次
    // （断线窗口内的事件经 refresh 增量游标补齐——mergeEvents 幂等去重）。
    // 连接稳定时零轮询（15s interval 对长会话是纯 IO 放大）；首次 connect 的
    // onStateChange 与 effect 开头 refresh 重叠无害（幂等）。
    const unsubState = ws.onStateChange((s) => {
      if (s === 'connected') void refresh();
    });
    return () => { unsubscribe(); unsubState(); };
  }, [room.room_id, refresh, mergeEvents]);

  // 自动滚底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length]);

  // 🔴 2026-09-05 round-50：附件（对齐 Hermes group-attachments.ts——
  // picked/pasted/dropped → dataURL，图片另生成降采样 thumb；15MB/4 个上限）
  const [attachments, setAttachments] = useState<RoomAttachmentDraft[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    const picked: RoomAttachmentDraft[] = [];
    for (const f of Array.from(files)) {
      if (picked.length + attachments.length >= 4) {
        setError('最多 4 个附件');
        break;
      }
      if (f.size > 15_000_000) {
        setError(`${f.name || '附件'}：超过 15MB 上限`);
        continue;
      }
      const data = await readImageFile(f);
      if (!data) continue;
      // 🔴 2026-09-05 round-60：kind 判定兜底——Windows 部分拖拽/粘贴场景
      // file.type 为空，此前图片会误判为 "file"（降级为名字引用，成员看不到图）
      const looksImage = /^image\//.test(f.type || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name || '');
      const kind: RoomAttachmentDraft['kind'] = looksImage
        ? 'image'
        : (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) ? 'pdf' : 'file';
      let thumb: string | undefined;
      if (kind === 'image') thumb = await makeImageThumb(data);
      picked.push({ name: f.name || 'file', kind, thumb, data });
    }
    if (picked.length) {
      setAttachments((cur) => {
        const next = [...cur, ...picked].slice(0, 4);
        patchBotRoomDraft(room.room_id, { attachments: next });
        return next;
      });
    }
  }, [attachments.length]);

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || sending) return;
    // 🔴 2026-09-08 round-76：讨论进行中不得插入新发言（此前 Enter 直调 send，
    // 可以绕过已切成停止态的发送键，消息被塞进在飞讨论）。必须给出可见反馈——
    // 静默 return 就是用户报的"按回车没反应"。
    if (roomBusy) {
      setError('成员正在讨论中——请等本轮结束，或点停止后再发言。');
      return;
    }
    setSending(true);
    const snapshotAtts = attachments;
    // 🔴 round-76：幂等键（后端 event_id = "user:sha256(room:client_event_id)"）。
    // 此前恒传 undefined → 后端用随机 UUID 兜底，重发/重试必然产生重复用户消息
    // （= 重复开一轮讨论）。同一次发送固定一个 id。
    const clientEventId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const beforeDraft = botRoomDraftSnapshot(room.room_id);
    const cleared = patchBotRoomDraft(room.room_id, { main: '', attachments: [] });
    setDraft('');
    setAttachments([]);
    try {
      await sendBotRoomMessage(room.room_id, text || '（附件）', clientEventId, snapshotAtts);
      // 用户已回应 → needs-you 撤标（Hermes：用户发言清除 $groupNeedsYou）
      clearRoomNeedsYou(room.room_id);
      setError(null); // 清掉"讨论进行中"等一次性提示
      await refresh();
    } catch (e) {
      // 🔴 2026-09-04 发送失败必须可见（此前静默吞错——用户"发消息没反应"）
      setError(`发送失败：${(e as Error).message}`);
      // 🔴 round-107：乐观恢复带 revision 守卫（对齐 Hermes
      // `restoreGroupComposerDraft(key, cleared.revision, before)`）——
      // 发送到失败这段空窗里用户可能已敲了新内容，无守卫的恢复会把它覆盖掉。
      // 恢复失败（null）就保持用户的新输入。
      const restored = restoreBotRoomDraft(room.room_id, cleared.revision, beforeDraft);
      if (restored) {
        setDraft(restored.main);
        setAttachments(restored.attachments);
      }
    } finally {
      setSending(false);
    }
  };

  /** 🔴 round-97：线程内回复——**继续**该线程（主输入框 = 开新线程，二者不同）。
   *  与主 send 同款：忙态拦截、幂等键、失败恢复草稿。 */
  const sendInThread = async (thread: string) => {
    const text = (threadDrafts[thread] ?? '').trim();
    if (!text || sending) return;
    if (roomBusy) {
      setError('成员正在讨论中——请等本轮结束，或点停止后再发言。');
      return;
    }
    setSending(true);
    const clientEventId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const beforeThread = botRoomDraftSnapshot(room.room_id);
    const clearedThread = patchBotRoomDraft(room.room_id, {
      replies: { ...threadDrafts, [thread]: '' },
    });
    setThreadDrafts((cur) => ({ ...cur, [thread]: '' }));
    try {
      await sendBotRoomMessage(room.room_id, text, clientEventId, undefined, thread);
      clearRoomNeedsYou(room.room_id);
      setError(null);
      await refresh();
    } catch (e) {
      setError(`发送失败：${(e as Error).message}`);
      const restoredThread = restoreBotRoomDraft(
        room.room_id,
        clearedThread.revision,
        beforeThread,
      );
      if (restoredThread) {
        setThreadDrafts(restoredThread.replies);
      } else {
        setThreadDrafts((cur) => ({ ...cur, [thread]: text }));
      }
    } finally {
      setSending(false);
    }
  };

  // 🔴 2026-09-08 round-76：**在飞轮集合**判定（此前只看事件流末条 turn.*，
  // 一旦末尾是某个成员的 settled 而另一个成员的轮仍在跑，忙态就被误判为
  // false → 发送键错切成发送态，消息被塞进在飞讨论）。
  // 配对规则严格对齐后端 policy 的终态语义（service.rs 终态四分 + held）：
  //   turn.started 开轮；settled / failed / cancelled / deferred / held 收口；
  //   msg 是**中间产物**（发言先落库、收口随后到），不参与配对。
  // 事件日志是唯一事实源——不引入任何前端本地计时器。
  const inflightTurns = useMemo(() => {
    // 🔴 round-94 G2：顺带把 **谁** 在飞解出来（对齐 Hermes 单行
    // `room.turn` → `memberThinking(groupSpeakerLabel(room.turn))`）。
    // 此前只有 bool，"成员讨论中…" 无归属；用户看不出在等谁、也看不出
    // 是不是卡在某个成员上。成员 id 取自 turn.started 的 payload
    // （事件日志自带，无需后端加字段）。
    const inflight = new Map<string, string>(); // turnId → memberId
    for (const e of events) {
      const m = /^turn:(.+):(started|settled|failed|cancelled|deferred|held)$/.exec(
        String(e.event_id ?? ''),
      );
      if (!m) continue;
      const [, turnId, kind] = m;
      if (kind === 'started') inflight.set(turnId, String(e.payload?.member_id ?? ''));
      else inflight.delete(turnId);
    }
    return inflight;
  }, [events]);
  const inflightBusy = inflightTurns.size > 0;
  /** 当前正在发言的成员（按房间名册顺序稳定输出） */
  const speakingHandles = useMemo(() => {
    const ids = new Set([...inflightTurns.values()].filter(Boolean));
    if (!ids.size) return [];
    return room.members.filter(m => ids.has(m.member_id)).map(m => m.handle);
  }, [inflightTurns, room.members]);

  // 🔴 round-95 G3：常驻 hold 状态（对齐 Hermes group-hold-status.tsx）。
  // 真值 = `room.holds`（后端 bot_room_holds 表的**持久** map），**不是**事件流
  // 里的 room.holds_changed——后者只是变更流水，重载即与现状脱节；Hermes 原文：
  // "Activity is scoped to one run and disappears across epochs/reloads; this
  // status reads the room's persisted hold map instead."
  const heldMembers = useMemo(() => {
    const held = new Set(room.holds ?? []);
    return room.members.filter(m => held.has(m.member_id));
  }, [room.holds, room.members]);

  // 🔴 round-95：房间头成员可达性（与左栏房间行同一个派生函数）
  const { known: availKnown, available: memberAvailable } =
    memberAvailability(room.members, roster);
  const memberDegraded = availKnown && memberAvailable < room.members.length;

  // 🔴 round-95 G5：本轮 Activity 折叠摘要（对齐 Hermes group-activity.ts +
  // group-chat-view.tsx 的折叠条）。Hermes 的 epoch 是**纯前端运行时**计数器
  // （"a newer send bumps the epoch"），后端不存。ELEVE 取等价语义：以最后一条
  // message.user 为轮边界——用户每次发送即开启新一轮，之前轮的事件不再描述当前
  // 工作（Hermes 原文："superseded runs are dropped from view instead of
  // describing work that already ended"）。故这里无需后端加字段。
  const [activityOpen, setActivityOpen] = useState(false);
  const runActivity = useMemo(() => {
    let startSeq = 0;
    for (const e of events) if (e.kind === KIND_USER) startSeq = Math.max(startSeq, e.seq);
    const handleOf = (id: unknown) => {
      const key = String(id ?? '');
      const m = room.members.find(x => x.member_id === key);
      return m ? `@${m.handle}` : '@成员';
    };
    // 🔴 round-99：活动行改走 `turnStatusOf` 词表（与内联行同一份真值）。
    // 档位对齐 Hermes `groupActivityTone`——**超时与出错同为 destructive**
    // （round-98 曾把超时的行为语义“缺席”错误延伸到视觉层而不标红）。
    const rows: { key: string; label: string; at: number; tone: TurnTone }[] = [];
    for (const e of events) {
      if (e.seq < startSeq) continue;
      const st = turnStatusOf(e.kind, e.payload);
      if (!st) continue;
      // 房间级活动（bounded）没有成员归属 → 不冠 who
      const label = isRoomBoundedActivity(e.kind, e.payload)
        ? st.label
        : `${handleOf(e.payload?.member_id)} ${st.label}`;
      rows.push({ key: String(e.seq), label, at: e.created_at, tone: st.tone });
    }
    return rows;
  }, [events, room.members]);

  // 🔴 round-97：线程分区（渲染窗口仍 ≤200 条——切片后再分组，总量不变）
  const threadSections = useMemo(() => groupEventsByThread(events.slice(-200)), [events]);

  // 🔴 round-92：忙态兜底。上面的事件流配对是**快路径**，前提是"每个 started
  // 最终都有一条终态事件"。driver 在 started 与终态之间崩溃（进程被杀/跨进程
  // 接管）时这个前提被打破：前端永远等不到配对 → 发送键永久停在"停止"态，
  // 房间对用户界面级死锁（后端可能早已恢复并收口）。
  // 后端 `bot_rooms_pending_task`（driver_first_unresolved：running/indeterminate/
  // stopping）才是"究竟还有没有在飞轮"的真相源。连续两次轮询（20s）都查不到
  // 在飞任务 → 判定事件流缺口，解除忙态。正常长轮期间 task 恒为 running，
  // 不会误解除；解除只影响前端按钮，不动后端恢复语义。
  const [busyStuck, setBusyStuck] = useState(false);
  useEffect(() => { if (!inflightBusy) setBusyStuck(false); }, [inflightBusy]);
  const roomBusy = inflightBusy && !busyStuck;

  // 🔴 round-79f 跨进程 driver：未决任务簿记可见性（driver_tasks 首次出网关）。
  // roomBusy 期间每 10s 轻量查询一次——indeterminate（崩溃恢复/接管中）在
  // 单进程下转瞬即逝，跨进程接管后停留可观察，提供显式重试（人工豁免
  // 恢复层 60s 冷却窗，对齐 Hermes groups.retry 的 at-least-once 确认语义）。
  const [pendingTask, setPendingTask] = useState<PendingRoomTask | null>(null);
  useEffect(() => {
    if (!inflightBusy) { setPendingTask(null); return; }
    let cancelled = false;
    let emptyPolls = 0;
    const poll = async () => {
      try {
        const tasks = await fetchBotRoomPendingTask(room.room_id);
        if (cancelled) return;
        setPendingTask(tasks[0] ?? null);
        if (tasks.length) {
          emptyPolls = 0;
        } else {
          emptyPolls += 1;
          // 判据是"后端无在飞"而非"时间够久"：网关离线时查询抛错走 catch，
          // 不累计，不会把断网误判成空闲。
          if (emptyPolls >= 2) setBusyStuck(true);
        }
      } catch { /* 网关离线：下轮重试 */ }
    };
    void poll();
    const timer = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [inflightBusy, room.room_id]);

  const handleRetryTask = async () => {
    if (!pendingTask) return;
    if (!window.confirm('重试将重新向该成员投递本轮任务（结果可能重复一次，at-least-once）。确认重试？')) return;
    try {
      await retryBotRoomTask(room.room_id, pendingTask.task_id);
      setPendingTask(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  // 🔴 round-79g：deferred 事件的显式重试（task_id == turn_id；对齐 Hermes
  // 群聊任务行 retry 挂点——at-least-once 确认）
  const handleRetryTaskById = async (turnId: string) => {
    if (!window.confirm('重试将重新向该成员投递本轮任务（结果可能重复一次，at-least-once）。确认重试？')) return;
    try {
      await retryBotRoomTask(room.room_id, turnId);
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const stopRoom = async () => {
    setBusy(true);
    try { await stopBotRoom(room.room_id); await refresh(); } finally { setBusy(false); }
  };

  const disband = async () => {
    // 🔴 2026-09-05 round-48：解散是永久墓碑（Hermes disband 同义）——
    // 二次确认防误触（此前单击直调，事件流与成员会话随之不可恢复）
    if (!window.confirm(`确定解散群聊「${room.name}」？此操作不可恢复。`)) return;
    setBusy(true);
    try {
      await disbandBotRoom(room.room_id);
      onBack();
    } catch (e) {
      // 🔴 round-79g 对齐 Hermes disband（stop 未确认不得解散）：后端拒绝
      // 时已触发取消——提示用户稍后重试（错误文案即行动指引）
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // ── 房间编辑（重命名 + 成员增删；对齐 Hermes room.renamed/members_changed）──
  const saveEdit = async (addProfiles: string[], removeMemberIds: string[]) => {
    setEditError(null);
    try {
      if (editName.trim() && editName.trim() !== room.name) {
        await renameBotRoom(room.room_id, editName.trim());
      }
      if (addProfiles.length || removeMemberIds.length) {
        await changeBotRoomMembers(room.room_id, addProfiles, removeMemberIds);
      }
      // 🔴 round-97：图变更单独一条 RPC（后端落 room.image_changed）——放最后：
      // 改名/改成员价值更高，不该因为一张图标失败而整体不落。
      if ((editImage ?? null) !== (room.image ?? null)) {
        await setBotRoomImage(room.room_id, editImage);
      }
      setShowEdit(false);
      // 🔴 2026-09-08 round-76：不再 onBack —— 改名/改成员后直接退空态，用户
      // 观感是"房间消失了"。留在房间内刷新事件流（room.renamed / members_changed
      // 事件本身可见），房间列表由 rooms store 自行刷新。
      await refresh();
    } catch (e) {
      setEditError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--ui-stroke-tertiary)] shrink-0">
        <button className="p-1 rounded hover:bg-accent/50" onClick={onBack} title="返回">
          <ArrowLeft size={15} className="text-muted-foreground" />
        </button>
        {/* 🔴 round-97：房间图（对齐 Hermes 群聊头部圆形房图；无图画组织字形） */}
        <div className="size-7 shrink-0 overflow-hidden rounded-full bg-accent/30 flex items-center justify-center">
          {room.image ? (
            <img src={room.image} alt="" className="size-full object-cover" />
          ) : (
            <Users size={13} className="text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">{room.name}</div>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-[11px] text-muted-foreground truncate min-w-0">
              {room.members.map((m) => `@${m.handle}`).join(' ')}
            </div>
            {/* 🔴 round-95：房间头可用性计数（对齐 Hermes
                group-chat-view.tsx:677-689 "X of Y available"）。派生复用
                房间行同一函数——两个面不能对"几个成员可用"给出两个答案。 */}
            {memberDegraded && (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-amber-500"
                title={`${memberAvailable} / ${room.members.length} 个成员可用`}
              >
                <WifiOff size={9} strokeWidth={2.5} />
                {memberAvailable}/{room.members.length}
              </span>
            )}
          </div>
        </div>
        {/* 🔴 round-76：停止是"运行态"的对应动作，无讨论在飞时不可点（此前空跑
            也能点，点了只落一条无意义的围栏事件） */}
        <button className="p-1.5 rounded hover:bg-accent/50" title="停止当前讨论" disabled={busy || !roomBusy} onClick={stopRoom}>
          <Square size={13} className="text-muted-foreground" />
        </button>
        <button
          className="p-1.5 rounded hover:bg-accent/50"
          title="群聊设置（重命名/成员/房间图）"
          onClick={() => { setEditImage(room.image ?? null); setShowEdit(true); }}
        >
          <Settings2 size={13} className="text-muted-foreground" />
        </button>
        <button className="p-1.5 rounded hover:bg-destructive/20" title="解散群聊" disabled={busy} onClick={disband}>
          <Trash2 size={13} className="text-destructive" />
        </button>
      </div>

      {/* 房间编辑弹层 */}
      {showEdit && (
        <RoomEditDialog
          room={room}
          roster={roster}
          editName={editName}
          setEditName={setEditName}
          editImage={editImage}
          setEditImage={setEditImage}
          error={editError}
          onSave={saveEdit}
          onClose={() => {
            setShowEdit(false);
            setEditName(room.name);
            setEditImage(room.image ?? null);
            setEditError(null);
          }}
        />
      )}

      {/* 🔴 round-95 G3：常驻 hold 状态条——**有 hold 才出现，且读持久真值**，
          与事件流里那条一次性的 "已暂停…" 内并行互补（那条是变更当时的流水）。 */}
      {heldMembers.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-1.5 border-b border-[var(--ui-stroke-tertiary)] bg-muted/30 px-3 py-1.5 text-[11px] shrink-0"
        >
          <PauseCircle size={12} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {heldMembers.length === room.members.length
                ? `已暂停全部 ${room.members.length} 个成员的发言`
                : `已暂停 ${heldMembers.map(m => `@${m.handle}`).join('、')} 的发言`}
            </div>
            <div className="text-muted-foreground">@提及该成员、或发送 resume 可恢复其发言</div>
          </div>
        </div>
      )}

      {/* 🔴 round-95 G5：本轮 Activity 折叠条（对齐 Hermes：默认收起，收起态显示
          最新一条；展开按倒序列出本轮全部轮次事件） */}
      <div className="border-b border-[var(--ui-stroke-tertiary)] shrink-0">
        <button
          className="flex w-full min-w-0 items-center gap-1.5 px-3 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
          aria-expanded={activityOpen}
          title={activityOpen ? '收起本轮进展' : '展开本轮进展'}
          onClick={() => setActivityOpen(v => !v)}
        >
          {activityOpen ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
          <span className="shrink-0 font-medium">本轮进展</span>
          {runActivity.length > 0 && (
            <span className="min-w-0 flex-1 truncate">
              {`${runActivity[runActivity.length - 1].label} · ${formatRowAge(runActivity[runActivity.length - 1].at)}`}
            </span>
          )}
        </button>
        {activityOpen && (
          <div className="grid gap-0.5 px-3 pb-1.5">
            {runActivity.length ? (
              [...runActivity].reverse().map((row) => (
                <div key={row.key} className="flex items-center gap-1.5 text-[11px]">
                  <span className={cn('min-w-0 flex-1 truncate', turnToneClass(row.tone))}>
                    {row.label}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
                    {formatRowAge(row.at)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-[10px] text-muted-foreground/70">本轮暂无进展</div>
            )}
          </div>
        )}
      </div>

      {/* 事件流 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {/* 🔴 round-76：向上分页入口（tail 首屏只取最新一页，更早历史按需拉取） */}
        {hasOlder && (
          <div className="flex justify-center">
            <button
              className="px-2.5 py-1 rounded-full text-[11px] border border-[var(--ui-stroke-tertiary)] text-muted-foreground hover:bg-accent/50 disabled:opacity-50"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? '加载中…' : '加载更早消息'}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-1">
          <Bot size={12} />
          <span>群聊已创建 · @提及成员、或直接发言（默认全员回应）</span>
        </div>
        {/* 🔴 2026-09-05 round-48：渲染窗口上限（对齐 Hermes GROUP_CHAT_HISTORY_LIMIT
            的窗口化思路；长房间事件流不无限增长 DOM）——完整日志仍在后端 */}
        {threadSections.map((sec, si) => {
          const isLast = si === threadSections.length - 1;
          // LEGACY 桶（首条用户消息之前的房间级事件）恒展开、无回复框
          const expandable = sec.thread !== LEGACY_THREAD;
          const open = !expandable || isLast || expandedThreads.has(sec.thread);
          if (!open) {
            return (
              <ThreadSummaryRow
                key={`sum-${sec.thread}`}
                label={threadSummaryLabel(sec)}
                replies={threadReplyCount(sec)}
                at={sec.lastAt}
                onExpand={() =>
                  setExpandedThreads((cur) => {
                    const next = new Set(cur).add(sec.thread);
                    patchBotRoomDraft(room.room_id, { expandedThreads: [...next] });
                    return next;
                  })
                }
              />
            );
          }
          return (
            <Fragment key={sec.thread}>
              {sec.events.map((ev) => {
                  if (ev.kind === KIND_USER) {
                    // 🔴 阶段1 统一（frontend-chat-unification-2026-09-09）：用户气泡
                    // 走 MessageRow（与单视图/宫格同一渲染原语）——附件缩略图经
                    // attachmentRefs（MessageRow user 分支：dataURL=img+图N 角标，
                    // 文件=徽标，语义与原实现一致）。时间戳是房间特有 UI，保留在前缀行。
                    const atts = Array.isArray(ev.payload.attachments) ? (ev.payload.attachments as Array<{ name?: string; kind?: string; thumb?: string }>) : [];
                    const attachmentRefs = atts.map((a) => a.thumb || a.name || 'file');
                    return (
                      <div key={ev.seq} className="flex flex-col items-end">
                        {/* 🔴 round-78d：时间戳（对齐 Hermes 消息 log 带 at——异步多轮讨论
                            需判读消息新旧；此前两种气泡零时间信息） */}
                        <span className="text-[10px] text-muted-foreground/60 mb-0.5 px-1">
                          {formatMessageTime(ev.created_at)}
                        </span>
                        <div className="w-full max-w-[85%] [&>div]:items-end">
                          <MessageRow
                            message={{
                              id: `ev-${ev.seq}`,
                              role: 'user',
                              parts: [{ type: 'text', text: String(ev.payload.text ?? '') }],
                              attachmentRefs: attachmentRefs.length > 0 ? attachmentRefs : undefined,
                            }}
                          />
                        </div>
                      </div>
                    );
                  }
                  if (ev.kind === KIND_MEMBER) {
                    // 🔴 阶段1 统一：成员气泡走 MessageRow（agent 气泡原语）。
                    // 成员前缀行（@handle · display · time）是群聊特有归属 UI，保留。
                    const handle = String(ev.actor.handle || ev.actor.id || '');
                    const display = memberByHandle[handle] || handle;
                    // 🔴 round-95：发言者归属（对齐 Hermes group-chat-view.tsx:980-1002
                    // botAppearance 头像 + :1008-1017 跨连接同名消歧）。此前前缀只有
                    // 文本，两个连接上的同名 bot 在 transcript 里完全无法区分。
                    const who = findMemberRoster(roster, handle, String(ev.actor.profile || ''));
                    return (
                      <div key={ev.seq} className="flex flex-col items-start">
                        <span className="flex items-center gap-1 mb-0.5 px-1 select-text min-w-0">
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[9px] font-semibold text-white"
                            style={{ background: who?.entry.color || 'var(--accent)' }}
                          >
                            {(display || handle).slice(0, 1).toUpperCase()}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            @{handle} · {display} · {formatMessageTime(ev.created_at)}
                          </span>
                          {who?.isRemote && (
                            <span className={cn(
                              'shrink-0 rounded px-1 py-px text-[9px]',
                              who.reachable ? 'bg-accent/60 text-foreground' : 'bg-destructive/20 text-destructive',
                            )}>
                              {who.connectionLabel}
                            </span>
                          )}
                          {/* round-98: 迟到补投——该轮曾超时，这条回复是会话跑完后由
                              收割补进原线程的（对齐 Hermes delivered 活动）。不标出来用户
                              会看到“两条回复”却不知后者属于更早的提问。 */}
                          {ev.payload?.late === true && (
                            <span
                              className="shrink-0 rounded px-1 py-px text-[9px] bg-accent/60 text-foreground"
                              title="该轮曾超时，回复随后补投到本线程"
                            >
                              迟到补投
                            </span>
                          )}
                        </span>
                        <div className="w-full max-w-[85%] [&>div]:items-start">
                          <MessageRow
                            message={{
                              id: `ev-${ev.seq}`,
                              role: 'assistant',
                              parts: [{ type: 'text', text: String(ev.payload.text ?? '') }],
                            }}
                          />
                        </div>
                      </div>
                    );
                  }
                  if (ev.kind === 'room.stop_requested') {
                    // 🔴 round-103：文案补"粘性 hold + 如何恢复"——stop 现在会把全员
                    // 置 held（对齐 Hermes `stopGroupThread`），只写"已停止"会让用户
                    // 以为再发一条消息就能继续（Hermes 原文："remaining turns are
                    // held until resumed"）。
                    return (
                      <div key={ev.seq} className="text-center text-[11px] text-muted-foreground py-0.5">
                        — 讨论已停止（成员保持暂停 —— 说「resume」或直接 @ 某成员可恢复）—
                      </div>
                    );
                  }
                  if (ev.kind === 'room.disbanded') {
                    return <div key={ev.seq} className="text-center text-[11px] text-destructive py-0.5">— 群聊已解散 —</div>;
                  }
                  {/* 🔴 2026-09-05 round-48 member holds（对齐 Hermes #93129）：
                      hold 集变更 + 成员扣留跳过对用户可见 */}
                  if (ev.kind === 'room.holds_changed') {
                    const members = Array.isArray(room.members) ? room.members : [];
                    const nameOf = (id: string) => {
                      const m = members.find(x => x.member_id === id);
                      return m ? `@${m.handle}` : id.slice(0, 8);
                    };
                    const held = Array.isArray(ev.payload.held) ? (ev.payload.held as string[]) : [];
                    const released = Array.isArray(ev.payload.released) ? (ev.payload.released as string[]) : [];
                    const parts: string[] = [];
                    if (ev.payload.release_all === true) parts.push('已恢复全体成员发言');
                    if (held.length) parts.push(`已暂停 ${held.map(nameOf).join('、')} 的发言`);
                    if (released.length) parts.push(`已恢复 ${released.map(nameOf).join('、')} 的发言`);
                    if (!parts.length) return null;
                    return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground py-0.5">— {parts.join('；')} —</div>;
                  }
                  // 🔴 round-99：轮终态统一走 `turnStatusOf` 词表
                  // （与活动行同一份真值；此前两处各自硬编码，措辞已漂移）。
                  // 🔴 round-53：turn.started 不进词表逻辑——用户实测刷屏（每个成员发言前都有一条），
                  // 且成员发言气泡本身就是“已回应”指示，轮转状态由 roomBusy 双态键表达。
                  if (
                    ev.kind === 'turn.settled' ||
                    ev.kind === 'turn.failed' ||
                    ev.kind === 'turn.cancelled' ||
                    ev.kind === 'turn.deferred' ||
                    ev.kind === 'turn.held'
                  ) {
                    const st = turnStatusOf(ev.kind, ev.payload);
                    // 实质发言的 settled：内容在成员气泡里，不再重复一行
                    if (!st || (ev.kind === 'turn.settled' && ev.payload?.passed !== true)) {
                      return null;
                    }
                    // handle 优先花名册映射（恢复层事件的 actor.handle 为空）
                    const mid = String(ev.payload?.member_id || '');
                    const byId = (Array.isArray(room.members) ? room.members : []).find(m => m.member_id === mid);
                    const who = byId ? `@${byId.handle}` : `@${String(ev.actor.handle || ev.actor.id || mid)}`;
                    const turnId =
                      /^turn:(.+):(settled|failed|cancelled|deferred|held)$/.exec(String(ev.event_id ?? ''))?.[1] ?? null;
                    return (
                      <div key={ev.seq} className={cn('text-center text-[11px] py-0.5', turnToneClass(st.tone))}>
                        — {who} {st.label} —
                        {/* 超时缺席不给重试：会话里那一轮还在跑，重试会双注入同一
                            成员会话（Hermes 对超时也不重试，靠收割补投） */}
                        {st.retryable && turnId && (
                          <button
                            className="ml-2 underline hover:text-foreground"
                            onClick={() => void handleRetryTaskById(turnId)}
                          >
                            重试
                          </button>
                        )}
                      </div>
                    );
                  }
                  // 🔴 round-99：房间级“达到上限而停止”（此前前端**零消费**）。
                  // 讨论撞上轮数/消息数上限后静默停止，用户只看到“没人再回复”却不
                  // 知为何。对齐 Hermes `capped` 活动。
                  if (isRoomBoundedActivity(ev.kind, ev.payload)) {
                    const st = turnStatusOf(ev.kind, ev.payload);
                    if (!st) return null;
                    return (
                      <div key={ev.seq} className={cn('text-center text-[11px] py-0.5', turnToneClass(st.tone))}>
                        — {st.label} —
                      </div>
                    );
                  }
                  if (ev.kind === 'room.renamed') {
                    // 🔴 round-78d：改名/成员变更轨迹可见（对齐 Hermes group-activity
                    // tile——此前 fallback null 且 saveEdit 注释宣称"事件可见"失实）
                    const newName = String(ev.payload.new_name ?? ev.payload.name ?? '');
                    return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/70 py-0.5">— 房间已改名{newName ? `：「${newName}」` : ''} —</div>;
                  }
                  if (ev.kind === 'room.members_changed') {
                    const members = Array.isArray(room.members) ? room.members : [];
                    const nameOf = (id: string) => {
                      const m = members.find(x => x.member_id === id);
                      return m ? `@${m.handle}` : id.slice(0, 8);
                    };
                    const added = Array.isArray(ev.payload.added) ? (ev.payload.added as Array<{ profile?: string }>) : [];
                    const removed = Array.isArray(ev.payload.removed) ? (ev.payload.removed as Array<{ profile?: string; member_id?: string }>) : [];
                    const parts: string[] = [];
                    if (added.length) parts.push(`${added.map(a => a.profile || '?').join('、')} 加入`);
                    if (removed.length) parts.push(`${removed.map(r => r.profile || (r.member_id ? nameOf(r.member_id) : '?')).join('、')} 移出`);
                    if (!parts.length) return null;
                    return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/70 py-0.5">— 成员变更：{parts.join('；')} —</div>;
                  }
                  if (ev.kind === 'authority.claimed' || ev.kind === 'authority.lost') {
                    // 🔴 round-78d：接管/退位可见（对齐 Hermes replicas lineage 事件）
                    return (
                      <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/70 py-0.5">
                        — {ev.kind === 'authority.claimed' ? '本机已接管讨论（副本晋升为权威）' : '权威已转移（本机退位为副本）'} —
                      </div>
                    );
                  }
                  return null; // turn.settled(实质发言)/room.created 不渲染（信息在气泡与状态行里）
              })}
              {/* 每个展开的线程都有自己的回复框（含最近活跃那个）——继续该线程；
                  底部主输入框恒 = 开新线程（对齐 Hermes "Every open thread gets its
                  own reply box"）。 */}
              {expandable && (
                <ThreadReplyBox
                  members={room.members}
                  value={threadDrafts[sec.thread] ?? ''}
                  onChange={(v) =>
                    setThreadDrafts((cur) => {
                      const next = { ...cur, [sec.thread]: v };
                      patchBotRoomDraft(room.room_id, { replies: next });
                      return next;
                    })
                  }
                  onSubmit={() => void sendInThread(sec.thread)}
                  busy={roomBusy || sending}
                />
              )}
            </Fragment>
          );
        })}
        {/* 🔴 2026-09-05 round-60：讨论进行中的可见反馈——turn.started 已不
            渲染（round-53），成员轮 LLM 运行期间事件流完全静默，用户观感
            "发消息没反应"（发图卡死事故的观感放大器）。对齐 Hermes 群聊
            running 态：仅在等待时显示一行状态，下一事件到达即自然消失，
            不产生历史刷屏。 */}
        {/* 🔴 round-78d：成员轮交互镜像卡（对齐 Hermes GroupClarifyCard——
            成员 agent 向用户澄清/请求审批时在房间内响应，轮预算自动延长） */}
        {[...pendingInteractions.entries()].map(([requestId, p]) => {
          const member = room.members.find(m => m.member_id === p.memberId);
          const label = member ? `@${member.handle}` : p.memberId.slice(0, 8);
          // 🔴 阶段2 统一（frontend-chat-unification-2026-09-09）：clarify 分支
          // 换装 ClarifyCard（提交通道注入 respondBotRoomInteraction——round-78d
          // 房间域转交通道），与单视图/宫格同一交互卡渲染原语。单选项即提交、
          // 手动输入兜底、过期折叠态全部免费获得。multiSelect 不传（原手写卡
          // 亦无多选语义——房间后端 interact_respond 按 answer 原文转交）。
          if (p.kind === 'clarify') {
            return (
              <div key={`interact-${requestId}`} className="max-w-[85%] self-center w-full">
                <ClarifyCard
                  clarifyId={requestId}
                  question={p.question}
                  choices={p.choices}
                  title={`${label} 需要你的澄清`}
                  submit={async (resp) => {
                    const ok = await respondBotRoomInteraction(requestId, resp);
                    return ok ? { status: 'resolved' } : { status: 'error' };
                  }}
                  onDone={() => settleInteraction(requestId)}
                  onExpired={() => settleInteraction(requestId)}
                />
              </div>
            );
          }
          // 🔴 approval 分支保留手写卡：round-78d 双通道裁定——房间审批走
          // approval.respond + resolve_all（多成员并发轮全部裁决），与主网关
          // ApprovalCard 的 all:false 语义不同，非重复待合并。
          return (
            <div key={`interact-${requestId}`} className="max-w-[85%] self-center w-full border border-[var(--ui-stroke-tertiary)] rounded-xl bg-popover text-popover-foreground px-3 py-2.5 space-y-2 shadow-sm">
              <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {label} 请求审批
              </div>
              <>
                <div className="text-sm text-foreground font-mono break-all select-text">{p.command}</div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground break-words">{p.description}</div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { c: 'once', label: '允许一次' },
                      ...(p.allowSession ? [{ c: 'session', label: '本会话内允许' }] : []),
                      ...(p.allowPermanent ? [{ c: 'always', label: '始终允许' }] : []),
                      { c: 'deny', label: '拒绝' },
                    ].map(({ c, label: bl }) => (
                      <button
                        key={c}
                        className={cn(
                          'px-2.5 py-1 rounded-md text-xs transition-colors',
                          c === 'deny'
                            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                            : 'bg-accent text-accent-foreground hover:bg-accent/70',
                        )}
                        onClick={() => {
                          // 🔴 round-94：审批改走 `bot.rooms.approve`（对齐
                          // Hermes groups.approve）。此前走 approval.respond +
                          // resolve_all:true 有两个断点：
                          // ① 按 **session** 全量裁决——"Group:" 成员会话可经
                          //    bot.chats.list 在 UI 单独打开，用户侧可能另有
                          //    注册，一次点击连带 deny 掉他人待审批；
                          // ② 只认 session_id，没有 task/代次身份——上一轮遗留
                          //    的卡会被新一轮的点击误裁（放行的是别人那一次）。
                          // 房间域裁决带 task_id + execution_generation +
                          // request_id 三坐标，后端全等才受理。
                          // 清卡仍坚持 round-92 的"确认成功才清"（失败保留卡片
                          // 可重试，不让审批静默失败）。
                          void approveBotRoomTask({
                            roomId: p.roomId || room.room_id,
                            memberId: p.memberId,
                            taskId: p.taskId,
                            executionGeneration: p.executionGeneration,
                            requestId,
                            choice: c as 'once' | 'deny' | 'session' | 'always',
                          })
                            .then(() => settleInteraction(requestId))
                            .catch((e) => {
                              setError(`审批失败：${e instanceof Error ? e.message : String(e)}`);
                            });
                        }}
                      >
                        {bl}
                      </button>
                    ))}
                  </div>
                </>
            </div>
          );
        })}
        {roomBusy && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-0.5">
            <Loader size={11} className="animate-spin opacity-60" />
            {pendingTask?.status === 'indeterminate' ? (
              <>
                {/* 🔴 round-79f 跨进程 driver：接管/恢复中 indeterminate 可观察 +
                    显式重试（人工豁免 60s 冷却窗） */}
                <span>轮结果确认中（跨进程接管）…</span>
                <button
                  className="underline hover:text-foreground"
                  onClick={() => void handleRetryTask()}
                >
                  手动重试
                </button>
              </>
            ) : (
              <span>
                {speakingHandles.length
                  ? `@${speakingHandles.join('、@')} 正在发言…`
                  : '成员讨论中…'}
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入区（@ 提及对齐 Hermes GroupMentionInput；附件对齐 group-attachments）。
          🔴 2026-09-05 round-59c：外围 1:1 对齐主输入区——删 border-t 分隔线
          （主区无），p-3 四周呼吸（对齐 InputArea 根 p-3，focus 光环有完整
          呼吸空间）；composer 本体的 mx/mb 缩进随之移除（容器已供） */}
      <div
        className="relative flex flex-col shrink-0 p-3"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void addFiles(e.dataTransfer?.files); }}
      >
        {error && (
          <div className="mt-2 mb-2 px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
          </div>
        )}
        {/* 🔴 round-50：附件预览条 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {attachments.map((a, i) => (
              <div key={`${a.name}-${i}`} className="relative group">
                {a.thumb ? (
                  <img src={a.thumb} alt={a.name} className="h-14 w-14 object-cover rounded-md border border-[var(--ui-stroke-tertiary)]" />
                ) : (
                  <div className="h-14 px-2 flex items-center rounded-md border border-[var(--ui-stroke-tertiary)] bg-accent/40 text-[10px] text-muted-foreground max-w-32">
                    <span className="truncate">{a.name}</span>
                  </div>
                )}
                <button
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-background border border-[var(--ui-stroke-tertiary)] text-muted-foreground"
                  onClick={() =>
                    setAttachments((cur) => {
                      const next = cur.filter((_, j) => j !== i);
                      patchBotRoomDraft(room.room_id, { attachments: next });
                      return next;
                    })
                  }
                  title="移除附件"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* 🔴 2026-09-05 round-59/59c：输入框 UI 1:1 对齐主消息区 InputArea——
            两行形态（输入在上/控制行在下）+ rounded-2xl border 容器 + composer
            高度/内边距/控制尺寸变量全套；外围 p-3 + 无 border-t = 主区同款 */}
        <div className="composer-surface relative rounded-2xl border">
          <div className="flex flex-col gap-(--composer-row-gap) px-(--composer-surface-pad-x) py-(--composer-surface-pad-y)">
            <MentionTextarea
              members={room.members}
              value={draft}
              onChange={(v) => {
                setDraft(v);
                patchBotRoomDraft(room.room_id, { main: v });
              }}
              onSubmit={send}
              onPaste={(e) => { const fs = e.clipboardData?.files; if (fs?.length) { e.preventDefault(); void addFiles(fs); } }}
              placeholder={`发消息到「${room.name}」… 输入 @ 唤起成员，可粘贴/拖入附件`}
            />
            {/* 控制行 — 1:1 对齐主输入区（gap = --composer-control-gap；附件按钮 =
                AttachMenu 同款 class；发送键 size = --composer-control-primary-size，
                外层 ml-auto + control-gap 包裹同款） */}
            <div className="flex items-center gap-(--composer-control-gap)">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
              />
              <button
                className="inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                title="添加附件（≤15MB，最多 4 个）"
                disabled={sending || roomBusy}
              >
                <Paperclip size={16} />
              </button>
              {/* 发送/停止双态键（1:1 对齐主输入区：黑底白箭头/白底黑箭头，
                  停止态小方块接房间级 stopBotRoom） */}
              <div className="ml-auto flex items-center gap-(--composer-control-gap)">
                <button
                  className={cn(
                    'inline-flex size-(--composer-control-primary-size) shrink-0 cursor-pointer items-center justify-center rounded-full p-0 outline-none transition-all duration-150',
                    'bg-foreground text-background hover:bg-foreground/90 active:scale-90',
                    'disabled:cursor-not-allowed disabled:bg-foreground/30 disabled:opacity-100 disabled:active:scale-100',
                  )}
                  disabled={roomBusy ? busy : (!draft.trim() && !attachments.length) || sending}
                  onClick={roomBusy ? stopRoom : send}
                  title={roomBusy ? '停止当前讨论' : '发送'}
                  aria-label={roomBusy ? 'Stop discussion' : 'Send message'}
                >
                  {roomBusy ? (
                    <span className="block size-2.5 rounded-[0.1875rem] bg-current" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// @ 提及输入 — 对齐 Hermes GroupMentionInput（group-chat-parts.tsx:138-330）：
// 光标前 @token 解析 → 浮层（@all/@everyone + 成员前缀过滤）→ 键盘导航
// （↑↓/Enter/Tab/Esc）+ IME composition 守卫（中文输入法 Enter 不误插）→
// 插入 `@handle ` 恢复光标。
// ══════════════════════════════════════════════════════════════════

interface MentionOption {
  handle: string;
  meta: string;
}

interface MentionToken {
  query: string;
  start: number;
}

function mentionTokenAt(text: string, caret: number): MentionToken | null {
  const upto = String(text || '').slice(0, caret);
  // 🔴 round-78：token 含 CJK（与 lib/bot-mentions.ts 同一词汇表；后端
  // resolve_mentions 本就支持 display 名中文匹配）——此前 ASCII-only，
  // 群聊 @中文名 补全 query 恒空串（前缀过滤失效，全列表兜底）
  const match = /(^|\s)@([\w\u4e00-\u9fa5.-]*)$/i.exec(upto);
  if (!match) return null;
  return { query: match[2].toLowerCase(), start: caret - match[2].length - 1 };
}

function MentionTextarea({
  members,
  value,
  onChange,
  onSubmit,
  placeholder,
  onPaste,
}: {
  members: BotRoom['members'];
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** 🔴 round-50：附件粘贴入口（clipboardData.files → 宿主附件管线） */
  onPaste?: (e: ReactClipboardEvent<HTMLTextAreaElement>) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [token, setToken] = useState<MentionToken | null>(null);
  const [selected, setSelected] = useState(0);

  // 🔴 2026-09-05 round-49：自动调高（对齐主输入区 InputArea syncHeight：
  // 随内容增长到上限，长文本不再固定单行滚动）。round-59：上限 150px 与
  // --composer-input-max-height（9.375rem）同值，textarea class 已用该变量
  // 硬限高，JS 上限与其保持一致。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [value]);

  const options: MentionOption[] = [];
  if (token) {
    // @all/@everyone 优先（全员响应语义，对齐 Hermes group.everyoneMeta）
    for (const pick of ['everyone', 'all']) {
      if (pick.startsWith(token.query)) {
        options.push({ handle: pick, meta: '全体成员' });
      }
    }
    for (const member of members) {
      const handle = String(member.handle || '').trim();
      const display = String(member.display_name || handle).trim();
      if (!handle) continue;
      if (
        token.query &&
        !handle.toLowerCase().startsWith(token.query) &&
        !display.toLowerCase().startsWith(token.query)
      ) {
        continue;
      }
      options.push({ handle, meta: display });
    }
  }

  const open = Boolean(token) && options.length > 0;
  const active = open ? Math.min(selected, options.length - 1) : 0;

  const refreshToken = (el: HTMLTextAreaElement) => {
    setToken(mentionTokenAt(el.value, el.selectionStart ?? el.value.length));
    setSelected(0);
  };

  const insert = (handle: string) => {
    if (!token) return;
    const caret = inputRef.current?.selectionStart ?? value.length;
    const next = `${value.slice(0, token.start)}@${handle} ${value.slice(caret)}`;
    onChange(next);
    setToken(null);
    // 光标恢复到插入的 mention 之后（对齐 Hermes insert L231-256）
    const pos = token.start + handle.length + 2;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        try { el.setSelectionRange(pos, pos); } catch { /* noop */ }
      }
    });
  };

  return (
    <div className="relative min-w-0">
      {open ? (
        /* 🔴 2026-09-05 round-59c：浮层盒子样式 1:1 对齐 SlashCommandPopup
           （mb-1.5/rounded-lg/p-1/max-h-60 + 项 px-3 py-1.5 text-sm rounded-md
           + 选中 bg-accent text-accent-foreground）；宽度 w-64/left-0 为 @补全
           的光标锚定语义（与主区 slash 全宽不同），保留 */
        <div className="absolute bottom-full left-0 z-50 mb-1.5 max-h-60 w-64 overflow-y-auto rounded-lg border border-[var(--ui-stroke-tertiary)] bg-popover text-popover-foreground p-1 shadow-lg">
          {options.map((option, index) => (
            <button
              key={option.handle}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer rounded-md',
                index === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
              // preventDefault 保持输入框焦点（对齐 Hermes mousedown 语义）
              onMouseDown={(e) => { e.preventDefault(); insert(option.handle); }}
              onMouseEnter={() => setSelected(index)}
            >
              <span className="font-medium">@{option.handle}</span>
              <span className="truncate text-[0.65rem] opacity-60">{option.meta}</span>
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        placeholder={placeholder}
        className="max-h-(--composer-input-max-height) min-h-(--composer-input-min-height) w-full resize-none border-0 bg-transparent px-1 pb-0.5 pt-1 text-sm leading-normal outline-none placeholder:text-muted-foreground/60"
        onBlur={() => setToken(null)}
        onPaste={onPaste}
        onChange={(e) => { onChange(e.target.value); refreshToken(e.target); }}
        onClick={(e) => refreshToken(e.target as HTMLTextAreaElement)}
        onKeyDown={(e) => {
          // IME composition 守卫（对齐 Hermes：中文输入法 Enter 是确认拼音，
          // 不得插入 mention/提交；nativeEvent.isComposing 覆盖 Chromium，
          // keyCode 229 覆盖 macOS 中文 IME）
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((active + 1) % options.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((active - 1 + options.length) % options.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(options[active].handle); return; }
            if (e.key === 'Escape') { e.preventDefault(); setToken(null); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
        }}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 房间编辑弹层 — 重命名 + 成员增删（对齐 Hermes room.renamed/members_changed）
// ══════════════════════════════════════════════════════════════════

function RoomEditDialog({
  room, roster, editName, setEditName, editImage, setEditImage, error, onSave, onClose,
}: {
  room: BotRoom;
  roster: UnionRosterRow[];
  editName: string;
  setEditName: (v: string) => void;
  /** 🔴 round-97：房间图（随 Save 提交；null = 清除） */
  editImage: string | null;
  setEditImage: (v: string | null) => void;
  error: string | null;
  onSave: (addProfiles: string[], removeMemberIds: string[]) => void;
  onClose: () => void;
}) {
  const [pendingRemove, setPendingRemove] = useState<string[]>([]);
  const [pendingAdd, setPendingAdd] = useState<string[]>([]);
  const nextCount = room.members.length - pendingRemove.length + pendingAdd.length;
  // 🔴 2026-09-05 round-48：与创建场景统一为 2-6（后端 MIN/MAX_DISCUSSION_MEMBERS
  // 硬约束——此前编辑允许删到 1 人，存盘后房间无法驱动）
  const canSave = nextCount >= 2 && nextCount <= 6;

  // 🔴 round-95：与创建弹层共用同一份派生（含远端 + 不可达禁用 + 跨连接消歧）
  const addable = pickableMembers(roster).filter(
    (r) => !room.members.some((m) => m.profile === r.profile) && !pendingAdd.includes(r.profile),
  );

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-card-bg)] p-4 space-y-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">群聊设置</span>
          <button className="p-1 rounded hover:bg-accent/50" onClick={onClose}>
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="群聊名称"
          className="w-full px-2.5 py-1.5 rounded-md bg-accent/30 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />

        {/* 🔴 round-97：房间图（对齐 Hermes group-chat-parts GroupImageControls）
            🔴 round-100：补"生成"（prompt 用编辑中的房间名 + 当前成员） */}
        <RoomImageControls
          image={editImage}
          onImage={setEditImage}
          name={editName}
          memberHandles={room.members.map((m) => m.handle)}
        />

        <div className="max-h-48 overflow-y-auto space-y-1">
          {/* 当前成员（标记移除） */}
          {room.members.map((m) => {
            const marked = pendingRemove.includes(m.member_id);
            return (
              <div key={m.member_id} className={cn('flex items-center justify-between px-2 py-1.5 rounded-md', marked ? 'opacity-40' : 'hover:bg-accent/30')}>
                <span className="text-sm text-foreground">@{m.handle} · {m.display_name}</span>
                <button
                  className="p-1 rounded hover:bg-destructive/20"
                  title={marked ? '撤销移除' : '移除成员'}
                  onClick={() => setPendingRemove((cur) =>
                    marked ? cur.filter((id) => id !== m.member_id) : [...cur, m.member_id])}
                >
                  {marked ? <UserPlus size={13} className="text-foreground" /> : <UserMinus size={13} className="text-destructive" />}
                </button>
              </div>
            );
          })}
          {/* 可添加成员 */}
          {addable.map((row) => (
            <div
              key={row.key}
              className={cn(
                'flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-accent/30',
                row.disabled && 'opacity-40',
              )}
              title={row.disabledReason || (row.isRemote ? `远端 · ${row.connectionLabel}` : undefined)}
            >
              <span className="text-sm text-muted-foreground truncate">
                {memberPickLabel(row)} · {row.displayName}
              </span>
              <button
                className="p-1 rounded hover:bg-accent/50 disabled:cursor-not-allowed"
                title={row.disabled ? row.disabledReason : '添加成员'}
                disabled={row.disabled}
                onClick={() => setPendingAdd((cur) => [...cur, row.profile])}
              >
                <UserPlus size={13} className="text-foreground" />
              </button>
            </div>
          ))}
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex items-center justify-between">
          <span className={cn('text-xs', canSave ? 'text-muted-foreground' : 'text-destructive')}>
            成员 {nextCount}/2-6
          </span>
          <button
            className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-40"
            disabled={!canSave}
            onClick={() => onSave(pendingAdd, pendingRemove)}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// 🔴 round-97：线程形状（对齐 Hermes group-chat-view.tsx:1064-1069 的
// Slack/Discord 模型）——最近活跃的线程展开，更早的折叠成摘要行；
// 每个展开的线程有自己的回复框（继续该线程）；底部主输入框开新线程。
// ═════════════════════════════════════════════════════════════════════

/** 折叠态的线程摘要行（Slack 风格：首条用户消息 + 回复数 + 时间）。 */
function ThreadSummaryRow({
  label,
  replies,
  at,
  onExpand,
}: {
  label: string;
  replies: number;
  at: number;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-left hover:bg-accent/40 group"
      title="展开该线程"
    >
      <ChevronRight size={12} className="shrink-0 text-muted-foreground group-hover:text-foreground" />
      <span className="text-[11px] font-medium text-foreground shrink-0">
        {replies > 0 ? `${replies} 条回复` : '无回复'}
      </span>
      <span className="text-[11px] text-muted-foreground truncate min-w-0 flex-1">{label}</span>
      <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">
        {formatMessageTime(at)}
      </span>
    </button>
  );
}

/** 展开态线程的回复框——**继续该线程**（对齐 Hermes `submitReply(thread)`）。 */
function ThreadReplyBox({
  members,
  value,
  onChange,
  onSubmit,
  busy,
}: {
  members: BotRoom['members'];
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="composer-surface relative rounded-2xl border mt-1.5">
      <div className="flex items-end gap-2 px-(--composer-surface-pad-x) py-(--composer-surface-pad-y)">
        <div className="min-w-0 flex-1">
          <MentionTextarea
            members={members}
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder="回复此线程…（输入 @ 唤起成员）"
          />
        </div>
        <button
          className={cn(
            'inline-flex size-(--composer-control-primary-size) shrink-0 cursor-pointer items-center justify-center rounded-full p-0 outline-none transition-all duration-150',
            'bg-foreground text-background hover:bg-foreground/90 active:scale-90',
            'disabled:cursor-not-allowed disabled:bg-foreground/30 disabled:opacity-100 disabled:active:scale-100',
          )}
          disabled={busy || !value.trim()}
          onClick={onSubmit}
          title={busy ? '成员正在讨论中' : '回复此线程'}
          aria-label="Reply in thread"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
