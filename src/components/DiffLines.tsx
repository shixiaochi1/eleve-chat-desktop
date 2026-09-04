import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface DiffLinesProps {
  /** unified diff 文本 */
  text: string;
  /** 最大高度（默认 384px = max-h-96） */
  maxHeight?: string;
  /**
   * 显示新旧行号 gutter（对齐 Hermes FileDiffPanel showLineNumbers：VS Code
   * 风格——add/context 显示新行号，remove 行空白；`newNo ?? ''` 同款）。
   * 工具卡片 compact 关闭；文件预览全量 diff 开启。
   */
  showLineNumbers?: boolean;
}

/** Diff 行类型 → 着色规则（对齐 Eleve diff-lines.tsx） */
const DIFF_LINE_KINDS = [
  { className: 'text-success', match: (l: string) => l.startsWith('+') && !l.startsWith('+++') },
  { className: 'text-danger', match: (l: string) => l.startsWith('-') && !l.startsWith('---') },
  { className: 'text-info', match: (l: string) => l.startsWith('@@') },
  { className: 'text-muted-foreground/70', match: (l: string) => l.startsWith('---') || l.startsWith('+++') || / → /.test(l.slice(0, 60)) },
];

/** 去除 diff 文本中的 ANSI 转义码和 review diff 前缀（导出：行尾改动量徽标与
 *  DiffLines 渲染对同一份 chrome-free 文本计数，保证 +N −M 与展开 diff 一致） */
export function stripInlineDiffChrome(value: string): string {
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

interface DiffRow {
  text: string;
  kind: 'add' | 'remove' | 'context' | 'hunk' | 'header' | 'other';
  oldNo?: number;
  newNo?: number;
}

/** 解析 unified diff → 行级数据（新旧行号追踪，对齐 Hermes parseDiff：
 *  add → newNo++；remove → oldNo++；context → 双++；@@ hunk 头重置游标） */
function parseDiffRows(text: string): DiffRow[] {
  const raw = stripInlineDiffChrome(text);
  if (!raw) return [];

  let oldNo = 1;
  let newNo = 1;
  const rows: DiffRow[] = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      rows.push({ text: line, kind: 'hunk' });
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      rows.push({ text: line, kind: 'header' });
    } else if (line.startsWith('+')) {
      rows.push({ text: line, kind: 'add', newNo: newNo++ });
    } else if (line.startsWith('-')) {
      rows.push({ text: line, kind: 'remove', oldNo: oldNo++ });
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      rows.push({ text: line, kind: 'other' });
    } else {
      rows.push({ text: line, kind: 'context', oldNo: oldNo++, newNo: newNo++ });
    }
  }

  return rows;
}

/** 行着色（按前缀，保持既有 compact 渲染一致） */
function rowClass(line: string): string | undefined {
  return DIFF_LINE_KINDS.find(k => k.match(line))?.className;
}

/**
 * DiffLines — unified diff 渲染器（对齐 Eleve diff-lines.tsx + Hermes FileDiffPanel）
 *
 * 按行着色：
 * - `+` → 绿色（新增行）
 * - `-` → 红色（删除行）
 * - `@@` → 天蓝色（块头）
 * - `---`/`+++`/`→` → 灰色（文件头）
 *
 * showLineNumbers → 左侧行号 gutter（对齐 Hermes：add/context 新行号，remove 空白）
 */
export default function DiffLines({ text, maxHeight = '384px', showLineNumbers = false }: DiffLinesProps) {
  const rows = useMemo(() => parseDiffRows(text), [text]);

  if (rows.length === 0) return null;

  return (
    <div
      className="text-xs font-mono bg-muted/50 rounded-md overflow-x-auto overflow-y-auto border border-[var(--ui-stroke-tertiary)]"
      style={{ maxHeight }}
    >
      {showLineNumbers ? (
        <div className="grid min-w-max grid-cols-[auto_minmax(0,1fr)]">
          {/* 行号 gutter（Hermes 同款：newNo ?? ''；remove 行空白） */}
          <div className="select-none text-right text-muted-foreground/55 sticky left-0 bg-muted/80">
            {rows.map((row, i) => (
              <div key={i} className="h-5 w-9 pr-2 leading-5 tabular-nums">
                {row.newNo ?? ''}
              </div>
            ))}
          </div>
          <div className="min-w-0">
            {rows.map((row, i) => (
              <div key={i} className={cn('h-5 px-2 leading-5 whitespace-pre', rowClass(row.text))}>
                {row.text}
              </div>
            ))}
          </div>
        </div>
      ) : (
        rows.map((row, i) => (
          <div key={i} className={cn('px-2 leading-5 whitespace-pre', rowClass(row.text))}>
            {row.text}
          </div>
        ))
      )}
    </div>
  );
}
