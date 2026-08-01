/**
 * AgentsPanel — 统一侧栏（Agent + 会话合并）
 *
 * 以 Agent 侧边栏为基准，会话列表内嵌：
 *   上部：Agent 卡片（自然高度，上限 42%，超出内部滚动）
 *   下部：当前 Agent 的会话列表（flex-1 占满剩余空间）
 *
 * 数据流（受控单向流，不重复造轮子）：
 *   - Agent 卡片复用 ProfilePanel（高亮权威源 = App.currentProfile prop）
 *   - 会话列表复用 SessionsPanel（数据来自 useSessions，随 currentProfile 自动刷新）
 *   - 所有 props 由 SidePanel 透传（App 下发），本组件只做布局组合
 */
import ProfilePanel from './ProfilePanel';
import SessionsPanel from './SessionsPanel';

interface AgentsPanelProps {
  currentProfile?: string;
  currentProfileLabel?: string;
  [key: string]: unknown;
}

export default function AgentsPanel(props: AgentsPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 上部：Agent 卡片（自然高度，最多占 42%，超出内部滚动） ── */}
      <div className="flex flex-col min-h-0 max-h-[42%]">
        <ProfilePanel {...props} />
      </div>

      {/* ── 分割线 ── */}
      <div className="border-t border-border shrink-0" />

      {/* ── 下部：当前 Agent 的会话列表 ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        <SessionsPanel {...props} agentName={props.currentProfileLabel ?? props.currentProfile} />
      </div>
    </div>
  );
}
