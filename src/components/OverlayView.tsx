/**
 * OverlayView — 全屏浮层组件
 * 用于 Settings、About 等需要更多空间的密集面板
 * 特性：ESC 关闭、点击 backdrop 关闭、入场滑入动画
 */
import { useEffect, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OverlayViewProps {
  children: ReactNode;
  onClose?: () => void;
  title?: string;
  wide?: boolean;
}

export default function OverlayView({ children, onClose, title, wide = false }: OverlayViewProps) {
  // ESC 键关闭
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose?.();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // 锁定背景滚动
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => onClose?.()}>
      <div className={cn("flex flex-col bg-popover text-popover-foreground rounded-lg shadow-lg overflow-hidden animate-in zoom-in-95 duration-200", wide ? "w-[96vw] max-w-[1600px] h-[90vh] max-h-[960px]" : "w-[90vw] max-w-4xl h-[85vh] max-h-[800px]")} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
          <button
            className="ml-auto p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => onClose?.()}
            title="关闭"
            aria-label="关闭"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
