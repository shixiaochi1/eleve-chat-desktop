/**
 * BotsView — Bot Mode 主区视图（对齐 Hermes Desktop：Bots 是主窗口 tab，
 * 群聊视图是 MAIN-window tab——占主区大空间，不是侧边栏窄面板）。
 *
 * 🔴 2026-09-04 布局对齐：左列（w-80）= 花名册 + 群聊列表；右侧 = 选中
 * 群聊的房间视图（大区域聊天流）。点击花名册 bot 行 → 打开该 Agent 的
 * canonical Bot Chat 到主聊天区（对齐 bot-mode-row-click-mirrors-registry）。
 *
 * 数据流：命令 → utils/api.ts（bots 命令层）；事件 → ws-client 监听器。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowLeft, Bot, Loader, MessageSquarePlus, Pencil, Send, Settings2, Square, Trash2, UserPlus, UserMinus, X } from 'lucide-react';
import {
  changeBotRoomMembers, createBotRoom, disbandBotRoom, fetchBotRoomEvents,
  fetchBotRooms, fetchBotsRoster, ensureBotChat, renameBotRoom, sendBotRoomMessage,
  stopBotRoom,
  type BotRosterEntry, type BotRoom, type BotRoomEvent,
} from '../utils/api';
import { getWsClient } from '../services/ws-client';
import { ingestBotRoster, markBotRead, useBotUnread } from '../hooks/useBotUnread';

interface BotsViewProps {
  /** 🔴 打开 bot 的 canonical chat（App 层：宫格/Bots 视图先退 + forceProfile） */
  onOpenBotChat?: (id: string) => void;
  /** 🔴 2026-09-04 对齐 Hermes roster 右键 Edit Profile：编辑该 Agent（App 层 EditAgentDialog） */
  onEditAgent?: (profile: string) => void;
  currentProfile?: string;
  /** 面板切换（Agent 不足时引导跳转 Agent 页） */
  onPanelChange?: (panel: string | null) => void;
}

const KIND_USER = 'message.user';
const KIND_MEMBER = 'message.member';

export default function BotsView({ onOpenBotChat, onEditAgent, onPanelChange }: BotsViewProps) {
  const [bots, setBots] = useState<BotRosterEntry[]>([]);
  const [rooms, setRooms] = useState<BotRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [activeRoom, setActiveRoom] = useState<BotRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 🔴 2026-09-04 花名册行右键菜单（对齐 Hermes bot 行右键 → Edit Profile）
  const [rowMenu, setRowMenu] = useState<{ profile: string; x: number; y: number } | null>(null);
  // 🔴 2026-09-04 单 Agent 引导：群聊/DM 都需要 ≥2 个 Agent；只有一个时
  // 明确告知去 Agent 页面创建（此前静默禁用保存按钮，用户完全无感知）
  const needsMoreAgents = !loading && bots.length < 2;

  const loadList = useCallback(async () => {
    try {
      const [roster, roomList] = await Promise.all([fetchBotsRoster(), fetchBotRooms()]);
      setBots(roster);
      // 🔴 2026-09-04 喂给未读 store（单一入口：本视图刷新与后台轮询共用）
      ingestBotRoster(roster);
      setRooms(roomList);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // 右键菜单：点任意处/滚动即关（fixed 定位跟随指针，防溢出做下缘钳制）
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

  // ── 创建群聊 ──
  const submitCreate = async () => {
    const name = newName.trim();
    if (!name || newMembers.length < 2 || newMembers.length > 6) return;
    setCreating(true);
    try {
      await createBotRoom(name, newMembers);
      setNewName('');
      setNewMembers([]);
      setShowCreate(false);
      await loadList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // ── 打开 bot 私聊 ──
  const openBotChat = async (profile: string) => {
    try {
      const sid = await ensureBotChat(profile);
      // 🔴 2026-09-04 打开即已读（对齐 Hermes openBotCanonicalChat 的 ack 语义）
      markBotRead(profile);
      if (sid && onOpenBotChat) onOpenBotChat(sid);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // ── 布局：左列（花名册 + 群聊列表）+ 右侧（房间视图 / 空态）──
  return (
    <div className="relative flex h-full min-h-0">
      {/* ═══ 左列 ═══ */}
      <div className="w-80 shrink-0 border-r border-[var(--ui-stroke-tertiary)] flex flex-col min-h-0">
      {/* 工具行 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--ui-stroke-tertiary)] shrink-0">
        <span className="text-xs text-muted-foreground">
          {loading ? '加载中…' : `${bots.length} 个 Agent · ${rooms.length} 个群聊`}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground"
            title="刷新"
            onClick={() => { setLoading(true); loadList(); }}
          >
            <Loader size={14} className={cn(loading && 'animate-spin')} />
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground"
            title="新建群聊"
            onClick={() => setShowCreate(true)}
          >
            <MessageSquarePlus size={15} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-4">
        {/* ── 单 Agent 引导（Bot Mode 的前提是 ≥2 个 Agent 协作） ── */}
        {needsMoreAgents && (
          <div className="rounded-lg border border-[var(--ui-stroke-tertiary)] bg-accent/20 px-3 py-2.5 text-xs text-muted-foreground space-y-2">
            <div>
              Bot Mode 需要至少 <span className="text-foreground font-medium">2 个 Agent</span> 才能组群聊或互发私信。
              当前只有 {bots.length} 个——请先到「Agent」页面新建更多 Agent（各自配好模型），再回来创建群聊。
            </div>
            <button
              className="px-2.5 py-1 rounded-md bg-accent text-accent-foreground text-xs font-medium"
              onClick={() => onPanelChange?.('agents')}
            >
              去 Agent 页面新建 →
            </button>
          </div>
        )}

        {/* ── 群聊房间 ── */}
        {rooms.length > 0 && (
          <section>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">群聊</div>
            <div className="space-y-1">
              {rooms.map((room) => (
                <button
                  key={room.room_id}
                  className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors"
                  onClick={() => setActiveRoom(room)}
                >
                  <div className="text-sm text-foreground font-medium truncate">{room.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {room.members.map((m) => `@${m.handle}`).join(' ')}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Bot 花名册（点击开私聊；右键编辑 Agent——对齐 Hermes roster Edit Profile） ── */}
        <section>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Agent</div>
          <div className="space-y-1">
            {bots.map((bot) => (
              <BotRosterRow
                key={bot.profile}
                bot={bot}
                onOpen={() => openBotChat(bot.profile)}
                onRowMenu={(x, y) => setRowMenu({ profile: bot.profile, x, y })}
              />
            ))}
            {!loading && bots.length === 0 && (
              <div className="text-xs text-muted-foreground px-2 py-1.5">暂无已注册 Agent</div>
            )}
          </div>
        </section>
        </div>

        {/* ═══ 右侧：房间视图 / 空态 ═══ */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {activeRoom ? (
            <BotsRoomView
              room={activeRoom}
              bots={bots}
              onBack={() => { setActiveRoom(null); loadList(); }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 px-6 text-center">
              <Bot size={28} className="opacity-40" />
              <div className="text-sm">选择左侧群聊进入房间，或点击 Agent 打开 Bot Chat 私聊</div>
              <div className="text-xs text-muted-foreground/70 max-w-sm">
                群聊里输入 @ 可唤起成员列表；Agent 之间的私信在各自 Bot Chat 里收发（message_agent 工具）。
              </div>
            </div>
          )}
        </div>
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
              placeholder="群聊名称"
              className="w-full px-2.5 py-1.5 rounded-md bg-accent/30 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="max-h-44 overflow-y-auto space-y-1">
              {bots.length < 2 && (
                <div className="text-xs text-muted-foreground px-2 py-1.5">
                  当前只有 {bots.length} 个 Agent——群聊至少需要 2 个。请先到「Agent」页面新建更多 Agent。
                </div>
              )}
              {bots.map((bot) => {
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
                disabled={!newName.trim() || newMembers.length < 2 || newMembers.length > 6 || creating}
                onClick={submitCreate}
              >
                {creating ? <Loader size={14} className="animate-spin" /> : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 花名册行右键菜单（对齐 Hermes bot 行右键 → Edit Profile） ── */}
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

// ── 花名册单行（提取组件：未读点需 useBotUnread 订阅，hook 不能进 map） ──
// 未读点视觉语义对齐 SessionStatusDot 的 unread 变体（bg-success 稳态点）；
// 活动权威 = canonical Bot Chat（行点击打开的就是它，点与会话永不描述两回事）。
function BotRosterRow({ bot, onOpen, onRowMenu }: {
  bot: BotRosterEntry;
  onOpen: () => void;
  onRowMenu: (x: number, y: number) => void;
}) {
  const unread = useBotUnread(bot.profile);
  return (
    <button
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left"
      title={`打开与 @${bot.handle} 的私聊`}
      onClick={onOpen}
      onContextMenu={(e) => { e.preventDefault(); onRowMenu(e.clientX, e.clientY); }}
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold text-white"
        style={{ background: bot.color || 'var(--accent)' }}
      >
        {(bot.display_name || bot.handle).slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground truncate">{bot.display_name || bot.handle}</span>
        <span className="block text-xs text-muted-foreground truncate">@{bot.handle}</span>
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

function BotsRoomView({ room, bots, onBack }: { room: BotRoom; bots: BotRosterEntry[]; onBack: () => void }) {
  const [events, setEvents] = useState<BotRoomEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState(room.name);
  const [editError, setEditError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestSeq = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef(room);
  roomRef.current = room;

  const memberByHandle = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of room.members) map[m.handle] = m.display_name || m.handle;
    return map;
  }, [room.members]);

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
    try {
      const { events: fresh, latest_seq } = await fetchBotRoomEvents(roomRef.current.room_id, latestSeq.current);
      latestSeq.current = Math.max(latestSeq.current, latest_seq);
      mergeEvents(fresh);
    } catch { /* 静默（下一次推送/轮询兜底） */ }
  }, [mergeEvents]);

  // 初次全量 + 实时推送订阅 + 慢轮询兜底
  useEffect(() => {
    latestSeq.current = 0;
    setEvents([]);
    refresh();

    const ws = getWsClient();
    const unsubscribe = ws.addEventListener((eventName, data) => {
      if (eventName !== 'bot.room.event') return;
      const payload = data as { room_id?: string; event?: BotRoomEvent };
      if (payload?.room_id !== roomRef.current.room_id || !payload.event) return;
      const ev = payload.event;
      mergeEvents([ev]);
      if (ev.seq > latestSeq.current) latestSeq.current = ev.seq;
    });
    const timer = setInterval(refresh, 15000); // 二道保险（事件丢失兜底）
    return () => { unsubscribe(); clearInterval(timer); };
  }, [room.room_id, refresh, mergeEvents]);

  // 自动滚底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const snapshot = draft;
    setDraft('');
    try {
      await sendBotRoomMessage(room.room_id, text);
      await refresh();
    } catch (e) {
      // 🔴 2026-09-04 发送失败必须可见（此前静默吞错——用户"发消息没反应"）
      setError(`发送失败：${(e as Error).message}`);
      setDraft(snapshot); // 恢复草稿
    } finally {
      setSending(false);
    }
  };

  const stopRoom = async () => {
    setBusy(true);
    try { await stopBotRoom(room.room_id); await refresh(); } finally { setBusy(false); }
  };

  const disband = async () => {
    setBusy(true);
    try { await disbandBotRoom(room.room_id); onBack(); } finally { setBusy(false); }
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
      setShowEdit(false);
      onBack(); // 回列表刷新（房间身份已变，重新拉取）
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
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">{room.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {room.members.map((m) => `@${m.handle}`).join(' ')}
          </div>
        </div>
        <button className="p-1.5 rounded hover:bg-accent/50" title="停止当前讨论" disabled={busy} onClick={stopRoom}>
          <Square size={13} className="text-muted-foreground" />
        </button>
        <button className="p-1.5 rounded hover:bg-accent/50" title="群聊设置（重命名/成员）" onClick={() => setShowEdit(true)}>
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
          bots={bots}
          editName={editName}
          setEditName={setEditName}
          error={editError}
          onSave={saveEdit}
          onClose={() => { setShowEdit(false); setEditName(room.name); setEditError(null); }}
        />
      )}

      {/* 事件流 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-1">
          <Bot size={12} />
          <span>群聊已创建 · @提及成员、或直接发言（默认全员回应）</span>
        </div>
        {events.map((ev) => {
          if (ev.kind === KIND_USER) {
            return (
              <div key={ev.seq} className="flex justify-end">
                <div className="max-w-[85%] bg-user-bubble text-foreground border border-user-bubble-border rounded-2xl rounded-br-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm">
                  {String(ev.payload.text ?? '')}
                </div>
              </div>
            );
          }
          if (ev.kind === KIND_MEMBER) {
            const handle = String(ev.actor.handle || ev.actor.id || '');
            const display = memberByHandle[handle] || handle;
            return (
              <div key={ev.seq} className="flex flex-col items-start">
                <span className="text-[11px] text-muted-foreground mb-0.5 px-1">@{handle} · {display}</span>
                <div className="max-w-[85%] bg-card text-card-foreground border border-[var(--ui-stroke-tertiary)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm">
                  {String(ev.payload.text ?? '')}
                </div>
              </div>
            );
          }
          if (ev.kind === 'room.stop_requested') {
            return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground py-0.5">— 讨论已停止 —</div>;
          }
          if (ev.kind === 'room.disbanded') {
            return <div key={ev.seq} className="text-center text-[11px] text-destructive py-0.5">— 群聊已解散 —</div>;
          }
          // 🔴 2026-09-04 turn 终态四分：缺席/取消/轮转中对用户可见（闭环感知）
          if (ev.kind === 'turn.started') {
            const h = String(ev.actor.handle || ev.actor.id || '');
            return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/60 py-0.5">· @{h} 发言中…</div>;
          }
          if (ev.kind === 'turn.deferred') {
            const h = String(ev.actor.handle || ev.actor.id || '');
            return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/70 py-0.5">— @{h} 暂时缺席 —</div>;
          }
          if (ev.kind === 'turn.failed') {
            // 🔴 2026-09-04 失败可见（此前渲染 null——成员模型调用失败用户
            // 完全无感，是"没反应"体验的直接来源之一）
            const h = String(ev.actor.handle || ev.actor.id || '');
            const rc = String(ev.payload.reason_code || 'error');
            const msg = String(ev.payload.error || '').slice(0, 80);
            return (
              <div key={ev.seq} className="text-center text-[11px] text-destructive/80 py-0.5">
                — @{h} 发言失败（{rc}）{msg ? `：${msg}` : ''} —
              </div>
            );
          }
          if (ev.kind === 'turn.cancelled') {
            const h = String(ev.actor.handle || ev.actor.id || '');
            return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/70 py-0.5">— @{h} 的发言已随停止取消 —</div>;
          }
          return null; // turn.settled/failed/room.created 不渲染（信息在气泡与状态行里）
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入区（@ 提及对齐 Hermes GroupMentionInput） */}
      <div className="relative flex items-center gap-2 px-3 py-2.5 border-t border-[var(--ui-stroke-tertiary)] shrink-0">
        {error && (
          <div className="absolute bottom-14 left-3 right-3 px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
          </div>
        )}
        <MentionTextarea
          members={room.members}
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          placeholder={`发消息到「${room.name}」… 输入 @ 唤起成员`}
        />
        <button
          className="p-2 rounded-full bg-accent text-accent-foreground disabled:opacity-40"
          disabled={!draft.trim() || sending}
          onClick={send}
          title="发送"
        >
          <Send size={14} />
        </button>
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
  const match = /(^|\s)@([a-z0-9._-]*)$/i.exec(upto);
  if (!match) return null;
  return { query: match[2].toLowerCase(), start: caret - match[2].length - 1 };
}

function MentionTextarea({
  members,
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  members: BotRoom['members'];
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [token, setToken] = useState<MentionToken | null>(null);
  const [selected, setSelected] = useState(0);

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
    <div className="relative min-w-0 flex-1">
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-64 overflow-y-auto rounded-md border border-[var(--ui-stroke-tertiary)] bg-popover text-popover-foreground py-1 shadow-lg">
          {options.map((option, index) => (
            <button
              key={option.handle}
              className={cn(
                'flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs',
                index === active ? 'bg-accent/50 text-foreground' : 'text-muted-foreground',
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
        className="max-h-40 min-h-[36px] w-full resize-none px-3 py-2 rounded-xl bg-accent/30 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        onBlur={() => setToken(null)}
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
  room, bots, editName, setEditName, error, onSave, onClose,
}: {
  room: BotRoom;
  bots: BotRosterEntry[];
  editName: string;
  setEditName: (v: string) => void;
  error: string | null;
  onSave: (addProfiles: string[], removeMemberIds: string[]) => void;
  onClose: () => void;
}) {
  const [pendingRemove, setPendingRemove] = useState<string[]>([]);
  const [pendingAdd, setPendingAdd] = useState<string[]>([]);
  const nextCount = room.members.length - pendingRemove.length + pendingAdd.length;
  const canSave = nextCount >= 1 && nextCount <= 6;

  const addable = bots.filter(
    (b) => !room.members.some((m) => m.profile === b.profile) && !pendingAdd.includes(b.profile),
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
          {addable.map((b) => (
            <div key={b.profile} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-accent/30">
              <span className="text-sm text-muted-foreground">@{b.handle} · {b.display_name}</span>
              <button
                className="p-1 rounded hover:bg-accent/50"
                title="添加成员"
                onClick={() => setPendingAdd((cur) => [...cur, b.profile])}
              >
                <UserPlus size={13} className="text-foreground" />
              </button>
            </div>
          ))}
        </div>

        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex items-center justify-between">
          <span className={cn('text-xs', canSave ? 'text-muted-foreground' : 'text-destructive')}>
            成员 {nextCount}/1-6
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
