/**
 * GridModeView — 多 Agent 宫格视图（模式 B）
 *
 * 同时渲染多个 Agent 的迷你聊天窗口，用于并行监督。
 * 每个宫格 = 标题栏(拖拽手柄) + 聊天区 + 迷你输入框。
 *
 * 拖拽架构（对齐 dnd-kit / react-sortable 底层原理）：
 * - 卡片绝对定位，位置完全由 transform: translate() 决定（不靠 grid 布局）
 * - 拖拽期间零 React 渲染：被拖卡直接写 DOM transform 跟随光标 → 不漂移
 * - 换位不重排 DOM，只更新逻辑顺序，其余卡 CSS transition 平滑滑过 → 有过渡
 * - 松手时被拖卡弹性滑回槽位
 * 零依赖。
 *
 * 当前阶段：UI 原型（Phase 1 状态隔离完成后连线真实数据）
 */
import { useState, useEffect, useLayoutEffect, useCallback, useRef, memo } from 'react';
import { fetchProfiles } from '../utils/api';
import { cn } from '@/lib/utils';
import { Bot, Cpu, Plug, Package, Square, GripVertical } from 'lucide-react';

// ── Agent 颜色调色板（对齐 --ui-* 设计 token）──
const AGENT_COLORS = [
  { dot: 'var(--ui-blue)',   ring: 'rgba(0,83,253,0.35)',   bg: 'rgba(0,83,253,0.06)' },
  { dot: 'var(--ui-green)',  ring: 'rgba(31,138,101,0.35)',  bg: 'rgba(31,138,101,0.06)' },
  { dot: 'var(--ui-purple)', ring: 'rgba(158,148,213,0.35)', bg: 'rgba(158,148,213,0.06)' },
  { dot: 'var(--ui-orange)', ring: 'rgba(219,112,75,0.35)',  bg: 'rgba(219,112,75,0.06)' },
] as const;

// ── 布局常量 ──
const GAP = 10;
const PAD = 10;
const SWAP_EASE = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';

interface ProfileInfo {
  name: string;
  display_name?: string | null;
  model: string | null;
  provider: string | null;
  skill_count: number;
  is_default: boolean;
}

interface GridModeViewProps {
  currentProfile: string;
  onExitGrid: () => void;
}

/** 拖拽运行时状态（存 ref，拖拽期间零 setState） */
interface DragState {
  name: string;
  el: HTMLDivElement;
  downX: number;
  downY: number;
  grabOffsetX: number;   // 光标距卡片左上角偏移（常量）
  grabOffsetY: number;
  active: boolean;       // 超过 4px 阈值才视为拖拽
  ring: string;
}

// ── 布局计算 ──
function computeLayout(count: number, W: number, H: number) {
  const cols = count <= 1 ? 1 : 2;
  const rows = count > 2 ? 2 : 1;
  const cellW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  const cellH = (H - PAD * 2 - GAP * (rows - 1)) / rows;
  return { cols, rows, cellW, cellH };
}

function slotPos(index: number, cols: number, cellW: number, cellH: number) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: PAD + col * (cellW + GAP), y: PAD + row * (cellH + GAP) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── 单个 Agent 宫格内容（纯展示，填充定位 wrapper）──
const AgentCell = memo(function AgentCell({
  profile, colorIndex, focused,
}: {
  profile: ProfileInfo;
  colorIndex: number;
  focused: boolean;
}) {
  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length];

  return (
    <div
      className={cn(
        'w-full h-full flex flex-col rounded-xl border overflow-hidden min-h-0 transition-shadow duration-200',
        focused
          ? 'border-transparent shadow-lg'
          : 'border-border/60 opacity-80 hover:opacity-100'
      )}
      style={{
        background: 'var(--ui-card-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: focused ? `0 0 0 2px ${color.ring}, 0 8px 24px rgba(0,0,0,0.3)` : undefined,
      }}
    >
      {/* ── 标题栏（拖拽手柄）── */}
      <div
        data-drag-handle
        className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border/40 cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ background: color.bg }}
      >
        <GripVertical size={13} strokeWidth={1.5} className="text-muted-foreground/30 shrink-0" />
        <div
          className="flex items-center justify-center w-6 h-6 rounded-md shrink-0"
          style={{ background: `${color.dot}22`, color: color.dot }}
        >
          <Bot size={13} strokeWidth={1.5} />
        </div>
        <span className="text-xs font-medium text-foreground truncate flex-1">
          {profile.display_name || profile.name}
        </span>
        {profile.model && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70 shrink-0">
            <Cpu size={9} strokeWidth={1.5} />
            <span className="truncate max-w-[80px]">{profile.model}</span>
          </span>
        )}
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: 'var(--ui-green)' }}
          title="空闲"
        />
      </div>

      {/* ── 聊天区占位 ── */}
      <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 p-4">
        <Bot size={28} strokeWidth={1} className="text-muted-foreground/20" />
        <span className="text-[11px] text-muted-foreground/40">
          Phase 1 连线后显示实时对话
        </span>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/30">
          {profile.provider && (
            <span className="inline-flex items-center gap-0.5">
              <Plug size={9} strokeWidth={1.5} />
              {profile.provider}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            <Package size={9} strokeWidth={1.5} />
            {profile.skill_count} 技能
          </span>
        </div>
      </div>

      {/* ── 迷你输入框（Phase 1 后接真实发送） ── */}
      <div className="shrink-0 px-2.5 pb-2.5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-muted/20">
          <span className="text-[11px] text-muted-foreground/30 flex-1">输入消息…</span>
          <div className="w-5 h-5 rounded-full bg-muted-foreground/10 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/30">
              <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
});

// ── 主视图 ──
export default function GridModeView({ currentProfile, onExitGrid }: GridModeViewProps) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [colorMap, setColorMap] = useState<Record<string, number>>({});
  const [focusedName, setFocusedName] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const projectedOrderRef = useRef<string[]>([]);   // 拖拽期间的逻辑顺序
  const justDraggedRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const colorMapRef = useRef(colorMap);
  colorMapRef.current = colorMap;

  const layout = computeLayout(order.length, size.w, size.h);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const registerRef = useCallback((name: string, el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(name, el);
    else cellRefs.current.delete(name);
  }, []);

  // 监听容器尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 拉取 Agent 列表
  useEffect(() => {
    let cancelled = false;
    fetchProfiles()
      .then((data) => {
        if (!cancelled) {
          const list = data.profiles as ProfileInfo[];
          setProfiles(list);
          setOrder(list.slice(0, 4).map((p) => p.name));   // 宫格模式最多显示 4 个
          const map: Record<string, number> = {};
          list.forEach((p, i) => { map[p.name] = i % AGENT_COLORS.length; });
          setColorMap(map);
          const idx = list.findIndex((p) => p.name === currentProfile);
          setFocusedName(idx >= 0 ? list[idx].name : list[0]?.name ?? null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentProfile]);

  // 把一张卡定位到它的槽位（命令式，带过渡）
  const setCardSlot = useCallback((name: string, index: number, animate: boolean) => {
    const el = cellRefs.current.get(name);
    if (!el) return;
    const { cols, cellW, cellH } = layoutRef.current;
    const pos = slotPos(index, cols, cellW, cellH);
    el.style.transition = animate ? SWAP_EASE : 'none';
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }, []);

  // order / 尺寸变化时，把所有卡归位（被拖的卡跳过）
  // useLayoutEffect：绘制前归位，避免初始加载时卡片先堆在左上角闪一帧
  useLayoutEffect(() => {
    order.forEach((name, idx) => {
      if (dragRef.current?.active && dragRef.current.name === name) return;
      setCardSlot(name, idx, true);
    });
  }, [order, size, setCardSlot]);

  // ── 指针拖拽（事件委托在容器上，直接操作 DOM，零 React 渲染）──

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const handle = (e.target as HTMLElement).closest('[data-drag-handle]');
    if (!handle) return;
    const card = handle.closest('[data-agent-name]') as HTMLDivElement | null;
    if (!card) return;
    const name = card.dataset.agentName;
    if (!name) return;

    (handle as HTMLElement).setPointerCapture(e.pointerId);

    const rect = card.getBoundingClientRect();
    const colorIdx = colorMapRef.current[name] ?? 0;

    dragRef.current = {
      name,
      el: card,
      downX: e.clientX,
      downY: e.clientY,
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
      active: false,
      ring: AGENT_COLORS[colorIdx % AGENT_COLORS.length].ring,
    };
    projectedOrderRef.current = [...orderRef.current];
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;

    // 4px 阈值：区分点击和拖拽
    if (!d.active) {
      if (Math.abs(e.clientX - d.downX) < 4 && Math.abs(e.clientY - d.downY) < 4) return;
      d.active = true;
      d.el.style.setProperty('--drag-ring', d.ring);
      d.el.classList.add('grid-cell-dragging');
      d.el.style.transition = 'none';   // 被拖卡不做过渡，直接跟手
    }

    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();

    // 被拖卡位置 = 光标位置（唯一真值源）→ 永不漂移
    const tx = e.clientX - cRect.left - d.grabOffsetX;
    const ty = e.clientY - cRect.top - d.grabOffsetY;
    d.el.style.transform = `translate(${tx}px, ${ty}px) scale(1.03) rotate(0.4deg)`;

    // 换位检测：光标落在哪个槽位
    const { cols, rows, cellW, cellH } = layoutRef.current;
    const relX = e.clientX - cRect.left - PAD;
    const relY = e.clientY - cRect.top - PAD;
    const col = clamp(Math.floor(relX / (cellW + GAP)), 0, cols - 1);
    const row = clamp(Math.floor(relY / (cellH + GAP)), 0, rows - 1);
    const to = row * cols + col;

    const proj = projectedOrderRef.current;
    if (to >= proj.length) return;
    const from = proj.indexOf(d.name);
    if (to === from || proj[to] === d.name) return;

    // 只更新逻辑顺序（不动 DOM 顺序），其余卡平滑滑到新槽位
    [proj[from], proj[to]] = [proj[to], proj[from]];
    proj.forEach((nm, idx) => {
      if (nm !== d.name) setCardSlot(nm, idx, true);
    });
  }, []);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;

    if (d.active) {
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 60);
      // 提交逻辑顺序 → effect 会把被拖卡弹性滑回槽位
      setOrder([...projectedOrderRef.current]);
      // 回弹动画期间保留"抬起"样式，落定后再移除（有"放下"的感觉）
      const el = d.el;
      setTimeout(() => {
        el.classList.remove('grid-cell-dragging');
        el.style.transition = '';
      }, 400);
    }

    dragRef.current = null;
  }, []);

  const handlePointerUp = useCallback(() => { endDrag(); }, [endDrag]);
  const handlePointerCancel = useCallback(() => { endDrag(); }, [endDrag]);

  // Ctrl+G 循环聚焦
  const cycleFocus = useCallback(() => {
    const o = orderRef.current;
    if (o.length === 0) return;
    setFocusedName((prev) => {
      const idx = prev ? o.indexOf(prev) : -1;
      return o[(idx + 1) % o.length];
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        cycleFocus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cycleFocus]);

  const orderedProfiles = order
    .map((name) => profiles.find((p) => p.name === name))
    .filter((p): p is ProfileInfo => !!p)
    .slice(0, 4);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 顶部控制条（28px）── */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border/30">
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-accent/50 rounded transition-colors"
          title="返回单视图 (Ctrl+G)"
          onClick={onExitGrid}
        >
          <Square size={13} strokeWidth={1.5} />
          <span>单视图</span>
        </button>
        <span className="text-[11px] text-muted-foreground/50">
          {orderedProfiles.length} 个 Agent
        </span>
        <span className="text-[10px] text-muted-foreground/30 ml-auto">
          拖拽卡片换位 · Ctrl+G 切换聚焦
        </span>
      </div>

      {/* ── 宫格区域（绝对定位 + transform 定位，事件委托）── */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {size.w > 0 && orderedProfiles.map((profile) => (
          <div
            key={profile.name}
            ref={(el) => registerRef(profile.name, el)}
            data-agent-name={profile.name}
            role="button"
            tabIndex={0}
            draggable={false}
            onClick={() => { if (!justDraggedRef.current) setFocusedName(profile.name); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocusedName(profile.name); } }}
            className="absolute top-0 left-0 cursor-pointer"
            style={{ width: layout.cellW, height: layout.cellH }}
          >
            <AgentCell
              profile={profile}
              colorIndex={colorMap[profile.name] ?? 0}
              focused={focusedName === profile.name}
            />
          </div>
        ))}
      </div>

      {/* 超过 4 个 Agent 的提示 */}
      {profiles.length > 4 && (
        <div className="shrink-0 px-3 py-1 text-center text-[10px] text-muted-foreground/40 border-t border-border/20">
          宫格模式最多显示 4 个 Agent，其余请使用单视图切换
        </div>
      )}
    </div>
  );
}
