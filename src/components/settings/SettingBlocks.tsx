import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * SettingBlocks — 设置面板统一卡片组件（macOS System Settings 分组风格）
 *
 * 2026-08-31 设置页卡片 UI 重构：此前各设置页风格碎片化——ChatSettings 有
 * 本地 SectionCard，Memory/Voice/Safety/Workspace/Connection 是裸表单
 * （muted 小字标签主次颠倒 + mb-3 间距散乱 + my-4 占位 div + 控件宽度不一）。
 *
 * 统一设计约定：
 * - 分区 = 一张 rounded-xl 卡片（bg-card + 极淡边框 + shadow-xs）
 * - 卡片头 = 图标 chip（bg-primary/10）+ 标题 + 描述
 * - 内容行之间 hairline 分隔（divide-y），行 hover 跟随主题
 *   （--ui-row-hover-background，比硬编码 bg-muted 更贴主题）
 * - 标签用主文字色（font-medium text-foreground），说明文字 muted——修复主次颠倒
 *
 * 三件套：
 * - SectionCard  分区卡片（图标 chip + 标题 + 描述，内容行自动分隔）
 * - SettingRow   行式设置项（左 label/desc，右控件；开关/状态类）
 * - SettingField 字段式设置项（label 上、控件中、说明下；输入/下拉类）
 */

interface SectionCardProps {
  icon: LucideIcon;
  title: string;
  desc?: string;
  /** 头部右侧附加内容（如分区级开关） */
  headerTrailing?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** 分区卡片：图标 + 标题 + 描述 + 内容行（行间自动细分隔线） */
export function SectionCard({ icon: Icon, title, desc, headerTrailing, className, children }: SectionCardProps) {
  return (
    <section className={cn('mb-5 overflow-hidden rounded-xl border border-[var(--ui-stroke-tertiary)] bg-card shadow-xs', className)}>
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon size={15} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold leading-tight text-foreground">{title}</h3>
          {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
        </div>
        {headerTrailing}
      </div>
      <div className="divide-y divide-[var(--ui-stroke-quaternary)] border-t border-[var(--ui-stroke-quaternary)]">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  desc?: string;
  className?: string;
  children: ReactNode;
}

/** 行式设置项：左 label + 描述，右控件（开关/徽章/按钮），整行 hover 反馈 */
export function SettingRow({ label, desc, className, children }: SettingRowProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--ui-row-hover-background)]',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-snug text-foreground">{label}</div>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

interface SettingFieldProps {
  label: string;
  desc?: string;
  className?: string;
  children: ReactNode;
}

/** 字段式设置项：label 上、控件中、说明下（输入框/下拉/选项组），无 hover（整行不可点） */
export function SettingField({ label, desc, className, children }: SettingFieldProps) {
  return (
    <div className={cn('px-4 py-3.5', className)}>
      <div className="mb-1.5 text-[13px] font-medium leading-snug text-foreground">{label}</div>
      {children}
      {desc && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
    </div>
  );
}

/** 保存栏：卡片流底部右对齐的保存按钮容器 */
export function SettingsSaveBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center justify-end gap-2 pt-1', className)}>{children}</div>;
}
