/**
 * AgentsPanel — Agent 侧边页（**三段版式**，2026-09-16 round-116 P4 整合定案）。
 *
 * 版式（自上而下，老大拍板）：
 *   ① Agent 卡片区 —— 单击 = 切身份（现状语义不变；身份档案：model/provider/技能数）
 *   ② 项目区     —— 当前 Agent 的项目树（per-profile，切身份自动换）
 *   ③ 群聊 + 私聊区 —— 群聊分组（房间行 → 进房间视图）+ 私聊分组（每 Agent 一行 → 开它的常驻私聊）
 *
 * 决策依据（见 docs/agent-panel-merge-plan-20260916.md）：
 *   - 卡片与私聊**不合并**：单击卡片仍 = 切身份，私聊是独立分组（老大决策①）
 *   - 群聊 + 私聊全部收进本面板；「群聊」IconBar 按钮退役（P5）
 *   - 群聊是**跨 Agent 共享房间**（无 owner 字段）⇒ 独立分组，不挂 agent 之下；
 *     私聊是 per-Agent 一对一常驻通道 ⇒ 每 Agent 一行
 *   - 重复感抑制：卡片只做身份（无运行态徽标），私聊行只做聊天入口（活跃/未读/attention）
 *
 * 高度：三段各自有界（卡片 max 38% / 项目 flex-1 / 会话区 max 45%），
 * 群聊与私聊分组可折叠（localStorage 持久化）——260px 栏内不出现双滚动条。
 *
 * 数据流（沿用原有受控单向流）：ProfilePanel / ProjectTreePanel 仍由 SidePanel
 * 透传 App 下发的 props；本组件只增加第③段的编排与回调。
 */
import { useCallback, useMemo, useState } from 'react';
import { EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import ProfilePanel from './ProfilePanel';
import ProjectTreePanel from './ProjectTreePanel';
import AgentPanelToolbar from './bots/AgentPanelToolbar';
import PrivateChatSection from './bots/PrivateChatSection';
import RoomCreateDialog from './bots/RoomCreateDialog';
import RoomListSection from './bots/RoomListSection';
import RosterRowMenu from './bots/RosterRowMenu';
import { getPluginHost } from '../contrib/host';
import type { AgentEditTarget } from '../contrib/host';
import { useAgentPanelFilters, type AgentPanelFilterState } from '../hooks/useAgentPanelData';
import { openLocalBotChat, openRemoteBotChat } from '../lib/bot-open';
import { gatewayOptions } from '../lib/roster-filter';
import {
  selectRoom,
  useRooms,
  useUnionRoster,
  type UnionRosterRow,
} from '../plugins/bots/state';

interface AgentsPanelProps {
  currentProfile?: string;
  currentProfileLabel?: string;
  /** App.handleOpenBotChat —— 收 session id（登记 bot 域 + 切视图 + 切会话） */
  onOpenBotChat?: (sessionId: string) => void;
  /** 编辑 Agent（远端行带 connectionId，骑 owner 连接）；App 侧 = setEditTarget */
  onEditAgentTarget?: (target: AgentEditTarget) => void;
  /** 本机 Agent 编辑（旧入口，仅传名字；无 onEditAgentTarget 时兜底） */
  onEditAgent?: (name: string) => void;
  [key: string]: unknown;
}

const COLLAPSE_KEY = 'eleve.agentPanel.sections.v1';

interface CollapseState {
  rooms: boolean;
  chats: boolean;
}

function loadCollapse(): CollapseState {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CollapseState>;
      return { rooms: Boolean(parsed.rooms), chats: Boolean(parsed.chats) };
    }
  } catch {
    /* 存储禁用/损坏 → 默认全展开 */
  }
  return { rooms: false, chats: false };
}

export default function AgentsPanel(props: AgentsPanelProps) {
  const { onOpenBotChat, onEditAgentTarget, ...rest } = props;

  // 筛选态：私聊 + 群聊**共用一套**（工具栏只有一条）⇒ 在面板层持有
  const filtersApi = useAgentPanelFilters();
  const filters: AgentPanelFilterState = filtersApi.state;

  // 工具栏读数：**直接从两个 store 取，不跑编排**——编排归各分组内部
  // （避免同一份编排算两遍，也避免"面板的 rows"与"分组的 rows"落在不同帧）
  const allBots = useUnionRoster();
  const allRooms = useRooms();
  const gatewayChoices = useMemo(() => gatewayOptions(allBots), [allBots]);
  const itemCount = allBots.length + allRooms.length;
  /** 已隐藏总数（Agent + 群聊；服务端偏好字段）——统一开关只此一处（旧面板同款语义） */
  const hiddenCount = useMemo(
    () => allBots.filter((r) => r.entry.hidden).length + allRooms.filter((r) => r.hidden).length,
    [allBots, allRooms],
  );

  const [collapsed, setCollapsed] = useState<CollapseState>(loadCollapse);
  const toggleCollapse = useCallback((key: keyof CollapseState) => {
    setCollapsed((cur) => {
      const next = { ...cur, [key]: !cur[key] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* 存储禁用：仅当次生效 */
      }
      return next;
    });
  }, []);

  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [menu, setMenu] = useState<{ row: UnionRosterRow; x: number; y: number } | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);

  const onError = useCallback((text: string) => setBanner({ kind: 'error', text }), []);
  const onNotice = useCallback((text: string) => setBanner({ kind: 'notice', text }), []);

  /** 本机私聊：ensure canonical → 交给 App 的 handleOpenBotChat
   *  （**不设兜底链**：另建一条 getPluginHost().openSession 会绕过 App 的 bot 域登记
   *   `registerBotChatSession` + `setWorkspaceOwner`，同一语义两份实现必分叉） */
  const handleOpenLocalChat = useCallback(
    (profile: string) => {
      if (!onOpenBotChat) {
        console.warn('[AgentsPanel] onOpenBotChat 未注入——无法打开本机私聊');
        return;
      }
      void openLocalBotChat(profile, { onOpenBotChat, onError });
    },
    [onOpenBotChat, onError],
  );

  /** 远端私聊：骑 owner 连接 ensure → 主区切 bots 视图（承载远端会话） */
  const handleOpenRemoteChat = useCallback(
    (row: UnionRosterRow) => {
      void openRemoteBotChat(row, {
        onOpened: () => getPluginHost()?.openView('bots'),
        onError,
        onNotice,
      });
    },
    [onError, onNotice],
  );

  /** 房间行 → 主区房间视图 */
  const handleOpenRoomView = useCallback(() => {
    getPluginHost()?.openView('bots');
  }, []);

  const filtersPatch = useMemo(
    () => (patch: Partial<AgentPanelFilterState>) => {
      if (patch.query !== undefined) filtersApi.setQuery(patch.query);
      if (patch.kindFilter !== undefined) filtersApi.setKindFilter(patch.kindFilter);
      if (patch.activityFilter !== undefined) filtersApi.setActivityFilter(patch.activityFilter);
      if (patch.gatewayFilter !== undefined) filtersApi.setGatewayFilter(patch.gatewayFilter);
      if (patch.showHidden !== undefined) filtersApi.setShowHidden(patch.showHidden);
    },
    [filtersApi],
  );

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* ── ① Agent 卡片区（自然高度；max-h-[38%] 仅极端保护，超限内部滚动） ── */}
      <div className="flex flex-col min-h-0 max-h-[38%] shrink-0">
        <ProfilePanel {...rest} />
      </div>

      {/* ── ② 项目区（flex-1 = 卡片区决定的剩余空间） ── */}
      <div className="flex-1 min-h-0 flex flex-col border-t border-[var(--ui-stroke-tertiary)]">
        <ProjectTreePanel {...rest} />
      </div>

      {/* ── ③ 群聊 + 私聊区（有界 + 内部滚动；两个分组各自可折叠） ── */}
      <div className="shrink-0 max-h-[45%] flex flex-col min-h-0 border-t border-[var(--ui-stroke-tertiary)]">
        <AgentPanelToolbar
          filters={filters}
          gatewayChoices={gatewayChoices}
          itemCount={itemCount}
          onPatch={filtersPatch}
          onReset={filtersApi.reset}
        />

        {banner && (
          <div
            className={cn(
              'mx-2 mt-1 px-2.5 py-1.5 rounded-md text-xs shrink-0',
              banner.kind === 'error'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-accent/40 text-muted-foreground',
            )}
          >
            {banner.text}
            <button className="ml-2 underline hover:text-foreground" onClick={() => setBanner(null)}>
              关闭
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1.5 space-y-2">
          <RoomListSection
            filters={filters}
            onOpenRoomView={handleOpenRoomView}
            onCreateRoom={() => setShowCreateRoom(true)}
            onError={onError}
            onNotice={onNotice}
            collapsed={collapsed.rooms}
            onToggleCollapsed={() => toggleCollapse('rooms')}
          />
          <PrivateChatSection
            filters={filters}
            onOpenBotChat={handleOpenLocalChat}
            onOpenRemoteChat={handleOpenRemoteChat}
            onRowMenu={(row, x, y) => setMenu({ row, x, y })}
            collapsed={collapsed.chats}
            onToggleCollapsed={() => toggleCollapse('chats')}
          />
        </div>

        {/* 「已隐藏 N」统一入口——**一处覆盖 Agent + 群聊两组**（与旧面板同语义；
            隐藏只影响展示：隐藏的 Agent / 群聊照常工作、照常可被 @） */}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => filtersApi.setShowHidden(!filters.showHidden)}
            className="shrink-0 w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border-t border-[var(--ui-stroke-tertiary)]"
            title={`已隐藏 ${hiddenCount} 项（Agent + 群聊）`}
          >
            <EyeOff size={11} />
            {filters.showHidden ? '收起隐藏项' : `已隐藏 ${hiddenCount}`}
          </button>
        )}
      </div>

      {/* 新建群聊弹层 */}
      {showCreateRoom && (
        <RoomCreateDialog
          onClose={() => setShowCreateRoom(false)}
          onCreated={(roomId) => {
            setShowCreateRoom(false);
            // 建房即进房（对齐旧面板 onCreated → openGroupChat）
            selectRoom(roomId);
            handleOpenRoomView();
          }}
          onError={onError}
          onNotice={onNotice}
        />
      )}

      {/* 私聊行右键菜单（编辑 / 复制 / 置顶 / 隐藏） */}
      {menu && (
        <RosterRowMenu
          row={menu.row}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onEditAgent={onEditAgentTarget}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}
