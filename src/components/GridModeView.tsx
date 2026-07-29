/**
 * GridModeView — 多 Agent 宫格全功能视图（模式 B）
 *
 * 北极星（老大 2026-07-30）：同时显示 N 个 Agent 的全功能聊天窗口（和单视图一样），
 * N 无上限（滚动网格），性能优先（ELEVE 常驻内存）。拖拽换位必须有（老大强调）。
 *
 * 架构：
 * - 本组件仅在 viewMode==='grid' 时挂载（App 条件渲染）→ 内部 useGridChat(true) 挂载即
 *   激活、卸载即清理。与单视图 useSSE 以 viewMode 为键天然互斥（App 层同步暂停 useSSE）。
 * - 布局：卡片绝对定位 + transform translate 定位（非 grid 流式布局）。列数按容器宽度
 *   auto-fill 计算（MIN_CELL_W），行数按 N 计算，内容区撑出高度 → 容器可滚动（N 无上限）。
 * - 拖拽换位（零依赖）：拖拽期间零 React 渲染——被拖卡直接写 DOM transform 跟随光标；
 *   换位只更新逻辑顺序 projectedOrder，其余卡 CSS transition 平滑滑过；松手提交 order，
 *   被拖卡弹性滑回槽位。坐标含 scrollTop 补偿 + 边缘自动滚动（多行可拖到不可见区）。
 * - 进入宫格：每个有历史 session 的 profile loadLatest（后端权威源）；无 session 的显示空态。
 * - 退出/展开：先把各 Agent 当前 session 指针写回 profile_session_map，再交回 App 刷新单视图。
 */
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { fetchProfiles } from '../utils/api';
import * as storage from '../utils/storage';
import { Square } from 'lucide-react';
import { useGridChat, type AgentChatState } from '../hooks/useGridChat';
import AgentChatCard, { type AgentProfileInfo, type AgentCardColor } from './AgentChatCard';

// ── Agent 颜色调色板（对齐 --ui-* 设计 token）──
const AGENT_COLORS: AgentCardColor[] = [
  { dot: 'var(--ui-blue)',   ring: 'rgba(0,83,253,0.35)',   bg: 'rgba(0,83,253,0.06)' },
  { dot: 'var(--ui-green)',  ring: 'rgba(31,138,101,0.35)',  bg: 'rgba(31,138,101,0.06)' },
  { dot: 'var(--ui-purple)', ring: 'rgba(158,148,213,0.35)', bg: 'rgba(158,148,213,0.06)' },
  { dot: 'var(--ui-orange)', ring: 'rgba(219,112,75,0.35)',  bg: 'rgba(219,112,75,0.06)' },
];

// 尚未加载的 profile 的空状态（模块级常量 = 稳定引用，保证 AgentChatCard memo 生效）
const EMPTY_AGENT_STATE: AgentChatState = {
  sessionId: null, messages: [], hasMore: false, oldestId: null,
  isLoadingMore: false, status: 'idle', streamText: '', streamReasoning: '',
  pendingApproval: null, pendingClarify: null, pendingSudo: null, lastActivity: 0,
};

// ── 布局常量 ──
const GAP = 10;
const PAD = 10;
const MIN_CELL_W = 340;   // 卡片最小宽度（列数 = 容器宽度 auto-fill）
const CELL_H = 480;       // 卡片固定高度（内部消息区自滚动）
const SWAP_EASE = 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)';
const AUTO_SCROLL_EDGE = 40;   // 拖拽距容器边缘多少 px 触发自动滚动
const AUTO_SCROLL_STEP = 10;

interface ProfileInfo extends AgentProfileInfo {
  skill_count: number;
  is_default: boolean;
}

interface GridModeViewProps {
  currentProfile: string;
  /** App 层当前会话的实时 sessionId（当前 profile 的 map 指针可能陈旧，用此兜底） */
  currentSessionId: string | null;
  onExitGrid: () => void;
  onExpandAgent: (profile: string) => void;
}

/** 拖拽运行时状态（存 ref，拖拽期间零 setState） */
interface DragState {
  name: string;
  el: HTMLDivElement;
  downX: number;
  downY: number;
  grabOffsetX: number;   // 光标距卡片左上角偏移（卡片内坐标，与坐标系无关）
  grabOffsetY: number;
  active: boolean;       // 超过 4px 阈值才视为拖拽
  ring: string;
}

// ── 布局计算：列数按宽度 auto-fill，行数按 N，内容区撑高供滚动 ──
function computeLayout(count: number, W: number) {
  const cols = Math.max(1, Math.floor((W - PAD * 2 + GAP) / (MIN_CELL_W + GAP)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
  const contentH = PAD * 2 + rows * CELL_H + (rows - 1) * GAP;
  return { cols, rows, cellW, cellH: CELL_H, contentH };
}

function slotPos(index: number, cols: number, cellW: number) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: PAD + col * (cellW + GAP), y: PAD + row * (CELL_H + GAP) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function GridModeView({ currentProfile, currentSessionId, onExitGrid, onExpandAgent }: GridModeViewProps) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [colorMap, setColorMap] = useState<Record<string, number>>({});
  const [focusedName, setFocusedName] = useState<string | null>(currentProfile);
  const [width, setWidth] = useState(0);

  // 宫格聊天引擎：挂载即激活（本组件仅 grid 模式挂载）
  const { states, loadLatest, loadMore, sendTo, abortAgent, clearPending } = useGridChat(true);

  // 状态镜像（退出/展开时读当前各 Agent session 指针）
  const statesRef = useRef(states);
  statesRef.current = states;

  const containerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const projectedOrderRef = useRef<string[]>([]);   // 拖拽期间的逻辑顺序
  const justDraggedRef = useRef(false);
  const orderRef = useRef(order);
  orderRef.current = order;
  const colorMapRef = useRef(colorMap);
  colorMapRef.current = colorMap;

  const layout = computeLayout(order.length, width);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const registerRef = useCallback((name: string, el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(name, el);
    else cellRefs.current.delete(name);
  }, []);

  // 监听容器宽度（列数随宽度 auto-fill）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 拉取 Agent 列表（全量，N 无上限） ──
  useEffect(() => {
    let cancelled = false;
    fetchProfiles()
      .then((data) => {
        if (cancelled) return;
        const list = data.profiles as ProfileInfo[];
        setProfiles(list);
        setOrder(list.map((p) => p.name));
        const map: Record<string, number> = {};
        list.forEach((p, i) => { map[p.name] = i % AGENT_COLORS.length; });
        setColorMap(map);
        setFocusedName((prev) => prev ?? (list.find((p) => p.name === currentProfile)?.name ?? list[0]?.name ?? null));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentProfile]);

  // ── 进入宫格：为每个有历史 session 的 profile 加载最新 N 条（后端权威源） ──
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current || profiles.length === 0) return;
    loadedRef.current = true;
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    for (const p of profiles) {
      // 当前 profile 优先用 App 实时 sessionId（map 可能未及更新），其余用 per-profile 指针
      const sid = map[p.name] || (p.name === currentProfile ? currentSessionId : null);
      if (sid) loadLatest(p.name, sid);
    }
  }, [profiles, loadLatest, currentProfile, currentSessionId]);

  // ── 把各 Agent 当前 session 指针写回 localStorage（退出/展开前调用） ──
  const persistPointers = useCallback(() => {
    const map = (storage.load('profile_session_map', {}) as Record<string, string | null>) || {};
    let changed = false;
    for (const [p, s] of Object.entries(statesRef.current)) {
      if (s?.sessionId) { map[p] = s.sessionId; changed = true; }
    }
    if (changed) storage.save('profile_session_map', map);
  }, []);

  const handleExit = useCallback(() => {
    persistPointers();
    onExitGrid();
  }, [persistPointers, onExitGrid]);

  const handleExpand = useCallback((profile: string) => {
    persistPointers();
    onExpandAgent(profile);
  }, [persistPointers, onExpandAgent]);

  // ── 把一张卡定位到它的槽位（命令式，带过渡） ──
  const setCardSlot = useCallback((name: string, index: number, animate: boolean) => {
    const el = cellRefs.current.get(name);
    if (!el) return;
    const { cols, cellW } = layoutRef.current;
    const pos = slotPos(index, cols, cellW);
    el.style.transition = animate ? SWAP_EASE : 'none';
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }, []);

  // order / 宽度变化时把所有卡归位（被拖的卡跳过）
  // useLayoutEffect：绘制前归位，避免初始加载时卡片先堆在左上角闪一帧
  useLayoutEffect(() => {
    order.forEach((name, idx) => {
      if (dragRef.current?.active && dragRef.current.name === name) return;
      setCardSlot(name, idx, true);
    });
  }, [order, width, setCardSlot]);

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
    const container = containerRef.current;
    if (!container) return;

    // 4px 阈值：区分点击和拖拽
    if (!d.active) {
      if (Math.abs(e.clientX - d.downX) < 4 && Math.abs(e.clientY - d.downY) < 4) return;
      d.active = true;
      d.el.style.setProperty('--drag-ring', d.ring);
      d.el.classList.add('grid-cell-dragging');
      d.el.style.transition = 'none';   // 被拖卡不做过渡，直接跟手
      d.el.style.zIndex = '20';
    }

    const cRect = container.getBoundingClientRect();

    // 边缘自动滚动（多行网格可拖到当前不可见区域）
    const cursorViewY = e.clientY - cRect.top;
    if (cursorViewY < AUTO_SCROLL_EDGE) container.scrollTop -= AUTO_SCROLL_STEP;
    else if (cursorViewY > cRect.height - AUTO_SCROLL_EDGE) container.scrollTop += AUTO_SCROLL_STEP;

    // 光标的内容坐标（含滚动偏移）
    const contentX = e.clientX - cRect.left;
    const contentY = e.clientY - cRect.top + container.scrollTop;

    // 被拖卡位置 = 光标位置（唯一真值源）→ 永不漂移
    const tx = contentX - d.grabOffsetX;
    const ty = contentY - d.grabOffsetY;
    d.el.style.transform = `translate(${tx}px, ${ty}px) scale(1.03)`;

    // 换位检测：光标落在哪个槽位
    const { cols, rows, cellW } = layoutRef.current;
    const relX = contentX - PAD;
    const relY = contentY - PAD;
    const col = clamp(Math.floor(relX / (cellW + GAP)), 0, cols - 1);
    const row = clamp(Math.floor(relY / (CELL_H + GAP)), 0, rows - 1);
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
  }, [setCardSlot]);

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;

    if (d.active) {
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 60);
      // 提交逻辑顺序 → effect 会把被拖卡弹性滑回槽位
      setOrder([...projectedOrderRef.current]);
      const el = d.el;
      el.style.zIndex = '';
      // 回弹动画期间保留"抬起"样式，落定后再移除（有"放下"的感觉）
      setTimeout(() => {
        el.classList.remove('grid-cell-dragging');
        el.style.transition = '';
      }, 400);
    }

    dragRef.current = null;
  }, []);

  const handlePointerUp = useCallback(() => { endDrag(); }, [endDrag]);
  const handlePointerCancel = useCallback(() => { endDrag(); }, [endDrag]);

  const orderedProfiles = order
    .map((name) => profiles.find((p) => p.name === name))
    .filter((p): p is ProfileInfo => !!p);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 顶部控制条 ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-border/30">
        <button
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-accent/50 rounded transition-colors"
          title="返回单视图 (Ctrl+G)"
          onClick={handleExit}
        >
          <Square size={13} strokeWidth={1.5} />
          <span>单视图</span>
        </button>
        <span className="text-[11px] text-muted-foreground/50">
          {orderedProfiles.length} 个 Agent
        </span>
        <span className="text-[10px] text-muted-foreground/30 ml-auto">
          拖拽 ⠿ 换位 · 点击卡片聚焦 · 展开按钮切单视图
        </span>
      </div>

      {/* ── 宫格区域（绝对定位 + transform，内容撑高可滚动，事件委托）── */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-y-auto"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {width > 0 && (
          <div style={{ height: layout.contentH, position: 'relative' }}>
            {orderedProfiles.map((profile) => (
              <div
                key={profile.name}
                ref={(el) => registerRef(profile.name, el)}
                data-agent-name={profile.name}
                onClick={() => { if (!justDraggedRef.current) setFocusedName(profile.name); }}
                className="absolute top-0 left-0"
                style={{ width: layout.cellW, height: layout.cellH }}
              >
                <AgentChatCard
                  profile={profile}
                  state={states[profile.name] ?? EMPTY_AGENT_STATE}
                  color={AGENT_COLORS[colorMap[profile.name] ?? 0]}
                  focused={focusedName === profile.name}
                  onSend={sendTo}
                  onLoadMore={loadMore}
                  onAbort={abortAgent}
                  onClearPending={clearPending}
                  onExpand={handleExpand}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
