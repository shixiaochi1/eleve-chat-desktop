import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ComingSoonButtonProps {
  /** 图标元素 */
  icon: ReactNode;
  /** 简短标签（如"文件""网页"） */
  label: string;
  /** 完整功能名（悬停提示用，如"上下文文件"） */
  title: string;
}

/**
 * 占位控件 — 后端能力尚未就绪的功能（上下文文件 / 网页窗口）
 *
 * 如实置灰 + 悬停提示"待后端支持"，不做假交互。
 * 后端就绪后，用真实组件替换本组件即可，位置与尺寸语言（28px 高）已预留。
 */
export default function ComingSoonButton({ icon, label, title }: ComingSoonButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex h-(--composer-control-size) shrink-0 cursor-not-allowed items-center gap-1 rounded-md px-1.5 outline-none',
        'text-muted-foreground/45'
      )}
      title={`${title} — 待后端支持`}
      aria-label={title}
      disabled
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
