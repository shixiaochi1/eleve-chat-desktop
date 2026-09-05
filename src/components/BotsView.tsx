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
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { ArrowLeft, Bot, Loader, Paperclip, Send, Settings2, Square, Trash2, UserPlus, UserMinus, X } from 'lucide-react';
import {
  changeBotRoomMembers, disbandBotRoom, fetchBotRoomEvents,
  fetchBotRooms, renameBotRoom, sendBotRoomMessage,
  stopBotRoom,
  type BotRosterEntry, type BotRoom, type BotRoomEvent, type RoomAttachmentDraft,
} from '../utils/api';
import { getWsClient } from '../services/ws-client';
import { useSelectedRoomId, selectRoom } from '../plugins/bots/state';
import { fetchUnionRoster, type UnionRosterRow } from '../services/bot-relay';
import { ingestBotRoster, markBotRead, useBotUnread } from '../hooks/useBotUnread';

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

/** 🔴 2026-09-05 round-50：图片降采样缩略图（canvas 长边 320 / jpeg 0.6——
 * 对齐 Hermes group-attachments downscale；控制事件 payload 体积） */
async function makeImageThumb(dataUrl: string): Promise<string | undefined> {
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => res(null);
      img.onerror = () => rej(new Error('image load failed'));
      img.src = dataUrl;
    });
    const scale = Math.min(1, 320 / Math.max(img.width || 1, img.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return undefined;
  }
}

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
  const [room, setRoom] = useState<BotRoom | null>(null);
  const [localBots, setLocalBots] = useState<BotRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // 房间元信息 + 名册（自持加载——主区不依赖侧栏挂载）
  useEffect(() => {
    if (!selectedRoomId) {
      setRoom(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchBotRooms(), fetchUnionRoster()])
      .then(([roomList, unionRows]) => {
        if (cancelled) return;
        setRoom(roomList.find((r) => r.room_id === selectedRoomId) ?? null);
        setLocalBots(unionRows.filter((r) => !r.isRemote).map((r) => r.entry));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedRoomId]);

  // 🔴 2026-09-05 P3-4：房间元信息事件刷新——此前 room 对象仅在切换房间时
  // 拉取一次，其他端改名/改成员/解散后本端视图陈旧（发消息才报错可见）。
  // 元信息类事件（members_changed/renamed/disbanded——P2-1 修复后解散事件
  // 必达）触发重新拉取房间列表；解散 → room=null 回空态。
  useEffect(() => {
    if (!selectedRoomId) return;
    const ws = getWsClient();
    const unsubscribe = ws.addEventListener((eventName, data) => {
      if (eventName !== 'bot.room.event') return;
      const payload = data as { room_id?: string; event?: { kind?: string } };
      if (payload?.room_id !== selectedRoomId) return;
      const kind = payload.event?.kind || '';
      if (kind !== 'room.members_changed' && kind !== 'room.renamed' && kind !== 'room.disbanded') return;
      void fetchBotRooms()
        .then(list => setRoom(list.find(r => r.room_id === selectedRoomId) ?? null))
        .catch(() => { /* 下次切换/事件兜底 */ });
    });
    return unsubscribe;
  }, [selectedRoomId]);

  // 🔴 事件流刷新：房间事件由 WS 推送增量（BotsRoomView 内部订阅），但
  // 选中切换时需要重置内部状态——BotsRoomView 以 room 对象为 key 重挂。
  const handleClose = useCallback(() => selectRoom(null), []);

  if (loading) {
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
      bots={localBots}
      onBack={handleClose}
    />
  );
}

// ── 花名册单行（提取组件：未读点需 useBotUnread 订阅，hook 不能进 map） ──
// 未读点视觉语义对齐 SessionStatusDot 的 unread 变体（bg-success 稳态点）；
// 活动权威 = canonical Bot Chat（行点击打开的就是它，点与会话永不描述两回事）。
// 🔴 stage-3 UNION 行：远端行带连接标记（🏷 connectionLabel），拉取失败行
// 降级 ghost（opacity + 不可达提示），不消失（对齐 Hermes annotateBotSource）。
export function BotRosterRow({ row, onOpen, onRowMenu }: {
  row: UnionRosterRow;
  onOpen: () => void;
  onRowMenu: (x: number, y: number) => void;
}) {
  const bot = row.entry;
  // 🔴 2026-09-05 round-54：未读键 = canonical_session_id ?? profile（与
  // useBotUnread.ingest 同一公式）——union 远端行的同名 profile 不再与本地
  // 行共用水位线；preview identity = click identity（锚定的就是行点击打开的会话）。
  const unread = useBotUnread(bot.canonical_session_id || bot.profile);
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left',
        !row.reachable && 'opacity-40',
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
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold text-white"
        style={{ background: bot.color || 'var(--accent)' }}
      >
        {(bot.display_name || bot.handle).slice(0, 1).toUpperCase()}
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
      const data = await new Promise<string | null>((done) => {
        const reader = new FileReader();
        reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => done(null);
        reader.readAsDataURL(f);
      });
      if (!data) continue;
      const kind: RoomAttachmentDraft['kind'] = /^image\//.test(f.type || '')
        ? 'image'
        : (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) ? 'pdf' : 'file';
      let thumb: string | undefined;
      if (kind === 'image') thumb = await makeImageThumb(data);
      picked.push({ name: f.name || 'file', kind, thumb, data });
    }
    if (picked.length) setAttachments((cur) => [...cur, ...picked].slice(0, 4));
  }, [attachments.length]);

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || sending) return;
    setSending(true);
    const snapshot = draft;
    const snapshotAtts = attachments;
    setDraft('');
    setAttachments([]);
    try {
      await sendBotRoomMessage(room.room_id, text || '（附件）', undefined, snapshotAtts);
      await refresh();
    } catch (e) {
      // 🔴 2026-09-04 发送失败必须可见（此前静默吞错——用户"发消息没反应"）
      setError(`发送失败：${(e as Error).message}`);
      setDraft(snapshot); // 恢复草稿
      setAttachments(snapshotAtts);
    } finally {
      setSending(false);
    }
  };

  // 🔴 2026-09-05 round-49：讨论进行中推导（对齐主输入区 isStreaming 语义）
  // ——事件流里最后一个 turn.* 若是 turn.started（未配对终态）= 成员轮在跑，
  // 发送键切停止态（对齐 Hermes 群聊视图的运行态指示）
  const roomBusy = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const k = events[i].kind;
      if (k === 'turn.started') return true;
      if (k.startsWith('turn.')) return false;
    }
    return false;
  }, [events]);

  const stopRoom = async () => {
    setBusy(true);
    try { await stopBotRoom(room.room_id); await refresh(); } finally { setBusy(false); }
  };

  const disband = async () => {
    // 🔴 2026-09-05 round-48：解散是永久墓碑（Hermes disband 同义）——
    // 二次确认防误触（此前单击直调，事件流与成员会话随之不可恢复）
    if (!window.confirm(`确定解散群聊「${room.name}」？此操作不可恢复。`)) return;
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
        {/* 🔴 2026-09-05 round-48：渲染窗口上限（对齐 Hermes GROUP_CHAT_HISTORY_LIMIT
            的窗口化思路；长房间事件流不无限增长 DOM）——完整日志仍在后端 */}
        {events.slice(-200).map((ev) => {
          if (ev.kind === KIND_USER) {
            // 🔴 2026-09-05 round-50：附件渲染（图片缩略图 / 文件徽标——
            // 对齐 Hermes 群聊"members are shown"的附件展示）
            const atts = Array.isArray(ev.payload.attachments) ? (ev.payload.attachments as Array<{ name?: string; kind?: string; thumb?: string }>) : [];
            return (
              <div key={ev.seq} className="flex justify-end">
                <div className="max-w-[85%] bg-user-bubble text-foreground border border-user-bubble-border rounded-2xl rounded-br-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm select-text">
                  {atts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {atts.map((a, i) =>
                        a.thumb ? (
                          <img key={i} src={a.thumb} alt={a.name || 'attachment'} className="h-20 rounded-lg border border-black/10" />
                        ) : (
                          <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-black/10 text-[10px]">
                            📎 {a.name || 'file'}
                          </span>
                        ),
                      )}
                    </div>
                  )}
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
                <span className="text-[11px] text-muted-foreground mb-0.5 px-1 select-text">@{handle} · {display}</span>
                <div className="max-w-[85%] bg-card text-card-foreground border border-[var(--ui-stroke-tertiary)] rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm select-text">
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
          // 🔴 2026-09-05 round-53：turn.started 不再渲染（用户实测刷屏——
          // 每个成员发言前都有一条"· @ 发言中"，且 gateway actor 无 handle
          // 显示为空 @；成员发言气泡本身就是"已回应"指示，轮转状态由
          // roomBusy 双态键表达）。事件保留在日志供审计。
          if (ev.kind === 'turn.started') {
            return null;
          }
          if (ev.kind === 'turn.held') {
            const h = String(ev.actor.handle || ev.actor.id || '');
            const byId = (Array.isArray(room.members) ? room.members : []).find(m => m.member_id === ev.payload.member_id);
            const label = byId ? `@${byId.handle}` : `@${h}`;
            return <div key={ev.seq} className="text-center text-[11px] text-muted-foreground/70 py-0.5">— {label} 的发言已暂停 —</div>;
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

      {/* 输入区（@ 提及对齐 Hermes GroupMentionInput；附件对齐 group-attachments） */}
      <div
        className="relative flex flex-col border-t border-[var(--ui-stroke-tertiary)] shrink-0"
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void addFiles(e.dataTransfer?.files); }}
      >
        {error && (
          <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
          </div>
        )}
        {/* 🔴 round-50：附件预览条 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
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
                  onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                  title="移除附件"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* 🔴 2026-09-05 round-59：输入框 UI 1:1 对齐主消息区 InputArea——
            两行形态（输入在上/控制行在下）+ rounded-2xl border 容器 +
            composer 高度/内边距/控制尺寸变量全套（此前单行横排形态与主区不同） */}
        <div className="composer-surface relative mx-3 mb-2.5 rounded-2xl border">
          <div className="flex flex-col gap-(--composer-row-gap) px-(--composer-surface-pad-x) py-(--composer-surface-pad-y)">
            <MentionTextarea
              members={room.members}
              value={draft}
              onChange={setDraft}
              onSubmit={send}
              onPaste={(e) => { const fs = e.clipboardData?.files; if (fs?.length) { e.preventDefault(); void addFiles(fs); } }}
              placeholder={`发消息到「${room.name}」… 输入 @ 唤起成员，可粘贴/拖入附件`}
            />
            {/* 控制行 — 对齐主输入区：附件在左，发送/停止双态键 ml-auto 在右 */}
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
              />
              <button
                className="inline-flex size-(--composer-control-size) shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => fileInputRef.current?.click()}
                title="添加附件（≤15MB，最多 4 个）"
                disabled={sending || roomBusy}
              >
                <Paperclip size={16} />
              </button>
              {/* 发送/停止双态键（对齐主输入区形态：黑底白箭头/白底黑箭头，
                  停止态小方块接房间级 stopBotRoom） */}
              <button
                className={cn(
                  'ml-auto inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full p-0 outline-none transition-all duration-150',
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
        className="max-h-(--composer-input-max-height) min-h-(--composer-input-min-height) w-full resize-none border-0 bg-transparent px-1 pb-0.5 pt-1 text-sm leading-normal text-foreground outline-none placeholder:text-muted-foreground/60 focus:ring-0"
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
  // 🔴 2026-09-05 round-48：与创建场景统一为 2-6（后端 MIN/MAX_DISCUSSION_MEMBERS
  // 硬约束——此前编辑允许删到 1 人，存盘后房间无法驱动）
  const canSave = nextCount >= 2 && nextCount <= 6;

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
