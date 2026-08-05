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
  // 🔴 拖拽实现（2026-08-05 重写，根治“不流畅/拖到一半不动”）：
  // 旧实现三宗罪：① 每次 pointermove 直接 setState → 每帧整树重渲染（卡顿）
  // ② listener 依赖 [leftWidth,rightWidth] → 宽度一变就解绑重绑（间隙丢事件）
  // ③ setPointerCapture 到 resizer 元素，React 重渲染/类名变更下 capture 不可靠
  // 新实现：window 级监听只绑一次 + rAF 合并（每帧最多一次 setState）+
  // ref 读当前宽度（回调永不重建）→ 拖拽期间零重绑、零丢帧。
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

  // 🔴 拖拽中禁用 grid-template-columns transition（200ms 动画会造成拖拽滞后感）
  const [dragging, setDragging] = useState(false);

  const handleResizerDown = useCallback((side: 'left' | 'right', e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { side, startX: 'clientX' in e ? e.clientX : (e as any).touches?.[0]?.clientX ?? 0 };
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // 每帧最多应用一次宽度变化（rAF 合并）
  const applyDrag = useCallback(() => {
    rafRef.current = 0;
    const drag = dragRef.current;
    const clientX = pendingXRef.current;
    if (!drag || clientX == null) return;
    pendingXRef.current = null;

    const delta = clientX - drag.startX;
    drag.startX = clientX;

    const w = widthRef.current;
    const limits = limitsRef.current;
    const cb = onResizeRef.current;

    if (drag.side === 'left') {
      const next = Math.max(limits.minL, Math.min(limits.maxL, w.left + delta));
      cb.left?.(next);
    } else {
      // right pane：向左拖 = 变宽（负 delta = 更大 pane）
      const next = Math.max(limits.minR, Math.min(limits.maxR, w.right - delta));
      cb.right?.(next);
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
    dragRef.current = null;
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
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
  const gridTemplate = useMemo(() => {
    const left = leftOpen ? leftWidth : '0px';
    const right = rightOpen ? rightWidth : '0px';
    return `${left} 1fr ${right}`;
  }, [leftOpen, leftWidth, rightOpen, rightWidth]);

  // Emit pane widths as CSS variables for animation
  const composedStyle: React.CSSProperties = {
    ...style,
    gridTemplateColumns: gridTemplate,
    '--pane-left-width': leftWidth,
    '--pane-right-width': rightWidth,
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
          'relative grid min-w-[640px] flex-1 min-h-0 overflow-hidden transition-[grid-template-columns,padding-left,padding-right] duration-200 grid-rows-[minmax(0,1fr)] gap-2',
          leftOpen ? 'pl-2' : 'pl-0',
          rightOpen ? 'pr-2' : 'pr-0',
          dragging && 'transition-none',
          className,
          !rightOpen && 'pane-right-closed',
        )}
        style={{ ...composedStyle, background: 'transparent' }}
      >
        {children}
        {/* Resizer handles — absolute overlay on the grid GAP（缝隙），不占用列轨道：
            平时透明无痕；hover/active 显示淡色条（--ui-sash-hover-background 6% accent）。
            缝隙大小 = grid gap-2 固定 8px 不变，拖拽只改 pane 宽度（grid-template-columns）。
            🔴 旧实现：grid item 未指定行 → auto-placement 进隐式第二行（高度 auto=0）→ 不可点。 */}
        {leftOpen && (
          <div
            className={cn(
              'absolute top-0 bottom-0 z-10 w-[8px] -translate-x-1/2 cursor-col-resize transition-colors duration-[180ms] hover:bg-[var(--ui-sash-hover-background)] active:bg-[var(--ui-sash-hover-background)]',
              dragging && 'bg-[var(--ui-sash-hover-background)]',
            )}
            style={{ left: `calc(${leftWidth} + 4px)` }}
            onPointerDown={(e: React.PointerEvent) => handleResizerDown('left', e)}
          />
        )}
        {rightOpen && (
          <div
            className={cn(
              'absolute top-0 bottom-0 z-10 w-[8px] translate-x-1/2 cursor-col-resize transition-colors duration-[180ms] hover:bg-[var(--ui-sash-hover-background)] active:bg-[var(--ui-sash-hover-background)]',
              dragging && 'bg-[var(--ui-sash-hover-background)]',
            )}
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
