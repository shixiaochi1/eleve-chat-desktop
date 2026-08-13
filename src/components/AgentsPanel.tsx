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
 *   - 之前 v2-v9 的"JS 测量高度 + 显式 height + MO 观察 + 过渡动画"全是过度工程：
 *     测量滞后/同值冻结/误触发反而引入抖动（v8 同值冻结 1 卡、MO 误触发推项目区）
 *
 * 数据流（受控单向流，不重复造轮子）：
 *   - Agent 卡片复用 ProfilePanel（高亮权威源 = App.currentProfile prop）
 *   - 项目区复用 ProjectTreePanel（projects.* RPC per-profile 路由，切 Agent 自动重拉）
 *   - 所有 props 由 SidePanel 透传（App 下发），本组件只做布局组合
 */
import ProfilePanel from './ProfilePanel';
import ProjectTreePanel from './ProjectTreePanel';
import { useEffect, useLayoutEffect, useRef } from 'react';

interface AgentsPanelProps {
  currentProfile?: string;
  currentProfileLabel?: string;
  [key: string]: unknown;
}

export default function AgentsPanel(props: AgentsPanelProps) {
  // 🔴 TEMP-DIAG4（抖动排查 v2）：切 Agent 后 30 帧监控 **AgentsPanel 根高度 + 项目区高度**
  //（区分：根高度变 = 父容器压缩；根恒定但项目区小 = AgentsPanel 内部 flex 布局问题）
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frames: string[] = [];
    let raf = 0;
    const tick = () => {
      const root = rootRef.current;
      const proj = root?.querySelector('[data-proj-area]');
      frames.push((root ? Math.round(root.getBoundingClientRect().height) : -1) + 'r/' + (proj ? Math.round(proj.getBoundingClientRect().height) : -1) + 'p');
      if (frames.length < 30) raf = requestAnimationFrame(tick);
      else console.log('[DIAG4] profile=' + props.currentProfile, frames.join(' '));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.currentProfile]);

  // 🔴 TEMP-DIAG5（抖动排查）：**每次渲染**打印上部高度——抓中间态撑高帧
  useLayoutEffect(() => {
    console.log('[DIAG5] profile=' + props.currentProfile + ' agentH=' + Math.round(diagRef.current?.getBoundingClientRect().height ?? -1) + ' count=' + (props.agentCount ?? -1));
  });

  // 🔴 TEMP-DIAG（抖动排查 v12）：精确测**分割线**（上部容器 bottom）+ 项目区顶部
  const diagRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!diagRef.current) return;
    const r = diagRef.current.getBoundingClientRect();
    const list = diagRef.current.querySelector<HTMLElement>('[data-agent-list]');
    console.log('[DIAG] profile=' + props.currentProfile, JSON.stringify({
      dividerY: Math.round(r.bottom), // 分割线 Y（项目区起点）
      agentH: Math.round(r.height),
      listScrollH: list?.scrollHeight ?? -1, listClientH: list?.clientHeight ?? -1,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.currentProfile]);

  return (
    <div ref={rootRef} className="flex flex-col h-full min-h-0">
      {/* ── 上部：Agent 卡片（自然高度自动对齐；max-h-[42%] 仅极端保护——
          超限时 ProfilePanel 列表区内部滚动，不挤没项目区） ── */}
      <div ref={diagRef} className="flex flex-col min-h-0 max-h-[42%]">
        <ProfilePanel {...props} />
      </div>

      {/* ── 分割线 ── */}
      <div className="border-t border-border shrink-0" />

      {/* ── 下部：项目区（flex-1 = Agent 区决定的剩余空间，无固定占比概念） ── */}
      <div data-proj-area className="flex-1 min-h-0 flex flex-col">
        <ProjectTreePanel {...props} />
      </div>
    </div>
  );
}
