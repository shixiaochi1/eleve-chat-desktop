import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface SettingsLayoutProps {
  nav: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
}

/**
 * SettingsLayout — split layout container (1+N 卡片布局)
 *
 * 1 = 背板（body background）
 * N = 卡片（左侧导航 + 右侧内容）
 * 关闭按钮绝对定位在右上角
 */
export default function SettingsLayout({ nav, footer, children, onClose }: SettingsLayoutProps) {
  return (
    <div className="flex h-full gap-4 p-4 bg-[var(--theme-background)] relative">
      {/* Close Button - Absolute positioned */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg bg-[var(--ui-card-bg)] backdrop-blur-[20px] border border-[var(--ui-card-border)] hover:bg-[var(--theme-hover)] text-[var(--theme-text)] transition-colors z-10"
          title="关闭"
        >
          <X size={18} />
        </button>
      )}

      {/* Left Navigation Card */}
      <div className="w-48 shrink-0 rounded-xl bg-[var(--ui-card-bg)] backdrop-blur-[20px] border border-[var(--ui-card-border)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {nav}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-[var(--ui-card-border)] p-2">
            {footer}
          </div>
        )}
      </div>

      {/* Right Content Card */}
      <div className="flex-1 rounded-xl bg-[var(--ui-card-bg)] backdrop-blur-[20px] border border-[var(--ui-card-border)] overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
