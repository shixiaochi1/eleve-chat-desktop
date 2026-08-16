/**
 * ModelCatalogMenu — 模型覆盖选择器（对齐 Hermes ModelOverrideField +
 * ModelCatalogMenu，model-override.tsx L55-142）
 *
 * 替代裸文本框：搜索 / Provider 分组 / 推理深度白名单 / 一键清除（触发按钮
 * 内嵌 ×，不清除时不打开菜单）。创建（CreateTaskDrawer）与编辑（TaskDrawer）
 * 双入口共享；值受控由调用方持有（创建 = 表单状态，编辑 = draft 后 PATCH）。
 */
import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  dropdownMenuRow,
  dropdownMenuSectionLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** 模型覆盖三元组（对齐 Hermes TaskModelOverride：model + provider + effort） */
export interface ModelOverrideValue {
  model: string;
  provider: string;
  effort: string;
}

/** 目录行：model → provider 映射（profiles 派生去重） */
export interface ModelCatalogRow {
  model: string;
  provider: string;
}

/** 推理深度白名单（对齐 Hermes VALID_REASONING_EFFORTS / ELEVE 后端校验） */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

export const EMPTY_MODEL_OVERRIDE: ModelOverrideValue = { model: '', provider: '', effort: '' };

export function isModelOverrideInherited(v: ModelOverrideValue): boolean {
  return !v.model && !v.provider && !v.effort;
}

export function modelOverrideLabel(v: ModelOverrideValue): string {
  const parts: string[] = [];
  if (v.model) parts.push(v.model);
  if (v.provider) parts.push(`@ ${v.provider}`);
  if (v.effort) parts.push(`· ${v.effort}`);
  return parts.join(' ') || '继承 profile';
}

/** 从 profiles 派生 model→provider 目录（按 model 去重，空 model 丢弃） */
export function buildModelCatalog(
  profiles: Array<{ model?: string; provider?: string }>,
): ModelCatalogRow[] {
  const seen = new Set<string>();
  const out: ModelCatalogRow[] = [];
  for (const p of profiles) {
    const model = (p.model || '').trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    out.push({ model, provider: (p.provider || '').trim() });
  }
  return out;
}

/**
 * 受控模型覆盖选择器（对齐 Hermes ModelOverrideField）：
 * - 触发按钮：继承态显示「继承 profile」灰字；已设置显示 model @ provider · effort，
 *   内嵌 × 一键清除（不打开菜单，对齐 Hermes clear 按钮语义）
 * - 菜单：搜索过滤 + Provider 分组列表 + 底部推理深度白名单下拉
 */
export function ModelCatalogMenuField({
  catalog,
  value,
  onChange,
  triggerClassName,
}: {
  catalog: ModelCatalogRow[];
  value: ModelOverrideValue;
  onChange: (next: ModelOverrideValue) => void;
  triggerClassName?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const inherited = isModelOverrideInherited(value);

  // Provider 分组（保持目录顺序；搜索命中 model 或 provider 子串）
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? catalog.filter(
          r => r.model.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q),
        )
      : catalog;
    const map = new Map<string, ModelCatalogRow[]>();
    for (const row of rows) {
      const key = row.provider || '(未指定)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return [...map.entries()];
  }, [catalog, query]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 text-[0.75rem] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)]',
            inherited && 'text-[var(--color-muted-foreground)]',
            triggerClassName,
          )}
        >
          <span className="min-w-0 truncate">{modelOverrideLabel(value)}</span>
          <span className="flex shrink-0 items-center gap-1">
            {!inherited && (
              <span
                role="button"
                aria-label="清除模型覆盖（继承）"
                title="清空（继承 assigned profile）"
                className="grid size-4 place-items-center rounded text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                onClick={e => {
                  // 清除不打开菜单（对齐 Hermes model-override.tsx L116-130）
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(EMPTY_MODEL_OVERRIDE);
                }}
              >
                <X size={12} strokeWidth={1.5} />
              </span>
            )}
            <ChevronDown size={12} strokeWidth={1.5} className="opacity-50" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-0">
        <DropdownMenuSearch placeholder="搜索模型 / Provider…" onValueChange={setQuery} />
        {grouped.length === 0 && (
          <div className="px-2.5 py-3 text-[0.7rem] text-[var(--color-muted-foreground)]">
            无匹配模型
          </div>
        )}
        {grouped.map(([provider, rows]) => (
          <DropdownMenuGroup key={provider}>
            <DropdownMenuLabel className={dropdownMenuSectionLabel}>{provider}</DropdownMenuLabel>
            {rows.map(row => (
              <DropdownMenuItem
                key={`${provider}:${row.model}`}
                className={dropdownMenuRow}
                onSelect={() =>
                  onChange({ model: row.model, provider: row.provider, effort: value.effort })
                }
              >
                <span className="flex-1 truncate">{row.model}</span>
                {value.model === row.model && value.provider === row.provider && (
                  <Check size={12} strokeWidth={2} className="shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="shrink-0 text-[0.65rem] text-[var(--color-muted-foreground)]">推理深度</span>
          <select
            value={value.effort}
            onChange={e => onChange({ ...value, effort: e.target.value })}
            className="flex-1 h-7 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 text-[0.7rem] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-ring)]"
          >
            <option value="">继承</option>
            {REASONING_EFFORTS.map(e => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
