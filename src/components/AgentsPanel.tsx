/**
 * AgentsPanel — 统一侧栏（Agent + 项目合并）
 *
 * 🔴 2026-08-12 老大指示：项目面板功能合并进 Agent 面板，消灭"Agent/项目"两个按钮来回切换。
 *   结构：
 *   上部：Agent 卡片（自然高度，上限 42%，超出内部滚动）——复用 ProfilePanel
 *   下部：项目区（flex-1）——复用 ProjectTreePanel：Home 桶（该 Agent workspace）
 *         + 项目树 + 项目内会话收纳。会话不再有独立列表区（所有会话被项目收纳，
 *         从 Home 桶/项目行展开查看）；搜索会话取消。
 *
 * 数据流（受控单向流，不重复造轮子）：
 *   - Agent 卡片复用 ProfilePanel（高亮权威源 = App.currentProfile prop）
 *   - 项目区复用 ProjectTreePanel（projects.* RPC per-profile 路由，切 Agent 自动重拉）
 *   - 所有 props 由 SidePanel 透传（App 下发），本组件只做布局组合
 */
import ProfilePanel from './ProfilePanel';
import ProjectTreePanel from './ProjectTreePanel';
import { useRef, useState } from 'react';
import { useResizeObserver } from '../hooks/use-resize-observer';

interface AgentsPanelProps {
  currentProfile?: string;
  currentProfileLabel?: string;
  [key: string]: unknown;
}

export default function AgentsPanel(props: AgentsPanelProps) {
  // 🔴 2026-08-13 自动对齐 + 平滑过渡（老大指示：固定 42% 太僵硬）：
  //   内容自然高度（scrollHeight 不受 max-height 裁剪影响）→ 显式 height +
  //   transition 300ms ease——切 Agent 时内容高度变化平滑过渡，项目区自然
  //   跟随不抖动；内容超 42% 时仍被 max-h 裁剪（ProfilePanel 列表区内部滚动）。
  //   复用既有 useResizeObserver hook（对齐 Hermes useResizeObserver），不造轮子。
  const agentAreaRef = useRef<HTMLDivElement>(null);
  const [agentContentHeight, setAgentContentHeight] = useState<number | null>(null);
  useResizeObserver(() => {
    const el = agentAreaRef.current;
    if (el && el.scrollHeight > 0) {
      setAgentContentHeight(el.scrollHeight);
    }
  }, agentAreaRef);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 上部：Agent 卡片（内容自然高度，上限 42% 内部滚动，高度变化平滑过渡） ── */}
      <div
        ref={agentAreaRef}
        className="flex flex-col min-h-0 max-h-[42%] overflow-hidden transition-[height] duration-300 ease-out"
        style={agentContentHeight ? { height: `${agentContentHeight}px` } : undefined}
      >
        <ProfilePanel {...props} />
      </div>

      {/* ── 分割线 ── */}
      <div className="border-t border-border shrink-0" />

      {/* ── 下部：项目区（Home 桶 + 项目树 + 会话收纳） ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ProjectTreePanel {...props} />
      </div>
    </div>
  );
}
