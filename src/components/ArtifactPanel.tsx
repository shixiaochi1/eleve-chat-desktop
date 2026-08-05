import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Check, ExternalLink, Download } from 'lucide-react';
import { ContextFileIcon, WebWindowIcon, ImageIcon } from './Icons';
import { cn } from '@/lib/utils';
import {
  useArtifacts,
  useOpenArtifact,
  openArtifact,
  closeArtifact,
  selectArtifactVersion,
  findArtifactVersion,
  type ArtifactRecord,
} from '@/store/artifacts';
import { renderMarkdown } from '@/utils/markdown';
import DOMPurify from 'dompurify';

const KIND_ICON = {
  code: ContextFileIcon,
  html: WebWindowIcon,
  svg: ImageIcon,
} as const;

const KIND_LABEL = {
  code: '代码',
  html: 'HTML',
  svg: 'SVG',
} as const;

/** 包装 HTML 片段为最小文档壳（完整文档原样通过，对齐 Hermes composeArtifactHtml） */
function composeArtifactHtml(content: string): string {
  if (/<html[\s>]|<!doctype\s+html/i.test(content)) return content;
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>',
    content,
    '</body></html>',
  ].join('\n');
}

/** 下载文件名（对齐 Hermes artifactDownloadName） */
function artifactDownloadName(kind: string, language: string, title: string): string {
  const ext = kind === 'html' ? 'html' : kind === 'svg' ? 'svg' : (language || 'txt');
  const base = title.trim().replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 60) || `artifact.${ext}`;
  return `${base}.${ext}`;
}

/**
 * 右栏 Artifact 预览面板（对齐 Hermes right-rail preview-artifact）：
 * - 左侧：当前会话 artifact 列表（图标 + 标题 + 版本数），点击切换
 * - 右侧：选中 artifact 预览 — html sandbox iframe / svg DOMPurify 内联 / code 高亮
 * - 头部：版本步进器 v1/v2… + 复制 + 下载 + 外部打开
 * 打开语义：点击消息内卡片 → store openArtifact → 本面板跟随 openState 展示。
 */
const ArtifactPanel = memo(function ArtifactPanel({ sessionId }: { sessionId: string | null | undefined }) {
  const registry = useArtifacts();
  const openState = useOpenArtifact();
  const [copied, setCopied] = useState(false);

  const sessionRecords = useMemo(
    () => (sessionId ? (registry[sessionId] ?? []) : []),
    [registry, sessionId],
  );

  const active = useMemo(() => {
    if (!openState) return null;
    // 打开的是当前会话的 artifact 才展示（跨会话 artifact 列表不可见，仅跟随 openState 展示）
    return findArtifactVersion(openState.id, openState.versionIndex);
  }, [openState]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = useCallback(() => {
    if (!active) return;
    navigator.clipboard.writeText(active.version.content).then(() => setCopied(true)).catch(() => {});
  }, [active]);

  const handleDownload = useCallback(() => {
    if (!active) return;
    const { record, version } = active;
    const mime = record.kind === 'html' ? 'text/html' : record.kind === 'svg' ? 'image/svg+xml' : 'text/plain';
    const blob = new Blob([version.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifactDownloadName(record.kind, record.language, record.title);
    a.click();
    URL.revokeObjectURL(url);
  }, [active]);

  const openExternal = useCallback(() => {
    if (!active) return;
    const { record, version } = active;
    if (record.kind !== 'html') return;
    const url = URL.createObjectURL(new Blob([composeArtifactHtml(version.content)], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [active]);

  const empty = !sessionId || sessionRecords.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 列表头 */}
      <div className="shrink-0 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
        产物 {sessionRecords.length > 0 && <span className="tabular-nums">({sessionRecords.length})</span>}
      </div>

      {empty ? (
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-muted-foreground/70">
          消息里的 HTML / SVG / 大代码块会在这里列出
        </div>
      ) : (
        <>
          {/* artifact 列表 */}
          <div className="shrink-0 overflow-x-auto border-b border-border p-1.5">
            <div className="flex gap-1.5">
              {sessionRecords.map((record) => (
                <ArtifactListItem
                  key={record.id}
                  record={record}
                  active={openState?.id === record.id}
                  onSelect={() => openArtifact(record.id)}
                />
              ))}
            </div>
          </div>

          {/* 预览区 */}
          <div className="flex min-h-0 flex-1 flex-col">
            {active && openState?.id && sessionRecords.some((r) => r.id === openState.id) ? (
              <>
                <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
                  <VersionStepper
                    current={openState.versionIndex}
                    total={active.record.versions.length}
                    onSelect={(i) => selectArtifactVersion(active.record.id, i)}
                  />
                  <span className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={handleCopy}
                      title={copied ? '已复制' : '复制内容'}
                      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownload}
                      title="下载"
                      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <Download size={13} />
                    </button>
                    {active.record.kind === 'html' && (
                      <button
                        type="button"
                        onClick={openExternal}
                        title="浏览器打开"
                        className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      >
                        <ExternalLink size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={closeArtifact}
                      title="关闭"
                      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    >
                      <ChevronRight size={13} />
                    </button>
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <ArtifactContentView record={active.record} content={active.version.content} />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
                点击上方产物卡片查看预览
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default ArtifactPanel;

function ArtifactListItem({
  record,
  active,
  onSelect,
}: {
  record: ArtifactRecord;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = KIND_ICON[record.kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-colors',
        active
          ? 'border-accent-cyan/50 bg-accent/10 text-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
      )}
      title={record.title}
    >
      <Icon size={13} className="shrink-0" />
      <span className="max-w-[9rem] truncate text-xs font-medium">{record.title}</span>
      {record.versions.length > 1 && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">v{record.versions.length}</span>
      )}
    </button>
  );
}

function VersionStepper({
  current,
  total,
  onSelect,
}: {
  current: number;
  total: number;
  onSelect: (index: number) => void;
}) {
  if (total < 2) return null;
  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={current === 0}
        onClick={() => onSelect(current - 1)}
        title="上一版本"
        className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft size={13} />
      </button>
      <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
        v{current + 1}/{total}
      </span>
      <button
        type="button"
        disabled={current === total - 1}
        onClick={() => onSelect(current + 1)}
        title="下一版本"
        className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight size={13} />
      </button>
      {current < total - 1 && (
        <button
          type="button"
          onClick={() => onSelect(total - 1)}
          className="cursor-pointer text-[10px] font-bold text-muted-foreground underline decoration-muted-foreground/25 underline-offset-2 transition-colors hover:text-foreground"
        >
          最新
        </button>
      )}
    </span>
  );
}

function ArtifactContentView({ record, content }: { record: ArtifactRecord; content: string }) {
  // 🔴 useMemo 必须在组件顶层（条件分支内调用违反 Rules of Hooks）
  const svgClean = useMemo(
    () => DOMPurify.sanitize(content, { USE_PROFILES: { svg: true, svgFilters: true } }),
    [content],
  );

  if (record.kind === 'svg') {
    return (
      <div className="grid h-full place-items-center overflow-auto bg-background p-4 [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full">
        <div dangerouslySetInnerHTML={{ __html: svgClean }} />
      </div>
    );
  }

  if (record.kind === 'html') {
    return (
      <iframe
        className="block size-full border-0 bg-white"
        sandbox="allow-scripts"
        srcDoc={composeArtifactHtml(content)}
        style={{ colorScheme: 'light' }}
        title={record.title}
      />
    );
  }

  // code
  return (
    <div
      className="wrap-anywhere p-3 text-xs leading-relaxed"
      dangerouslySetInnerHTML={{
        __html: renderMarkdown(`\`\`\`${record.language}\n${content}\n\`\`\``),
      }}
    />
  );
}
