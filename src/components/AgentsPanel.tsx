/**
 * AgentsPanel — 统一侧栏（Agent + 项目合并）
 *
 * 🔴 2026-08-12 老大指示：项目面板功能合并进 Agent 面板，消灭"Agent/项目"两个按钮来回切换。
 *   结构：
 *   上部：Agent 卡片（内容自然高度，上限 42% 极端保护，超出内部滚动）——复用 ProfilePanel
 *   下部：项目区（flex-1 剩余空间，**无固定占比概念**——占比 = Agent 区决定的剩余）——
 *         复用 ProjectTreePanel：Home 桶（该 Agent workspace）
 *         + 项目树 + 项目内会话收纳。会话不再有独立列表区（所有会话被项目收纳，
 *         从 Home 桶/项目行展开查看）；搜索会话取消。
 *
 * 数据流（受控单向流，不重复造轮子）：
 *   - Agent 卡片复用 ProfilePanel（高亮权威源 = App.currentProfile prop）
 *   - 项目区复用 ProjectTreePanel（projects.* RPC per-profile 路由，切 Agent 自动重拉）
 *   - 所有 props 由 SidePanel 透传（App 下发），本组件只做布局组合
 *
 * 🔴 2026-08-13 v8（老大逻辑：项目区没有 58/42 固定占比概念，占比 = Agent 区决定的
 *   剩余 flex-1；切 Agent 抖动根因 = 分割线（项目区起点）被推动）：
 *   - 高度对齐唯一触发器 = agentCount（App 唯一持有，ProfilePanel onProfilesChange
 *     上抛）——只有建/删 Agent 才重测；切 Agent 零触发零变化 → 项目区完全不动
 *   - 之前 DOM MutationObserver 方案有误触发（选中高亮条增删也属 childList 变化）
 *     + 测量微差 → 300ms 动画推动项目区 = "从 58 往上动"的抖动来源
 *   - 卡片等高保障（ProfilePanel 元信息行 flex-nowrap）→ 数量不变时列表总高恒不变
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
  const agentAreaRef = useRef<HTMLDivElement>(null);
  const [agentContentHeight, setAgentContentHeight] = useState<number | null>(null);

  // 🔴 TEMP-DIAG（2026-08-13 抖动排查，验证后删除）：分割线实时 Y 坐标
  // 切 Agent 时若此数字变化 = 上部高度在变（布局抖动源）；不变 = 抖在项目区内容
  const [diagY, setDiagY] = useState(0);
  useEffect(() => {
    const el = agentAreaRef.current;
    if (!el) return;
    const update = () => setDiagY(el.getBoundingClientRect().bottom);
    update();
    const raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  });

  // 🔴 2026-08-13 v9（v8 agentCount 触发有同值冻结缺陷：App 预取 agentCount 与
  //   ProfilePanel 加载上报同值 → bail out → 重测不触发 → 高度冻结 loading 小值 = 1 卡）：
  //   MutationObserver 观察列表区**直接子节点**（subtree:false——选中高亮条等卡片内部
  //   变化不触发 → 切 Agent 零触发）→ measure（header + list.scrollHeight）+ 值比较
  //   （仅真实高度变化才 setState）→ loading→卡片/建删触发对齐，切 Agent 高度不动
  useEffect(() => {
    const el = agentAreaRef.current;
    if (!el) return;
    const list = el.querySelector('[data-agent-list]');
    if (!list) return;
    let last = -1;
    const measure = () => {
      const header = el.querySelector<HTMLElement>('[data-agent-header]');
      const h = (header?.offsetHeight ?? 0) + (list.scrollHeight ?? 0);
      if (h > 0 && h !== last) {
        last = h;
        setAgentContentHeight(h);
      }
    };
    measure();
    const mo = new MutationObserver(() => measure());
    mo.observe(list, { childList: true, subtree: false });
    return () => mo.disconnect();
  }, []);

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* 🔴 TEMP-DIAG：分割线位置标记（红点 + Y 坐标） */}
      <div className="pointer-events-none absolute right-0 z-50" style={{ top: diagY - 8 }}>
        <span className="text-[9px] font-mono text-red-500 bg-black/60 px-1 rounded">Y={diagY.toFixed(0)}</span>
      </div>
      {/* ── 上部：Agent 卡片（内容自然高度，上限 42% 仅作极端保护——卡片数极多时
          不挤没项目区；数量不变 → 高度恒定 → 分割线/项目区起点不动） ── */}
      <div
        ref={agentAreaRef}
        className="flex flex-col min-h-0 max-h-[42%] overflow-hidden transition-[height] duration-300 ease-out"
        style={agentContentHeight ? { height: `${agentContentHeight}px` } : undefined}
      >
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
