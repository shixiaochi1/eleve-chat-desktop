/**
 * BotsPanel — Bot 联动面板（Bot Mode）
 *
 * 🔴 2026-09-04 对齐 Hermes bot-mode（A2A 私信 + 群聊 Group Chat）：
 *  - Bot 花名册（bots.roster）：运行时已注册的 Agent；点击 → 打开该 bot 的
 *    canonical Bot Chat 会话（bot.chat.ensure 懒创建 → onSwitchSession）
 *  - 群聊房间（bot.rooms.*）：2-6 名 bot 回合制讨论（后端讨论引擎：
 *    @点名 / pass 沉默 / ≤3 轮 / ≤10 条），bot.room.event 实时推送
 *
 * 数据流（对齐 2026-09-01 前端架构分层）：
 *   命令 → utils/api.ts（bots 命令层）；事件 → services/ws-client 监听器；
 *   本组件只做编排与渲染，禁止散裸 call()。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowLeft, Bot, Loader, MessageSquarePlus, Send, Settings2, Square, Trash2, UserPlus, UserMinus, X } from 'lucide-react';
import {
  changeBotRoomMembers, createBotRoom, disbandBotRoom, fetchBotRoomEvents,
  fetchBotRooms, fetchBotsRoster, ensureBotChat, renameBotRoom, sendBotRoomMessage,
  stopBotRoom,
  type BotRosterEntry, type BotRoom, type BotRoomEvent,
} from '../utils/api';
import { getWsClient } from '../services/ws-client';

interface BotsPanelProps {
  /** 打开某个会话（bot 私聊入口；App 层会话切换契约，同 SessionsPanel） */
  onSwitchSession?: (id: string) => void;
  currentProfile?: string;
}

const KIND_USER = 'message.user';
const KIND_MEMBER = 'message.member';

export default function BotsPanel({ onSwitchSession }: BotsPanelProps) {
  const [bots, setBots] = useState<BotRosterEntry[]>([]);
  const [rooms, setRooms] = useState<BotRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [activeRoom, setActiveRoom] = useState<BotRoom | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const [roster, roomList] = await Promise.all([fetchBotsRoster(), fetchBotRooms()]);
      setBots(roster);
      setRooms(roomList);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

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
      if (sid && onSwitchSession) onSwitchSession(sid);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // ── 房间视图 ──
  if (activeRoom) {
    return (
      <BotsRoomView
        room={activeRoom}
        bots={bots}
        onBack={() => { setActiveRoom(null); loadList(); }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
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

        {/* ── Bot 花名册（点击开私聊） ── */}
        <section>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Agent</div>
          <div className="space-y-1">
            {bots.map((bot) => (
              <button
                key={bot.profile}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left"
                title={`打开与 @${bot.handle} 的私聊`}
                onClick={() => openBotChat(bot.profile)}
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold text-white"
                  style={{ background: bot.color || 'var(--accent)' }}
                >
                  {(bot.display_name || bot.handle).slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-foreground truncate">{bot.display_name || bot.handle}</span>
                  <span className="block text-xs text-muted-foreground truncate">@{bot.handle}</span>
                </span>
              </button>
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
            className="w-full max-w-xs rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--panel-bg,#1c1c1e)] p-4 space-y-3 shadow-xl"
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
    </div>
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
    setDraft('');
    try {
      await sendBotRoomMessage(room.room_id, text);
      await refresh();
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
                <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-br-sm bg-accent text-accent-foreground text-sm whitespace-pre-wrap break-words">
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
                <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-bl-sm bg-[var(--ui-stroke-tertiary)]/40 text-sm text-foreground whitespace-pre-wrap break-words">
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
          if (ev.kind === 'turn.cancelled') {
            const h = String(ev.actor.handle || ev.actor.id || '');
            return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/70 py-0.5">— @{h} 的发言已随停止取消 —</div>;
          }
          return null; // turn.settled/failed/room.created 不渲染（信息在气泡与状态行里）
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[var(--ui-stroke-tertiary)] shrink-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`发消息到「${room.name}」…`}
          className="flex-1 px-3 py-1.5 rounded-full bg-accent/30 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
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
        className="w-full max-w-xs rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--panel-bg,#1c1c1e)] p-4 space-y-3 shadow-xl"
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
