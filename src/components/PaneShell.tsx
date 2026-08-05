import { createContext, useContext, useMemo, useRef, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * PaneShell — CSS Grid pane system with resizable dividers and collapse support
 *
 * Simplified version inspired by Eleve Desktop's PaneShell. Provides a
 * CSS Grid layout with configurable left and right panes around a main area.
 * Supports resizable dividers with pointer capture drag, collapse/expand
 * animation, and CSS variable emission for pane widths.
 *
 * Usage:
 *   <PaneShell
 *     leftOpen leftWidth="260px"
 *     onLeftResize={w => setPanelWidth(w)}
 *     onLeftToggle={() => setLeftOpen(!leftOpen)}
 *   >
 *     <Pane side="left">...</Pane>
 *     <PaneMain>...</PaneMain>
 *   </PaneShell>
 */

interface PaneShellContextValue {
  slots: Record<string, number>;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: string;
  rightWidth: string;
  onLeftToggle?: () => void;
  onRightToggle?: () => void;
  onResizerDown: (side: 'left' | 'right', e: React.PointerEvent) => void;
}

interface PaneShellProps {
  leftOpen?: boolean;
  leftWidth?: string;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  rightOpen?: boolean;
  rightWidth?: string;
  minRightWidth?: number;
  maxRightWidth?: number;
  onLeftResize?: (width: number) => void;
  onRightResize?: (width: number) => void;
  onLeftToggle?: () => void;
  onRightToggle?: () => void;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

interface PaneProps {
  side: string;
  children: ReactNode;
  className?: string;
}

interface PaneMainProps {
  children: ReactNode;
  className?: string;
}

interface PaneCollapseBtnProps {
  side: string;
  className?: string;
}

const PaneShellContext = createContext<PaneShellContextValue | null>(null);

/**
 * PaneShell: outer grid container. Children should be <Pane> and <PaneMain>.
 * Handles resizable dividers internally.
 */
export default function PaneShell({
  leftOpen = false,
  leftWidth = '260px',
  minLeftWidth = 180,
  maxLeftWidth = 500,
  rightOpen = false,
  rightWidth = '200px',
  minRightWidth = 200,
  maxRightWidth = 400,
  onLeftResize,
  onRightResize,
  onLeftToggle,
  onRightToggle,
  children,
  className = '',
  style,
}: PaneShellProps) {
  // 🔴🔴 拖拽架构（2026-08-05 v3，根治“距离不同步/手感差”）——核心原则：
  // **拖拽中零 React 状态更新，直接写 DOM CSS 变量**。
  // grid-template-columns 引用 var(--pane-left/right-width)，拖拽时 applyDrag 直接
  // setProperty 覆写变量 → 浏览器原生重排（合成器/布局线程直接响应，无 React 参与）
  // → 鼠标移动 1px = 面板移动 1px，天然同步。
  // 拖拽结束（pointerup）才一次性 onLeftResize/onRightResize 同步 React state
  // （持久化/其它逻辑消费），期间 App 零重渲染。
  // 旧架构（v2）痛点：每帧 setState → App 整树重渲染（会话/流式/面板全量）
  // 渲染耗时 >16ms → rAF 应用被 React 渲染排队延迟 → 鼠标拖出屏幕面板才动一点。
  const dragRef = useRef<{ side: 'left' | 'right'; startX: number } | null>(null);
  const rafRef = useRef(0);
  const pendingXRef = useRef<number | null>(null);
  // 宽度/边界/回调走 ref（拖拽 handler 不依赖 props，永不重建）
  const widthRef = useRef({ left: parseFloat(leftWidth) || 260, right: parseFloat(rightWidth) || 200 });
  const limitsRef = useRef({ minL: minLeftWidth, maxL: maxLeftWidth, minR: minRightWidth, maxR: maxRightWidth });
  const onResizeRef = useRef({ left: onLeftResize, right: onRightResize });
  widthRef.current = { left: parseFloat(leftWidth) || 260, right: parseFloat(rightWidth) || 200 };
  limitsRef.current = { minL: minLeftWidth, maxL: maxLeftWidth, minR: minRightWidth, maxR: maxRightWidth };
  onResizeRef.current = { left: onLeftResize, right: onRightResize };
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // 🔴 拖拽中禁用 grid-template-columns transition（200ms 动画会造成拖拽滞后感）
  const [dragging, setDragging] = useState(false);

  // 🔴 窗口整体缩放时的宽度增量分配（老大 2026-08-05 要求 + 2026-08-06 修正）：
  // - 右栏弹出：拖外框（窗口变宽）→ 增量给右栏（rightWidth += Δ），聊天区（1fr）保持不动
  // - 窗口变窄 → 减量也从右栏扣（优先缩右栏，聊天区不动）；右栏到 minR 后 1fr 才吸收
  //   （对齐老大语义：缩放整体窗口只变右抽屉大小，消息区保持不动）
  // 🔴 2026-08-06 抖动根因修复：
  //   a) next 计算后**立即同步 widthRef.current.right**（旧代码只在渲染时同步 →
  //      窗口连续缩放时多次回调基于同一旧值，Δ 丢失/累积 → 左右抖动）
  //   b) setState 回调走 rAF 节流（窗口拖拽期间每帧只渲染一次，防 React 渲染滞后抖动）
  const rightOpenRef = useRef(rightOpen);
  rightOpenRef.current = rightOpen;
  const rightPendingRef = useRef<number | null>(null);
  const rightRafRef = useRef(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastWidth = el.getBoundingClientRect().width;
    const flushRight = () => {
      rightRafRef.current = 0;
      if (rightPendingRef.current !== null) {
        const v = rightPendingRef.current;
        rightPendingRef.current = null;
        onResizeRef.current.right?.(v);
      }
    };
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? lastWidth;
      const delta = width - lastWidth;
      lastWidth = width;
      if (!rightOpenRef.current || delta === 0 || draggingRef.current) return;
      const current = widthRef.current.right;
      const limits = limitsRef.current;
      // 双向分配：宽 → 右栏 += Δ；窄 → 右栏 -= Δ（到 minR 停，余量 1fr 吸收）
      const next = Math.max(limits.minR, Math.min(limits.maxR, current + delta));
      if (next === current) return;
      // 立即同步 ref（连续回调基于最新值），setState 走 rAF 节流
      widthRef.current.right = next;
      rightPendingRef.current = next;
      if (!rightRafRef.current) rightRafRef.current = requestAnimationFrame(flushRight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rightRafRef.current) cancelAnimationFrame(rightRafRef.current);
    };
  }, []);

  const handleResizerDown = useCallback((side: 'left' | 'right', e: React.PointerEvent) => {
    e.preventDefault();
    // 🔴 setPointerCapture 必须：拖拽中鼠标可能移入 iframe（产物预览）等独立文档，
    // iframe 内 pointerup 不冒泡到父窗口 → 拖拽状态残留（“松手还跟着鼠标走”根因）。
    // capture 把后续 pointer 事件强制重定向到热区元素，iframe 内松手也能收到。
    // 热区 div 在拖拽期间不会被 React 卸载（leftOpen/rightOpen 不变），capture 可靠。
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch { /* capture 失败不阻塞（window 级监听兑底） */ }
    dragRef.current = { side, startX: 'clientX' in e ? e.clientX : (e as any).touches?.[0]?.clientX ?? 0 };
    draggingRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // 每帧最多应用一次宽度变化（rAF 合并）——直接写 CSS 变量，零 React
  const applyDrag = useCallback(() => {
    rafRef.current = 0;
    const drag = dragRef.current;
    const clientX = pendingXRef.current;
    const el = containerRef.current;
    if (!drag || clientX == null || !el) return;
    pendingXRef.current = null;

    const delta = clientX - drag.startX;
    drag.startX = clientX;

    const w = widthRef.current;
    const limits = limitsRef.current;

    if (drag.side === 'left') {
      const next = Math.max(limits.minL, Math.min(limits.maxL, w.left + delta));
      w.left = next;
      el.style.setProperty('--pane-left-width', `${next}px`);
    } else {
      // right pane：向左拖 = 变宽（负 delta = 更大 pane）
      const next = Math.max(limits.minR, Math.min(limits.maxR, w.right - delta));
      w.right = next;
      el.style.setProperty('--pane-right-width', `${next}px`);
    }
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    pendingXRef.current = e.clientX;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(applyDrag);
    }
  }, [applyDrag]);

  const endDrag = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    pendingXRef.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // 拖拽结束：一次性同步 React state（拖拽中零 React，结束收敛持久化）
    if (drag) {
      const w = widthRef.current;
      const cb = onResizeRef.current;
      if (drag.side === 'left') cb.left?.(w.left);
      else cb.right?.(w.right);
    }
  }, []);

  // 一次性绑定（空依赖）：window 级监听，拖拽期间绝不重绑
  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    // 拖出窗口/切窗口兜底：强制结束拖拽
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('blur', endDrag);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handlePointerMove, endDrag]);

  // CSS Grid template: 3 columns (left | main | right)
  // 🔴 列宽引用 CSS 变量（var(--pane-left/right-width)）：拖拽中 applyDrag 直接
  // setProperty 覆写变量 → 浏览器原生重排，零 React 参与；非拖拽时由 React 渲染
  // 写入（composedStyle 同步 props）。
  const gridTemplate = useMemo(() => {
    const left = leftOpen ? 'var(--pane-left-width)' : '0px';
    const right = rightOpen ? 'var(--pane-right-width)' : '0px';
    // 🔴 2026-08-06：main 列改 minmax(0, 1fr) —— 旧 1fr 的隐式 min=auto(min-content)
    // 会被消息内容撑开 → 窗口缩放时聊天区宽度不稳定（左右抖动）；minmax(0,1fr)
    // 强制 min=0，列宽纯由可用空间决定，聊天区宽度随窗口缩放平滑变化
    return `${left} minmax(0, 1fr) ${right}`;
  }, [leftOpen, rightOpen]);

  // Emit pane widths as CSS variables for animation
  // 🔴 变量必须**永远**在 style 里（不能 dragging 时条件移除）：React 渲染 diff 会把
  // 缺席的属性 removeProperty，拖拽中一次渲染就会删掉变量 → grid 引用未定义 var →
  // 布局回退（“拖没反应、松手才显示”根因）。值始终取 widthRef 实时值：
  // 非拖拽 = props 同步值；拖拽中 = applyDrag 刚写的最新值（React 渲染只是“确认”不干扰）。
  const composedStyle: React.CSSProperties = {
    ...style,
    gridTemplateColumns: gridTemplate,
    '--pane-left-width': `${widthRef.current.left}px`,
    '--pane-right-width': `${widthRef.current.right}px`,
  } as React.CSSProperties;

  const contextValue = useMemo(() => ({
    slots: { left: 1, main: 2, right: 3 },
    leftOpen,
    rightOpen,
    leftWidth,
    rightWidth,
    onLeftToggle,
    onRightToggle,
    onResizerDown: handleResizerDown,
  }), [leftOpen, rightOpen, leftWidth, rightWidth, onLeftToggle, onRightToggle, handleResizerDown]);

  return (
    <PaneShellContext.Provider value={contextValue}>
      <div
        className={cn(
          'relative grid min-w-[640px] flex-1 min-h-0 overflow-hidden grid-rows-[minmax(0,1fr)] gap-2',
          leftOpen ? 'pl-2' : 'pl-0',
          rightOpen ? 'pr-2' : 'pr-0',
          className,
          !rightOpen && 'pane-right-closed',
        )}
        ref={containerRef}
        // 🔴 transition 用 inline style 控制：拖拽中必须禁用（200ms 动画会造成拖拽滞后），
        // 不用 class（transition-[...] 与 transition-none 同类的覆盖顺序不可靠）；
        // 开/关面板动画保留（非拖拽时 duration 200ms）。
        style={{
          ...composedStyle,
          background: 'transparent',
          transition: dragging ? 'none' : 'grid-template-columns 200ms ease, padding-left 200ms ease, padding-right 200ms ease',
        }}
      >
        {children}
        {/* 🔴 Resizer 拖拽热区（2026-08-05 老大最终要求）：
            平时与 hover 都**零视觉元素**——鼠标移到两卡片缝隙中间时，
            只有光标变成左右拖拽箭头（cursor-col-resize），不显示任何滑块/竖条。
            缝隙大小 = grid gap-2 固定 8px 不变，拖拽只改 pane 宽度（grid-template-columns）。
            拖拽中零 React（applyDrag 直接写 CSS 变量）。 */}
        {leftOpen && (
          <div
            className="absolute top-0 bottom-0 z-10 w-[16px] -translate-x-1/2 cursor-col-resize"
            style={{ left: `calc(${leftWidth} + 4px)` }}
            onPointerDown={(e: React.PointerEvent) => handleResizerDown('left', e)}
          />
        )}
        {rightOpen && (
          <div
            className="absolute top-0 bottom-0 z-10 w-[16px] translate-x-1/2 cursor-col-resize"
            style={{ right: `calc(${rightWidth} + 4px)` }}
            onPointerDown={(e: React.PointerEvent) => handleResizerDown('right', e)}
          />
        )}
      </div>
    </PaneShellContext.Provider>
  );
}

/**
 * Pane — a side pane (left or right) within PaneShell.
 * Renders nothing when collapsed (width transitions to 0 via grid).
 */
export function Pane({ side, children, className = '' }: PaneProps) {
  const ctx = useContext(PaneShellContext);
  if (!ctx) return null;

  const { slots, leftOpen, rightOpen, onLeftToggle, onRightToggle } = ctx;
  const col = slots[side];
  if (col === undefined) return null;

  const isOpen = side === 'left' ? leftOpen : rightOpen;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onToggle = side === 'left' ? onLeftToggle : onRightToggle;

  return (
    <div
      className={cn('flex overflow-hidden min-w-0 h-full', className, !isOpen && 'overflow-hidden')}
      data-pane-side={side}
      style={{ gridColumn: `${col} / ${col + 1}` }}
    >
      {children}
    </div>
  );
}

/**
 * PaneMain — the main content area within PaneShell.
 */
export function PaneMain({ children, className = '' }: PaneMainProps) {
  const ctx = useContext(PaneShellContext);
  if (!ctx) return null;

  const { slots } = ctx;
  const col = slots.main;

  return (
    <div
      className={cn('flex flex-col min-w-0 overflow-hidden rounded-xl', className)}
      style={{ gridColumn: `${col} / ${col + 1}` }}
    >
      {children}
    </div>
  );
}

/**
 * PaneCollapseBtn — a toggle button for collapsing/expanding a side pane.
 * Typically placed at the edge of the pane or inside the pane header.
 */
export function PaneCollapseBtn({ side, className = '' }: PaneCollapseBtnProps) {
  const ctx = useContext(PaneShellContext);
  if (!ctx) return null;

  const { leftOpen, rightOpen, onLeftToggle, onRightToggle } = ctx;
  const isOpen = side === 'left' ? leftOpen : rightOpen;
  const onToggle = side === 'left' ? onLeftToggle : onRightToggle;

  if (!onToggle) return null;

  const Icon = side === 'left'
    ? (isOpen ? ChevronLeft : ChevronRight)
    : (isOpen ? ChevronRight : ChevronLeft);

  return (
    <button
      className={cn(
        'flex items-center justify-center w-5 h-5 border border-[var(--ui-stroke-secondary)] rounded-sm bg-[var(--ui-bg-quaternary)] text-[var(--ui-text-tertiary)] cursor-pointer shrink-0 transition-colors duration-[180ms] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)]',
        className,
      )}
      data-side={side}
      onClick={onToggle}
      title={isOpen
        ? `关闭${side === 'left' ? '左侧' : '右侧'}面板`
        : `展开${side === 'left' ? '左侧' : '右侧'}面板`}
      aria-label={isOpen ? `Collapse ${side} panel` : `Expand ${side} panel`}
    >
      <Icon size={14} />
    </button>
  );
}
