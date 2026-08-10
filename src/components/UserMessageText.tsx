import { memo, useMemo } from 'react';
import { DirectiveText } from './DirectiveText';

/**
 * UserMessageText — 用户消息最小 Markdown 渲染（对齐 Hermes UserMessageText）
 *
 * 只渲染两种结构（Hermes 同款设计原则：用户输入很少含结构化文档，
 * 不引入完整 marked 管线，成本最低）：
 * - ``` fenced block → 代码块（pre + code，保留原始换行与缩进）
 * - `inline code` → 行内代码高亮
 * - 其余全部按纯文本（React 文本节点自动转义，无 XSS 风险，不经过 DOMPurify）
 *
 * 换行语义：whitespace-pre-wrap 保留用户手动换行（ELEVE 输入框支持 Shift+Enter，
 * 尊重用户排版；Hermes 用 pre-line，差异是有意保留——用户主动换行不应被折叠）。
 */

interface FenceSegment {
  kind: 'fence';
  code: string;
  lang: string | null;
}

interface InlineSegment {
  kind: 'inline';
  text: string;
}

type TopSegment = FenceSegment | InlineSegment;

interface InlineNode {
  kind: 'code' | 'text';
  value: string;
}

// Greedy 反引号：``code with `backticks` inside`` 也能正确配对
const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;
const INLINE_CODE_RE = /(`+)([^`\n][\s\S]*?)\1/g;

function splitFences(text: string): TopSegment[] {
  const segments: TopSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(FENCE_RE)) {
    const start = match.index ?? 0;

    if (start > cursor) {
      segments.push({ kind: 'inline', text: text.slice(cursor, start) });
    }

    segments.push({
      kind: 'fence',
      lang: (match[1] || '').trim() || null,
      code: match[2] ?? '',
    });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'inline', text: text.slice(cursor) });
  }

  return segments;
}

function splitInlineCode(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_CODE_RE)) {
    const start = match.index ?? 0;

    if (start > cursor) {
      nodes.push({ kind: 'text', value: text.slice(cursor, start) });
    }

    nodes.push({ kind: 'code', value: match[2] });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push({ kind: 'text', value: text.slice(cursor) });
  }

  return nodes;
}

/** 行内文本 → 反引号 code 片段 + 纯文本（React 自动转义）；
 *  纯文本段再经 DirectiveText 渲染 @kind:value 引用 chip（对齐 Hermes 发送气泡 directive 渲染） */
function InlineText({ text }: { text: string }) {
  const nodes = useMemo(() => splitInlineCode(text), [text]);

  return (
    <>
      {nodes.map((node, index) =>
        node.kind === 'code' ? (
          <code
            key={index}
            className="mx-px rounded bg-[var(--ui-inline-code-background)] border border-[var(--ui-inline-code-border)] px-1 py-px font-mono text-[0.92em] text-[var(--ui-inline-code-foreground)] break-all"
          >
            {node.value}
          </code>
        ) : (
          <DirectiveText key={index} text={node.value} />
        )
      )}
    </>
  );
}

const UserMessageText = memo(function UserMessageText({ text }: { text: string }) {
  const segments = useMemo(() => splitFences(text), [text]);

  return (
    <span className="block whitespace-pre-wrap break-words select-text">
      {segments.map((segment, index) =>
        segment.kind === 'fence' ? (
          <pre
            key={`fence-${index}`}
            className="my-1.5 max-w-full overflow-x-auto rounded-md border border-border/45 bg-[color-mix(in_srgb,var(--dt-foreground)_5%,transparent)] px-2.5 py-2 font-mono text-[0.86em] leading-snug"
          >
            <code className="block whitespace-pre">{segment.code}</code>
          </pre>
        ) : (
          <InlineText key={`inline-${index}`} text={segment.text} />
        )
      )}
    </span>
  );
});

export default UserMessageText;
