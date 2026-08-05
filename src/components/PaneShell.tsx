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
  onResizerDown: (side: string, e: React.PointerEvent) => void;
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
  // Resizer drag state
  const dragRef = useRef<{ side: string; startX: number } | null>(null);
  // 🔴 拖拽中禁用 grid-template-columns transition（200ms 动画会造成拖拽滞后感）
  const [dragging, setDragging] = useState(false);

  const handleResizerDown = useCallback((side: string, e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { side, startX: 'clientX' in e ? e.clientX : (e as any).touches?.[0]?.clientX ?? 0 };
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!dragRef.current) return;
    const { side, startX } = dragRef.current;
    const clientX = e.clientX;
    const delta = clientX - startX;

    if (side === 'left' && onLeftResize) {
      const currentW = parseFloat(leftWidth) || 260;
      const newW = Math.max(minLeftWidth, Math.min(maxLeftWidth, currentW + delta));
      onLeftResize(newW);
      dragRef.current.startX = clientX;
    } else if (side === 'right' && onRightResize) {
      const currentW = parseFloat(rightWidth) || 200;
      // For right pane, dragging left should decrease width (negative delta = bigger pane)
      const newW = Math.max(minRightWidth, Math.min(maxRightWidth, currentW - delta));
      onRightResize(newW);
      dragRef.current.startX = clientX;
    }
  }, [leftWidth, rightWidth, minLeftWidth, maxLeftWidth, minRightWidth, maxRightWidth, onLeftResize, onRightResize]);

  const handlePointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

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
