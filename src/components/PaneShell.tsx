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

  // 🔴 窗口整体缩放时的宽度增量分配（老大 2026-08-05 要求）：
  // - 右栏弹出：拖外框（窗口变宽）→ 增量给右栏（rightWidth += Δ），聊天区（1fr）保持不动
  // - 右栏未弹出：增量自然落在聊天区（1fr 吸收）
  // 实现：ResizeObserver 观察容器总宽变化，变宽且 rightOpen → onRightResize(current + Δ)；
  // 变窄不处理（1fr 先缩，右栏保持；右栏宽度仍受 max 钳制，避免无限增长）。
  const rightOpenRef = useRef(rightOpen);
  rightOpenRef.current = rightOpen;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastWidth = el.getBoundingClientRect().width;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? lastWidth;
      const delta = width - lastWidth;
      lastWidth = width;
      if (!rightOpenRef.current || delta <= 0 || draggingRef.current) return;
      const current = widthRef.current.right;
      const limits = limitsRef.current;
      const next = Math.max(limits.minR, Math.min(limits.maxR, current + delta));
      if (next !== current) onResizeRef.current.right?.(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleResizerDown = useCallback((side: 'left' | 'right', e: React.PointerEvent) => {
    e.preventDefault();
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
    return `${left} 1fr ${right}`;
  }, [leftOpen, rightOpen]);

  // Emit pane widths as CSS variables for animation
  const composedStyle: React.CSSProperties = {
    ...style,
    gridTemplateColumns: gridTemplate,
    // 🔴 拖拽中不覆盖变量（applyDrag 正在写 DOM，React 渲染覆写会打断拖拽）——
    // 非拖拽时同步 props。
    ...(dragging ? {} : { '--pane-left-width': leftWidth, '--pane-right-width': rightWidth }),
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
        {/* 🔴 Resizer 拖拽热区（2026-08-05 老大要求）：
            平时干干净净（完全透明无痕）；鼠标移到两卡片中间时出现长竖条提示。
            缝隙大小 = grid gap-2 固定 8px 不变，拖拽只改 pane 宽度（grid-template-columns）。
            拖拽中零 React（applyDrag 直接写 CSS 变量）。 */}
        {leftOpen && (
          <div
            className="group absolute top-0 bottom-0 z-10 w-[16px] -translate-x-1/2 cursor-col-resize"
            style={{ left: `calc(${leftWidth} + 4px)` }}
            onPointerDown={(e: React.PointerEvent) => handleResizerDown('left', e)}
          >
            <ResizeHandle dragging={dragging} />
          </div>
        )}
        {rightOpen && (
          <div
            className="group absolute top-0 bottom-0 z-10 w-[16px] translate-x-1/2 cursor-col-resize"
            style={{ right: `calc(${rightWidth} + 4px)` }}
            onPointerDown={(e: React.PointerEvent) => handleResizerDown('right', e)}
          >
            <ResizeHandle dragging={dragging} />
          </div>
        )}
      </div>
    </PaneShellContext.Provider>
  );
}

/** 拖拽提示竖条 — 平时全透明（干干净净）；hover/拖拽时出现长竖条（老大要求：长一些） */
function ResizeHandle({ dragging }: { dragging: boolean }) {
  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 h-[96px] w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150',
        'opacity-0 group-hover:opacity-100',
        dragging
          ? 'bg-[var(--ui-sash-hover-background)] opacity-100 ring-1 ring-[var(--ui-sash-hover-border)]'
          : 'bg-[var(--ui-sash-hover-background)] ring-1 ring-[var(--ui-sash-hover-border)]',
      )}
      aria-hidden
    />
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
