import { Fragment, memo, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { FolderIcon, FileIcon, GlobeIcon, ImageIcon } from './Icons';
import { openLink } from '@/lib/external-open';
import { cn } from '@/lib/utils';

/**
 * DirectiveText — 消息文本中的 `@kind:value` 引用渲染（对齐 Hermes directive-text.tsx）
 *
 * Hermes 基线：发送气泡里的 `@file:`/`@folder:`/`@url:` 等引用渲染为 inline chip
 * （图标 + 截断 label + title 全值），URL chip 可点击打开外部链接
 * （DIRECTIVE_ACTIONS.url → openExternalLink）；file/folder 无动作（inert）。
 *
 * 识别正则对齐 Hermes referenceRe()（8 种 wire kinds，值支持反引号/双引号/单引号围栏）。
 * 在 UserMessageText 的行内文本层集成：文本段 → 引用 chip + 纯文本混合渲染。
 */

// 对齐 Hermes referenceRe()：@kind:value，value 可带 `…` / "…" / '…' 围栏
const DIRECTIVE_RE = /@(file|folder|url|image|tool|line|terminal|session):(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)/g;

/** 去引用值围栏 + 尾部标点（对齐 Hermes unwrapRefValue） */
function unwrapRefValue(raw: string): string {
  if (raw.length < 2) {
    return raw;
  }
  const head = raw[0];
  const tail = raw[raw.length - 1];
  const quoted =
    (head === '`' && tail === '`') || (head === '"' && tail === '"') || (head === "'" && tail === "'");

  return quoted ? raw.slice(1, -1) : raw.replace(/[,.;!?]+$/, '');
}

/** 单个引用显示 label（对齐 Hermes refChipLabel）：
 *  url → hostname + path（去 www. 与尾斜杠）；file/folder → 去 ./ 前缀 */
export function refChipLabel(type: string, id: string): string {
  if (type === 'url') {
    try {
      const { hostname, pathname, search } = new URL(id);
      const path = `${pathname}${search}`.replace(/\/$/, '');

      return `${hostname.replace(/^www\./i, '')}${path}` || id;
    } catch {
      return id;
    }
  }

  return id.replace(/^\.\//, '') || id;
}

function DirectiveIcon({ type }: { type: string }) {
  switch (type) {
    case 'file':
    case 'line':
    case 'tool':
      return <FileIcon size={11} className="shrink-0" />;
    case 'folder':
      return <FolderIcon size={11} className="shrink-0" />;
    case 'image':
      return <ImageIcon size={11} className="shrink-0" />;
    case 'url':
    case 'session':
      return <GlobeIcon size={11} className="shrink-0" />;
    default:
      return <FileIcon size={11} className="shrink-0" />;
  }
}

/** 打开 url 引用（🔴 2026-08-30 对齐 Hermes DIRECTIVE_ACTIONS.url → openLink：
 *  web 链接 → 内嵌预览面板，修饰键逃逸 OS；传输统一 lib/external-open，
 *  此处只做 ref 值解包与 event 透传） */
async function openExternalLink(id: string, event?: ReactMouseEvent) {
  await openLink(unwrapRefValue(id), event);
}

function DirectiveChip({ type, label, id }: { type: string; label: string; id: string }) {
  // 对齐 Hermes：仅 url 可点击（openExternalLink）；其余 inert
  const isUrl = type === 'url';
  const body = (
    <>
      <DirectiveIcon type={type} />
      <span className="truncate">{label}</span>
    </>
  );

  const baseCls = cn(
    'mx-px inline-flex max-w-[220px] cursor-default items-center gap-1 rounded-md border border-[var(--ui-stroke-tertiary)] bg-muted/40 px-1.5 py-px align-baseline text-[0.92em] text-foreground/90',
    isUrl && 'cursor-pointer hover:bg-accent hover:text-foreground'
  );

  if (isUrl) {
    return (
      <button
        type="button"
        className={baseCls}
        title={id}
        onClick={(e) => {
          e.stopPropagation();
          void openExternalLink(id, e);
        }}
      >
        {body}
      </button>
    );
  }

  return (
    <span className={baseCls} title={id}>
      {body}
    </span>
  );
}

interface DirectiveSegment {
  kind: 'text' | 'ref';
  text: string;
  type?: string;
  label?: string;
  id?: string;
}

function parseDirectives(text: string): DirectiveSegment[] {
  const segments: DirectiveSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(DIRECTIVE_RE)) {
    const start = match.index ?? 0;

    if (start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, start) });
    }

    const rawValue = match[2] ?? '';
    const id = unwrapRefValue(rawValue);
    const type = match[1] || 'file';

    if (id) {
      segments.push({ kind: 'ref', text: match[0], type, label: refChipLabel(type, id), id });
    } else {
      segments.push({ kind: 'text', text: match[0] });
    }

    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }

  return segments;
}

/** 行内文本 → 引用 chip + 纯文本（对齐 Hermes DirectiveContent 的段式渲染） */
export const DirectiveText = memo(function DirectiveText({ text }: { text: string }) {
  const segments = useMemo(() => parseDirectives(text), [text]);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'ref' && segment.type && segment.label && segment.id ? (
          <DirectiveChip key={`ref-${index}`} type={segment.type} label={segment.label} id={segment.id} />
        ) : (
          <Fragment key={`text-${index}`}>{segment.text}</Fragment>
        )
      )}
    </>
  );
});

export default DirectiveText;
