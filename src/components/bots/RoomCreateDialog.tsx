/**
 * RoomCreateDialog — 新建群聊弹层。
 *
 * 🔴 2026-09-16 round-116 P4（Agent 面板整合）：从旧 `components/BotsPane.tsx`
 * （弹层 JSX + 建群逻辑 `:486-525`）迁出，供 Agent 面板的群聊分组复用。
 *
 * 语义逐条保持：
 *   - 房间名可空 → 默认名 = 已选成员展示名拼接（placeholder 即预览，round-70）
 *   - 重名自动加「 2…」后缀（上限 60 字符，与后端 title 长度约束对齐）
 *   - 房间图可选（`RoomImageControls`；round-97 建房即可带图，round-100 支持生成）
 *   - 至少 2 个成员（`ROOM_MEMBER_MIN`），上限 `ROOM_MEMBER_MAX`
 *   - 创建成功后由父组件进房（`onCreated(roomId)` → 选中 + 主区切房间视图）
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import RoomImageControls from '../RoomImageControls';
import {
  ROOM_MEMBER_MAX,
  ROOM_MEMBER_MIN,
  memberPickLabel,
  pickableMembers,
} from '../../lib/bot-members';
import { createBotRoom } from '../../utils/api';
import { useRooms, useUnionRoster } from '../../plugins/bots/state';

export interface RoomCreateDialogProps {
  onClose: () => void;
  /** 创建成功 → 父组件进房（选中 + 主区导航） */
  onCreated: (roomId: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
}

export default function RoomCreateDialog({
  onClose,
  onCreated,
  onError,
  onNotice,
}: RoomCreateDialogProps) {
  const bots = useUnionRoster();
  const rooms = useRooms();

  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [newImage, setNewImage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const pickRows = useMemo(() => pickableMembers(bots), [bots]);
  const pickableCount = useMemo(() => pickRows.filter((r) => !r.disabled).length, [pickRows]);
  const localCount = useMemo(() => bots.filter((b) => !b.isRemote).length, [bots]);
  const remoteCount = useMemo(() => bots.filter((b) => b.isRemote).length, [bots]);

  /** 已选成员展示名——建房 fallback 名与"房间图生成"prompt 共用同一口径（round-100）。 */
  const pickedNames = useMemo(
    () =>
      newMembers
        .map((p) => pickRows.find((r) => r.profile === p))
        .map((r) => r?.displayName || '')
        .filter(Boolean),
    [newMembers, pickRows],
  );

  const submit = async () => {
    if (creating) return;
    if (newMembers.length < ROOM_MEMBER_MIN || newMembers.length > ROOM_MEMBER_MAX) return;

    const base = (newName.trim() || pickedNames.join('、')).slice(0, 40);
    if (!base) return;

    // 重名去重（与旧实现同：上限 60 字符 + 「 N」后缀）
    const taken = new Set(rooms.filter((r) => !r.disbanded_at).map((r) => r.name));
    let name = base;
    if (taken.has(name)) {
      for (let n = 2; n < 100; n++) {
        const suffix = ` ${n}`;
        const candidate = base.slice(0, 60 - suffix.length) + suffix;
        if (!taken.has(candidate)) {
          name = candidate;
          break;
        }
      }
    }

    setCreating(true);
    try {
      const room = await createBotRoom(name, newMembers, newImage);
      onNotice?.(`已创建「${name}」（${newMembers.length} 个 Agent）`);
      if (room?.room_id) {
        onCreated(room.room_id);
      } else {
        onClose();
      }
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-xl border border-[var(--ui-stroke-tertiary)] bg-[var(--ui-card-bg)] p-4 space-y-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">新建群聊</span>
          <button className="p-1 rounded hover:bg-accent/50" onClick={onClose} title="关闭">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={pickedNames.join('、').slice(0, 40) || '群聊名称（可空）'}
          className="w-full px-2.5 py-1.5 rounded-md bg-accent/30 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
        />

        <RoomImageControls
          image={newImage}
          onImage={setNewImage}
          name={newName}
          memberHandles={pickedNames}
        />

        <div className="max-h-44 overflow-y-auto space-y-1">
          {pickableCount < ROOM_MEMBER_MIN && (
            <div className="text-xs text-muted-foreground px-2 py-1.5">
              当前可选 Agent 只有 {pickableCount} 个（本机 {localCount}
              {remoteCount > 0 ? ` · 远端 ${remoteCount}` : ''}）——群聊至少需要 {ROOM_MEMBER_MIN} 个。
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
                  onChange={() =>
                    setNewMembers((cur) =>
                      checked ? cur.filter((p) => p !== row.profile) : [...cur, row.profile],
                    )
                  }
                  className="accent-[var(--accent)]"
                />
                <span className="text-sm text-foreground truncate">{row.displayName}</span>
                <span className="text-xs text-muted-foreground shrink-0">{memberPickLabel(row)}</span>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <span
            className={cn(
              'text-xs',
              newMembers.length >= ROOM_MEMBER_MIN && newMembers.length <= ROOM_MEMBER_MAX
                ? 'text-muted-foreground'
                : 'text-destructive',
            )}
          >
            已选 {newMembers.length}/{ROOM_MEMBER_MIN}-{ROOM_MEMBER_MAX}
          </span>
          <button
            className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-40"
            disabled={
              newMembers.length < ROOM_MEMBER_MIN ||
              newMembers.length > ROOM_MEMBER_MAX ||
              creating
            }
            onClick={() => void submit()}
          >
            {creating ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
