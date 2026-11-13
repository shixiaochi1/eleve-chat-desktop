import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface SettingsLayoutProps {
  nav: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  /** 🔴 2026-11-13：分区键——变化时重建滚动容器，切分区回到顶部
   *  （此前右侧只有一个滚动容器，从「模型」滚到底再点「系统」会从底部开始） */
  contentKey?: string;
}

/**
 * SettingsLayout — 设置面板（老大 2026-08-15 定稿）
 *
 * 形态：点击设置弹出的**一张干净卡片**（由外层 OverlayView panel 模式承载，居中弹窗）。
 * 卡片内部 = 左侧导航 + 右侧内容，左右贴在一起（flex 无 gap、无 border 分隔），
 * 整体一张圆角卡片：左卡淡主题色（--ui-bg-backboard）、右卡纯色（--ui-card-bg）。
 * 无标题栏、无分割线、无背板缝隙——整个布局就只有左右两块的卡片。
 * 关闭 = 右上角唯一极简 X（图标无背景无边框）。
 */
export default function SettingsLayout({ nav, footer, children, onClose, contentKey }: SettingsLayoutProps) {
  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-xl bg-[var(--ui-card-bg)]">
      {/* 右上角唯一关闭按钮（极简：图标无背景无边框） */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded-md text-[var(--theme-muted-foreground)] hover:text-[var(--theme-foreground)] hover:bg-[var(--theme-accent)]/15 transition-colors z-10"
          title="关闭"
          aria-label="关闭"
        >
          <X size={18} strokeWidth={1.5} />
        </button>
      )}

      {/* 左卡：导航（淡主题色），与右卡贴紧无缝隙 */}
      <div className="w-48 shrink-0 bg-[var(--ui-bg-backboard)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {nav}
        </div>
        {footer && (
          <div className="shrink-0 p-2">
            {footer}
          </div>
        )}
      </div>

      {/* 右卡：内容（纯色），与左卡贴紧无缝隙 */}
      <div className="flex-1 min-w-0 bg-[var(--ui-card-bg)] flex flex-col overflow-hidden">
        <div key={contentKey} className="flex-1 overflow-y-auto pt-16 px-6 pb-8">
          {children}
        </div>
      </div>
    </div>
  );
}