import type { ReactNode } from 'react';

interface SettingsLayoutProps {
  nav: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * SettingsLayout — split layout container (1+N 卡片布局)
 *
 * 1 = 背板（body background）
 * N = 卡片（左侧导航 + 右侧内容）
 * 关闭由外层 OverlayView 标题栏承担（ESC/backdrop/X），本组件不再内置关闭按钮
 */
export default function SettingsLayout({ nav, footer, children }: SettingsLayoutProps) {
  return (
    <div className="flex h-full gap-4">
      {/* Left Navigation Card — 淡主题色（--ui-bg-backboard = accent 5% 变体） */}
      <div className="w-48 shrink-0 rounded-xl bg-[var(--ui-bg-backboard)] border border-[var(--ui-card-border)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {nav}
        </div>
        {footer && (
          <div className="shrink-0 p-2">
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
