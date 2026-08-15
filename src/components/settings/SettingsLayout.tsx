import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface SettingsLayoutProps {
  nav: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
}

/**
 * SettingsLayout — 中分双卡布局（老大 2026-08-15 定稿）
 *
 * 背板 = body（--theme-background，由 SettingsPanel main 提供）
 * 布局 = 左右两张竖向卡片，无标题栏/无遮罩/无分割线
 * 关闭 = 右上角唯一极简 X（图标无背景无边框）
 */
export default function SettingsLayout({ nav, footer, children, onClose }: SettingsLayoutProps) {
  return (
    <div className="relative h-full p-4 flex gap-4">
      {/* 右上角唯一关闭按钮（极简：图标无背景无边框） */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-md text-[var(--theme-muted-foreground)] hover:text-[var(--theme-foreground)] hover:bg-[var(--theme-accent)]/15 transition-colors z-10"
          title="关闭"
          aria-label="关闭"
        >
          <X size={18} strokeWidth={1.5} />
        </button>
      )}

      {/* 左卡：导航（淡主题色） */}
      <div className="w-48 shrink-0 rounded-xl bg-[var(--ui-bg-backboard)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {nav}
        </div>
        {footer && (
          <div className="shrink-0 p-2">
            {footer}
          </div>
        )}
      </div>

      {/* 右卡：内容（纯色） */}
      <div className="flex-1 rounded-xl bg-[var(--ui-card-bg)] overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
