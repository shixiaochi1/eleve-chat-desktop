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
import { useEffect, useRef, useState } from 'react';

interface AgentsPanelProps {
  currentProfile?: string;
  currentProfileLabel?: string;
  /** 🔴 2026-08-13 v8：Agent 数量（App agentCount 唯一持有者）——高度对齐唯一触发器 */
  agentCount?: number;
  [key: string]: unknown;
}

export default function AgentsPanel(props: AgentsPanelProps) {
  // 🔴 2026-08-13 v8（老大逻辑修正：项目区无固定占比概念 = Agent 区决定的剩余；
  //   数量不变 → 项目区完全不动）：
  //   - 触发器 = agentCount（数据源，建/删 Agent 才变）→ 切 Agent 零触发零变化
  //   - 项目区 flex-1（剩余空间，无 58/42 固定值概念）
  //   - 之前 DOM MutationObserver 方案有误触发（选中高亮条增删也属 childList 变化）
  //     + 高度测量微差 → 300ms 动画推动项目区 = “从 58 往上动”的抖动来源
  //   - 卡片等高保障（ProfilePanel 元信息行 flex-nowrap）→ 数量不变时列表总高恒不变
  const agentAreaRef = useRef<HTMLDivElement>(null);
  const [agentContentHeight, setAgentContentHeight] = useState<number | null>(null);
  useEffect(() => {
    // 仅在 agentCount 变化（建/删 Agent）时重测对齐；切 Agent 不触发
    const el = agentAreaRef.current;
    if (!el) return;
    const header = el.querySelector<HTMLElement>('[data-agent-header]');
    const list = el.querySelector<HTMLElement>('[data-agent-list]');
    const h = (header?.offsetHeight ?? 0) + (list?.scrollHeight ?? 0);
    if (h > 0) setAgentContentHeight(h);
  }, [props.agentCount]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 上部：Agent 卡片（内容自然高度，上限 42% 仅作极端保护——卡片数极多时
          不挤没项目区；数量不变 → 高度恒定 → 分割线/项目区起点不动） ── */}
      <div
        ref={agentAreaRef}
        className="flex flex-col min-h-0 max-h-[42%] overflow-hidden transition-[height] duration-300 ease-out"
        style={agentContentHeight ? { height: `${agentContentHeight}px` } : undefined}
      >
        <ProfilePanel {...props} />
      </div>

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
