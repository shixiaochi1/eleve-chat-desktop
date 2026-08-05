/**
 * ModeSwitcher — 预览模式切换按钮组（对齐 Hermes PreviewModeSwitcher）
 *
 * 共享消费方：
 * - PreviewFilePane：渲染 / 源码 / 变更（独立一行，右对齐）
 * - ArtifactPanel：渲染 / 源码（并入操作栏左侧）
 *
 * 只渲染按钮组本身；容器行/布局由消费方决定。
 */
import { cn } from '@/lib/utils';

export interface ModeOption<K extends string> {
  key: K;
  label: string;
}

interface ModeSwitcherProps<K extends string> {
  modes: readonly ModeOption<K>[];
  active: K;
  onSelect: (key: K) => void;
}

export default function ModeSwitcher<K extends string>({ modes, active, onSelect }: ModeSwitcherProps<K>) {
  return (
    <div className="flex items-center gap-3">
      {modes.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => onSelect(m.key)}
          className={cn(
            'text-[10px] font-bold underline-offset-4 transition-colors',
            m.key === active
              ? 'text-[var(--ui-text-primary)] underline'
              : 'text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)]',
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
