/**
 * FilterGroup — 筛选面板里的一个分组（标签 + 选项 + 选中打勾）。
 *
 * 🔴 2026-09-17 round-116 P4.5：从 components/BotsPane.tsx 迁出（消除新面板对
 * 待删文件的依赖）。BotsPane 改为再导出，旧调用点零改动。渲染逐字未改。
 */
import { Check } from 'lucide-react';

/** 🔴 round-108：过滤面板里的一个分组（对齐 Hermes 的 DropdownMenu 分组 + 选中打勾）。 */
export function FilterGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: [string, string][];
  value: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="py-1">
      <div className="px-3 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      {options.map(([v, text]) => (
        <button
          key={`${label}:${v}`}
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent/50 text-left"
          onClick={() => onSelect(v)}
        >
          <span className="min-w-0 flex-1 truncate">{text}</span>
          {value === v && <Check size={12} className="shrink-0 text-primary" />}
        </button>
      ))}
    </div>
  );
}
