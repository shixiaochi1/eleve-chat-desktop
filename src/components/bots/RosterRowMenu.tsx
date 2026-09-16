/**
 * RosterRowMenu — 私聊分组行的右键菜单（编辑 / 复制 / 置顶 / 隐藏）。
 *
 * 🔴 2026-09-16 round-116 P2b（Agent 面板整合）：从旧 `components/BotsPane.tsx`
 * （`:1023-1093`）迁出，行为逐条保持：
 *   - **远端行也开放编辑**（round-112：编辑链已路由化，每条 `profiles.*` 骑 owner
 *     连接；种子读数随行带过去，避免同名远端行显示成本机的昵称/颜色）
 *   - 置顶 / 隐藏写**服务端**偏好（`profiles.set_roster_prefs`）
 *   - 隐藏只影响展示（tooltip 已写明：仍可 @提及、仍在群里、私聊不断）
 *
 * 菜单定位：`fixed` + 纵向夹紧（`min(y, innerHeight - 90)`），与旧实现一致。
 */
import { useState } from 'react';
import { Copy, EyeOff, Pencil, Pin } from 'lucide-react';

import type { AgentEditTarget } from '../../contrib/host';
import { duplicateRosterAgent, setRosterPrefs } from '../../lib/roster-row-actions';
import type { UnionRosterRow } from '../../plugins/bots/state';

export interface RosterRowMenuProps {
  row: UnionRosterRow;
  x: number;
  y: number;
  /** 关闭菜单（点任一菜单项或点外部） */
  onClose: () => void;
  onEditAgent?: (target: AgentEditTarget) => void;
  /** 失败提示（复制 / 偏好写入） */
  onError?: (message: string) => void;
  /** 成功提示（复制完成 / 偏好已写） */
  onNotice?: (message: string) => void;
}

export default function RosterRowMenu({
  row,
  x,
  y,
  onClose,
  onEditAgent,
  onError,
  onNotice,
}: RosterRowMenuProps) {
  const [duplicating, setDuplicating] = useState(false);

  const runDuplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const name = await duplicateRosterAgent(row);
      onClose();
      onNotice?.(`已创建 ${name} —— ${row.entry.profile} 的完整副本（配置 / skills / SOUL 与外观；不含聊天记录）`);
    } catch (e) {
      onClose();
      onError?.(`复制 Agent 失败：${(e as Error).message}`);
    } finally {
      setDuplicating(false);
    }
  };

  const runPrefs = async (patch: { pinned?: boolean; hidden?: boolean }) => {
    try {
      await setRosterPrefs(row, patch);
      onClose();
    } catch (e) {
      onClose();
      onError?.(`设置展示偏好失败：${(e as Error).message}`);
    }
  };

  return (
    <div
      className="fixed z-50 min-w-36 rounded-lg border border-[var(--ui-stroke-tertiary)] bg-popover text-popover-foreground py-1 shadow-xl"
      style={{ left: x, top: Math.min(y, window.innerHeight - 90) }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 text-left"
        role="menuitem"
        onClick={() => {
          onEditAgent?.({
            profile: row.entry.profile,
            connectionId: row.isRemote ? row.connectionId : null,
            displayName: row.entry.display_name ?? null,
            color: row.entry.color ?? null,
            avatarKey: row.entry.avatar_key ?? null,
          });
          onClose();
        }}
      >
        <Pencil size={13} className="text-muted-foreground" />
        编辑 Agent
      </button>

      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 text-left disabled:opacity-50"
        role="menuitem"
        disabled={duplicating}
        onClick={() => void runDuplicate()}
      >
        <Copy size={13} className="text-muted-foreground" />
        {duplicating ? '正在复制…' : '复制 Agent'}
      </button>

      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 text-left"
        role="menuitem"
        onClick={() => void runPrefs({ pinned: !row.entry.pinned })}
      >
        <Pin size={13} className="text-muted-foreground" />
        {row.entry.pinned ? '取消置顶' : '置顶'}
      </button>

      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50 text-left"
        role="menuitem"
        title="隐藏只影响展示——仍可 @提及、仍在群里、私聊不断"
        onClick={() => void runPrefs({ hidden: !row.entry.hidden })}
      >
        <EyeOff size={13} className="text-muted-foreground" />
        {row.entry.hidden ? '取消隐藏' : '隐藏'}
      </button>
    </div>
  );
}
