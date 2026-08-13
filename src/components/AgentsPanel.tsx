/**
 * AgentsPanel — 统一侧栏（Agent + 项目合并）
 *
 * 🔴 2026-08-12 老大指示：项目面板功能合并进 Agent 面板，消灭"Agent/项目"两个按钮来回切换。
 *
 * 🔴 2026-08-13 v10（老大指正"agent 区和项目区逻辑不对"后的回归重构）：
 *   正确的逻辑 = 纯 CSS flex，零 JS 测量：
 *   - 上部 Agent 区：**自然高度**（内容驱动，自动对齐——卡片多高它就多高），
 *     max-h-[42%] 仅是极端保护（卡片极多时内部滚动，不挤没项目区）——**不是固定占比**
 *   - 下部项目区：flex-1 = **Agent 区决定的剩余空间**（无任何固定占比概念）
 *   - 切 Agent 时 Agent 数量不变 + 卡片等高保障（ProfilePanel 元信息行 flex-nowrap，
 *     禁换行）→ 上部自然高度**恒不变** → 分割线/项目区起点不动 → 零抖动
 *
 * 🔴 2026-08-14 抖动根治（配合 ProjectTreePanel）：
 *   - 真根因 = ProjectTreePanel mount effect 依赖 [fetchTree]（闭包依赖 currentProfile）
 *     → 切 Agent 重跑非 silent fetchTree → loading=true → 加载中占位与树并存（双 flex-1）
 *     → 列表被压缩 → 项目卡片跳变。已在 ProjectTreePanel 修（依赖 [] + loading 防御）。
 *
 * 数据流（受控单向流，不重复造轮子）：
 *   - Agent 卡片复用 ProfilePanel（高亮权威源 = App.currentProfile prop）
 *   - 项目区复用 ProjectTreePanel（projects.* RPC per-profile 路由，切 Agent 自动重拉）
 *   - 所有 props 由 SidePanel 透传（App 下发），本组件只做布局组合
 */
import ProfilePanel from './ProfilePanel';
import ProjectTreePanel from './ProjectTreePanel';

interface AgentsPanelProps {
  currentProfile?: string;
  currentProfileLabel?: string;
  [key: string]: unknown;
}

export default function AgentsPanel(props: AgentsPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 上部：Agent 卡片（自然高度自动对齐；max-h-[42%] 仅极端保护——
          超限时 ProfilePanel 列表区内部滚动，不挤没项目区） ── */}
      <div className="flex flex-col min-h-0 max-h-[42%]">
        <ProfilePanel {...props} />
      </div>

      {/* ── 分割线 ── */}
      <div className="border-t border-border shrink-0" />

      {/* ── 下部：项目区（flex-1 = Agent 区决定的剩余空间，无固定占比概念） ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ProjectTreePanel {...props} />
      </div>
    </div>
  );
}
