/**
 * AgentsPanel — Agent 侧边页（**三段版式**，2026-09-16 round-116 P4 整合定案）。
 *
 * 版式（自上而下，老大拍板）：
 *   ① Agent 卡片区 —— 单击 = 切身份（现状语义不变；身份档案：model/provider/技能数）
 *   ② 项目区     —— 当前 Agent 的项目树（per-profile，切身份自动换）
 *   ③ 群聊区     —— 房间行 → 进房间视图
 *
 * 🔴 2026-10-22 任务 B（用户定案，交接文档 §4-B）：**删除独立「私聊」分组**。
 *   私聊不是特殊物件，就是 HOME 项目下的一条 canonical 会话（ProjectTreePanel 里
 *   置顶 + 气泡图标）；它的点击链走 App.handleOpenBotChat（bot 域登记），
 *   与旧私聊入口同一条链——重复的第二个视图已两次被否，不再重建。
 *
 * 高度：三段各自有界（卡片 max 38% / 项目 flex-1 / 群聊区 max 45%），
 * 群聊分组可折叠（localStorage 持久化）——260px 栏内不出现双滚动条。
 *
 * 数据流（沿用原有受控单向流）：ProfilePanel / ProjectTreePanel 仍由 SidePanel
 * 透传 App 下发的 props；本组件只增加第③段的编排与回调。
 */
import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import * as storage from '../utils/storage';
import ProfilePanel from './ProfilePanel';
import ProjectTreePanel from './ProjectTreePanel';
import AgentPanelToolbar from './bots/AgentPanelToolbar';
import RoomCreateDialog from './bots/RoomCreateDialog';
import RoomListSection from './bots/RoomListSection';
import { getPluginHost } from '../contrib/host';
import type { AgentEditTarget } from '../contrib/host';
import { useAgentPanelFilters, type AgentPanelFilterState } from '../hooks/useAgentPanelData';
import { gatewayOptions } from '../lib/roster-filter';
import { refreshRooms, selectRoom, useRooms, useUnionRoster } from '../plugins/bots/state';

interface AgentsPanelProps {
  currentProfile?: string;
  currentProfileLabel?: string;
  /** App.handleOpenBotChat —— 收 session id（登记 bot 域 + 切视图 + 切会话） */
  onOpenBotChat?: (sessionId: string) => void;
  /** 🔴 2026-10-22：私聊分组移除后本面板不再消费（远端 Agent 编辑入口随分组退役）。
   *  字段保留仅为维持 SidePanel/App 的既有传参契约，不参与渲染。 */
  onEditAgentTarget?: (target: AgentEditTarget) => void;
  /** 本机 Agent 编辑（旧入口，仅传名字；无 onEditAgentTarget 时兜底） */
  onEditAgent?: (name: string) => void;
  [key: string]: unknown;
}

const COLLAPSE_KEY = 'eleve.agentPanel.sections.v1';

interface CollapseState {
  rooms: boolean;
}

function loadCollapse(): CollapseState {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CollapseState>;
      return { rooms: Boolean(parsed.rooms) };
    }
  } catch {
    /* 存储禁用/损坏 → 默认全展开 */
  }
  return { rooms: false };
}

export default function AgentsPanel(props: AgentsPanelProps) {
  const { onOpenBotChat, ...rest } = props;

  // 筛选态：Agent + 群聊**共用一套**（工具栏只有一条）⇒ 在面板层持有
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
  // 🔴 2026-10-22：Agent 卡片区可折叠（默认展开；持久化到 localStorage）
  const [agentsCollapsed, setAgentsCollapsed] = useState<boolean>(
    () => storage.load('agents_panel_collapsed', false) === true,
  );
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
  const [banner, setBanner] = useState<{ kind: 'error' | 'notice'; text: string } | null>(null);

  const onError = useCallback((text: string) => setBanner({ kind: 'error', text }), []);
  const onNotice = useCallback((text: string) => setBanner({ kind: 'notice', text }), []);

  /** 房间行 → 主区房间视图 */
  const handleOpenRoomView = useCallback(() => {
    getPluginHost()?.openView('bots');
  }, []);

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* ── ① Agent 卡片区（自然高度；max-h-[38%] 仅极端保护，超限内部滚动） ──
          🔴 2026-10-22：加可折叠（本地持久化）。Agent 区常驻 38% 高度对"以聊天为主"
          的用户是浪费——收起后空间直接给项目/会话，需要切身份时展开即可。 */}
      <div className={cn('flex flex-col min-h-0 shrink-0', !agentsCollapsed && 'max-h-[38%]')}>
        <button
          type="button"
          onClick={() => {
            const next = !agentsCollapsed;
            setAgentsCollapsed(next);
            storage.save('agents_panel_collapsed', next);
          }}
          className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          title={agentsCollapsed ? '展开 Agent 列表' : '收起 Agent 列表（把空间让给项目/会话）'}
          aria-expanded={!agentsCollapsed}
        >
          {agentsCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          Agents
        </button>
        {!agentsCollapsed && <ProfilePanel {...rest} />}
      </div>

      {/* ── ② 项目区（flex-1 = 卡片区决定的剩余空间） ──
          🔴 2026-10-22 任务 A：onOpenBotChat 显式下发——HOME 桶里的 canonical
          Bot Chat 行点击必须走 bot 域登记链（{...rest} 不含它，它被解构掉了）。 */}
      <div className="flex-1 min-h-0 flex flex-col border-t border-[var(--ui-stroke-tertiary)]">
        <ProjectTreePanel {...rest} onOpenBotChat={onOpenBotChat} />
      </div>


      {/* ── ③ 群聊区（有界 + 内部滚动；可折叠） ── */}
      <div className="shrink-0 max-h-[45%] flex flex-col min-h-0 border-t border-[var(--ui-stroke-tertiary)]">
        <AgentPanelToolbar
          filters={filters}
          gatewayChoices={gatewayChoices}
          itemCount={itemCount}
          onPatch={filtersApi.patch}
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
            // 建房即进房（对齐旧面板 onCreated → openGroupChat）。
            // 🔴 2026-10-22 自审：先刷新房间 store 再进房——主区靠 rooms 里找房间，
            // 只依赖 WS created 事件时（事件丢失/尚未到达）会先撞"请选择群聊"空态。
            void refreshRooms()
              .catch(() => undefined)
              .finally(() => {
                selectRoom(roomId);
                handleOpenRoomView();
              });
          }}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}
