import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Copy, Check, ExternalLink, Download, Maximize2, Minimize2 } from 'lucide-react';
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
import { artifactDownloadName } from '@/lib/artifact-detect';
// 🔴 浏览器打开走已有插件（不造轮子，对齐 PreviewFilePane writeTextFile 先例）：
// tauri-plugin-fs 写临时文件（capability 已有 fs:allow-write-text-file + fs:scope **）
// + tauri-plugin-opener openPath（系统默认程序打开，capability opener:allow-open-path）
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { join, tempDir } from '@tauri-apps/api/path';
import ModeSwitcher, { type ModeOption } from '@/components/preview/ModeSwitcher';
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

/** 预览视图模式（对齐 Hermes ArtifactPreview：html/svg = rendered/source，code = 仅 source） */
type ArtifactViewMode = 'rendered' | 'source';

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
  // 🔴 全屏预览（老大 2026-08-05 要求）
  const [fullscreen, setFullscreen] = useState(false);
  // 视图模式：渲染/源码（对齐 Hermes ArtifactPreview userMode；切换 artifact 重置）
  const [userMode, setUserMode] = useState<ArtifactViewMode | null>(null);
  useEffect(() => { setUserMode(null); }, [openState?.id]);
  // 🔴 面板内缩放适配：量容器实际宽，HTML iframe 固定设计宽后 transform scale 缩放到容器宽
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);

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

  // 🔴 浏览器打开（对齐 Hermes saveImageBuffer + openPreviewInBrowser）：
  // blob/data URL 无法跨进程进入 OS 默认浏览器——写临时文件再交给系统默认程序。
  // 实现 = fs 插件 writeTextFile（PreviewFilePane spot editor 同款）→ opener openPath，零自定义命令。
  const openExternal = useCallback(async () => {
    if (!active || active.record.kind !== 'html') return;
    const content = composeArtifactHtml(active.version.content);
    try {
      const dir = await tempDir();
      const path = await join(dir, `artifact-${crypto.randomUUID()}.html`);
      await writeTextFile(path, content);
      await openPath(path);
    } catch (e) {
      // 降级：浏览器模式/开发环境（非 Tauri 运行时）
      const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }, [active]);

  const empty = !sessionId || sessionRecords.length === 0;

  // 🔴 缩放适配：量预览容器宽度（ResizeObserver，含面板拖拽变宽）
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerW((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 🔴 全屏 ESC 关闭
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const activeForRender = active && openState?.id && sessionRecords.some((r) => r.id === openState.id) ? active : null;

  // 视图模式决策（对齐 Hermes ArtifactPreview：可渲染 = html/svg，code 只有源码）
  const renderable = activeForRender
    ? activeForRender.record.kind === 'html' || activeForRender.record.kind === 'svg'
    : false;
  const viewModes: ModeOption<ArtifactViewMode>[] = renderable
    ? [{ key: 'rendered', label: '渲染' }, { key: 'source', label: '源码' }]
    : [{ key: 'source', label: '源码' }];
  const viewMode: ArtifactViewMode =
    userMode && viewModes.some((m) => m.key === userMode) ? userMode : viewModes[0].key;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            {activeForRender ? (
              <>
                <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
                  {/* 渲染/源码切换（对齐 Hermes PreviewModeSwitcher；仅多模式时显示） */}
                  {viewModes.length > 1 && (
                    <ModeSwitcher modes={viewModes} active={viewMode} onSelect={setUserMode} />
                  )}
                  <span className="ml-auto flex items-center gap-0.5">
                    <VersionStepper
                      current={openState!.versionIndex}
                      total={activeForRender.record.versions.length}
                      onSelect={(i) => selectArtifactVersion(activeForRender.record.id, i)}
                    />
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
                    {activeForRender.record.kind === 'html' && (
                      <>
                        <button
                          type="button"
                          onClick={openExternal}
                          title="浏览器打开"
                          className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                          <ExternalLink size={13} />
                        </button>
                        {/* 🔴 全屏预览（老大要求） */}
                        <button
                          type="button"
                          onClick={() => setFullscreen(true)}
                          title="全屏预览"
                          className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                          <Maximize2 size={13} />
                        </button>
                      </>
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
                <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto">
                  {viewMode === 'rendered' && renderable ? (
                    <ArtifactContentView
                      record={activeForRender.record}
                      content={activeForRender.version.content}
                      containerW={containerW}
                    />
                  ) : (
                    /* 源码视图（对齐 Hermes ArtifactPreview SourceView）：原始文本，
                       React 自动转义，无 dangerouslySetInnerHTML */
                    <div className="wrap-anywhere whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-[var(--ui-text-primary)]">
                      {activeForRender.version.content}
                    </div>
                  )}
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

      {/* 🔴 全屏预览浮层（portal 到 body）：HTML 产物大画面查看 */}
      {fullscreen && activeForRender && activeForRender.record.kind === 'html' && (
        <ArtifactFullscreen
          record={activeForRender.record}
          content={activeForRender.version.content}
          versionIndex={openState!.versionIndex}
          onClose={() => setFullscreen(false)}
          onSelectVersion={(i) => selectArtifactVersion(activeForRender.record.id, i)}
        />
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

/**
 * HTML 设计宽（缩放适配基准）：iframe 以固定设计宽渲染内容，
 * transform scale 缩放到容器宽 → 无横向滚动条、全貌可见（老大要求）。
 */
const HTML_DESIGN_WIDTH = 1280;

function ArtifactContentView({
  record,
  content,
  containerW = 0,
}: {
  record: ArtifactRecord;
  content: string;
  /** 容器实际宽度（ResizeObserver 提供）；0 = 未量到（不缩放） */
  containerW?: number;
}) {
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
    // 🔴 缩放适配（老大 2026-08-05）：iframe 固定 1280 设计宽，scale 到容器宽。
    // 高度按比例补（容器高 / scale），缩放后正好填满容器 → 无滚动条全貌可见。
    // 容器 < 1280 时缩小（scale<1）；容器 ≥1280 时不缩放（scale=1 原样）。
    const scale = containerW > 0 ? Math.min(1, containerW / HTML_DESIGN_WIDTH) : 1;
    return (
      <div className="relative size-full overflow-hidden bg-white">
        <div
          style={{
            width: HTML_DESIGN_WIDTH,
            height: `calc(100% / ${scale})`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <iframe
            className="block size-full border-0 bg-white"
            sandbox="allow-scripts"
            srcDoc={composeArtifactHtml(content)}
            style={{ colorScheme: 'light' }}
            title={record.title}
          />
        </div>
      </div>
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

/**
 * 全屏预览浮层（老大 2026-08-05 要求）：HTML 产物大画面查看。
 * portal 到 body，ESC / 关闭按钮退出；保留版本切换。
 */
function ArtifactFullscreen({
  record,
  content,
  versionIndex,
  onClose,
  onSelectVersion,
}: {
  record: ArtifactRecord;
  content: string;
  versionIndex: number;
  onClose: () => void;
  onSelectVersion: (index: number) => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-[var(--ui-bg-chrome)]"
      role="dialog"
      aria-label={`${record.title} 全屏预览`}
    >
      {/* 头部：标题 + 版本 + 操作 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{record.title}</span>
        <VersionStepper current={versionIndex} total={record.versions.length} onSelect={onSelectVersion} />
        <button
          type="button"
          onClick={onClose}
          title="退出全屏 (Esc)"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Minimize2 size={13} />
          退出全屏
        </button>
      </div>
      {/* 内容：大画面 iframe */}
      <div className="min-h-0 flex-1 bg-white">
        <iframe
          className="block size-full border-0 bg-white"
          sandbox="allow-scripts"
          srcDoc={composeArtifactHtml(content)}
          style={{ colorScheme: 'light' }}
          title={record.title}
        />
      </div>
    </div>,
    document.body,
  );
}
