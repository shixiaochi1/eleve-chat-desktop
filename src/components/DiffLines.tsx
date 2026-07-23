import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface DiffLinesProps {
  /** unified diff 文本 */
  text: string;
  /** 最大高度（默认 384px = max-h-96） */
  maxHeight?: string;
}

/** Diff 行类型 → 着色规则（对齐 Eleve diff-lines.tsx） */
const DIFF_LINE_KINDS = [
  { className: 'text-success', match: (l: string) => l.startsWith('+') && !l.startsWith('+++') },
  { className: 'text-danger', match: (l: string) => l.startsWith('-') && !l.startsWith('---') },
  { className: 'text-info', match: (l: string) => l.startsWith('@@') },
  { className: 'text-muted-foreground/70', match: (l: string) => l.startsWith('---') || l.startsWith('+++') || / → /.test(l.slice(0, 60)) },
];

/** 去除 diff 文本中的 ANSI 转义码和 review diff 前缀 */
function stripInlineDiffChrome(value: string): string {
  // 去除 ANSI 转义码
  let cleaned = value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // 去除 "┊ review diff" 前缀
  cleaned = cleaned.replace(/^┊\s*review diff\s*\n?/i, '');
  return cleaned.trim();
}

/** 从工具结果中提取 inline_diff 字段 */
export function inlineDiffFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;
  if (typeof obj.inline_diff === 'string' && obj.inline_diff.trim()) {
    return stripInlineDiffChrome(obj.inline_diff);
  }
  return null;
}

/**
 * DiffLines — unified diff 渲染器（对齐 Eleve diff-lines.tsx）
 *
 * 按行着色：
 * - `+` → 绿色（新增行）
 * - `-` → 红色（删除行）
 * - `@@` → 天蓝色（块头）
 * - `---`/`+++`/`→` → 灰色（文件头）
 */
export default function DiffLines({ text, maxHeight = '384px' }: DiffLinesProps) {
  const lines = useMemo(() => {
    const raw = stripInlineDiffChrome(text);
    if (!raw) return [];
    return raw.split('\n');
  }, [text]);

  if (lines.length === 0) return null;

  return (
    <pre
      className="text-xs font-mono bg-muted/50 rounded-md overflow-x-auto overflow-y-auto border border-border"
      style={{ maxHeight }}
    >
      {lines.map((line, i) => {
        const kind = DIFF_LINE_KINDS.find(k => k.match(line));
        return (
          <div key={i} className={cn('px-2 leading-5', kind?.className)}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
