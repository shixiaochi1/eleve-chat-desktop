/**
 * 🔴 2026-10-25：HOME 私聊行的 **bot 专属菜单项**（置顶 / 隐藏 / 编辑 / 复制）。
 *
 * 此前这些动作只在已卸载的 `PrivateChatRow` + `RosterRowMenu` 里，HOME 的私聊
 * 行只有通用会话菜单（重命名/归档/删除）——用户找不到 Agent 级的展示偏好。
 * 现在作为菜单项插进会话行现有的 Dropdown，不额外加一个按钮。
 *
 * 行数据 = union roster store（`useBotLastMessage`/未读轮询同源）；只认本机连接。
 */
import { Copy, EyeOff, Pencil, Pin } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { useUnionRoster } from '../../plugins/bots/state';
import { LOCAL_CONNECTION_ID } from '../../services/bot-relay';
import { duplicateRosterAgent, setRosterPrefs } from '../../lib/roster-row-actions';
import { getPluginHost } from '../../contrib/host';
import { notifyError, notifyInfo } from '../../utils/notifications';

export default function BotRosterMenuItems({ profile }: { profile: string }) {
  const union = useUnionRoster();
  const row = union.find(
    (r) => r.connectionId === LOCAL_CONNECTION_ID && r.entry.profile === profile,
  );
  // roster 首帧未到 / 该 Agent 已删除：不渲染（菜单其余项仍可用）
  if (!row) return null;

  const pinned = row.entry.pinned === true;
  const hidden = row.entry.hidden === true;

  const runPrefs = async (patch: { pinned?: boolean; hidden?: boolean }) => {
    try {
      await setRosterPrefs(row, patch);
    } catch (e) {
      notifyError(e, '设置 Agent 展示偏好失败');
    }
  };

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void runPrefs({ pinned: !pinned })}>
        <Pin size={12} className="shrink-0" />
        <span className="flex-1">{pinned ? '取消置顶 Agent' : '置顶 Agent'}</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void runPrefs({ hidden: !hidden })}>
        <EyeOff size={12} className="shrink-0" />
        <span className="flex-1">{hidden ? '取消隐藏 Agent' : '隐藏 Agent'}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          // 与 Agent 卡片/旧私聊行同一编辑入口（host 晚绑定；未就绪时无操作）
          getPluginHost()?.openAgentEditor({ profile });
        }}
      >
        <Pencil size={12} className="shrink-0" />
        <span className="flex-1">编辑 Agent 资料</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          void (async () => {
            try {
              const name = await duplicateRosterAgent(row);
              notifyInfo(`已创建 ${name}（配置/skills/外观副本，不含聊天记录）`);
            } catch (e) {
              notifyError(e, '复制 Agent 失败');
            }
          })();
        }}
      >
        <Copy size={12} className="shrink-0" />
        <span className="flex-1">复制 Agent</span>
      </DropdownMenuItem>
    </>
  );
}
