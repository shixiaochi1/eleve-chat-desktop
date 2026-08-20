/**
 * 跨会话产物画廊（对齐 Hermes app/artifacts）
 *
 * 展示组件：过滤 tabs（全部/图片/文件/链接 + 计数）+ 图片网格 24/页（点击放大）
 * + 文件/链接表格 100/页（点击打开）。
 * 数据/搜索/刷新由外层持有（useArtifactsGallery hook），搜索框与刷新按钮
 * 渲染在右栏产物 tab 的「产物库」栏（ArtifactPanel 视图切换条右侧）。
 * 打开：link → 系统浏览器（shell open）；file → 系统默认程序（opener openPath）；
 * 图片本地文件 → fs readFile → Blob URL 显示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import {
  ExternalLink, FileText, FolderOpen, Image as ImageIcon, Link2, Loader2, Maximize2, RefreshCw,
} from 'lucide-react';
import ImageLightbox from '@/components/ImageLightbox';
import { notifyError, notifySuccess } from '@/utils/notifications';
import { cn } from '@/lib/utils';
import {
  ARTIFACT_FILTERS,
  type ArtifactFilter,
  type GalleryArtifact,
} from '@/lib/artifacts-gallery';
import { TextTab, TextTabMeta } from '@/components/ui/text-tab';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Pagination, PaginationButton, PaginationContent, PaginationEllipsis, PaginationItem, PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination';

const IMAGE_PAGE_SIZE = 24;
const FILE_PAGE_SIZE = 100;

const KIND_LABEL: Record<GalleryArtifact['kind'], string> = {
  image: '图片',
  file: '文件',
  link: '链接',
};

function formatArtifactTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 图片 src 解析：http/data 直通；本地文件 → fs readFile → Blob URL（Hermes artifactImageSrc 等价） */
async function resolveImageSrc(value: string, href: string): Promise<string> {
  if (/^(?:https?|data):/i.test(value)) return href;
  // file:// 前缀剥掉（readFile 只收本地路径）
  const path = value.startsWith('file://') ? value.slice('file://'.length) : value;
  try {
    const bytes = await readFile(path);
    const ext = (/\.(\w{2,4})(?:\?.*)?$/.exec(value)?.[1] ?? '').toLowerCase();
    const mime =
      ext === 'svg' ? 'image/svg+xml' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      ext === 'bmp' ? 'image/bmp' : 'image/png';
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    throw new Error('read failed');
  }
}

/** 分页页码序列（Hermes paginationItems 同款） */
function paginationItems(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) pages.push('ellipsis');
  for (let nextPage = start; nextPage <= end; nextPage += 1) pages.push(nextPage);
  if (end < pageCount - 1) pages.push('ellipsis');
  pages.push(pageCount);
  return pages;
}

function pageRangeLabel(total: number, page: number, pageSize: number): string {
  if (total === 0) return '共 0 项';
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `${start}-${end} / ${total}`;
}

interface ArtifactsGalleryProps {
  /** 跨会话扫描结果（null = 加载中） */
  artifacts: GalleryArtifact[] | null;
  /** 搜索词（由外层持有，搜索框渲染在「产物库」栏） */
  query: string;
  onQueryChange: (q: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** 打开会话（Hermes openChat 语义） */
  onSwitchSession?: (sessionId: string) => void;
}

export default function ArtifactsGallery({
  artifacts, query, onQueryChange, refreshing, onRefresh, onSwitchSession,
}: ArtifactsGalleryProps) {
  const [kindFilter, setKindFilter] = useState<ArtifactFilter>('all');
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const [imagePage, setImagePage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [zoomArtifact, setZoomArtifact] = useState<GalleryArtifact | null>(null);

  useEffect(() => {
    setImagePage(1);
    setFilePage(1);
  }, [artifacts, kindFilter, query]);

  const visibleArtifacts = useMemo(() => {
    if (!artifacts) return [];
    const q = query.trim().toLowerCase();
    return artifacts.filter((a) => {
      if (kindFilter !== 'all' && a.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        a.label.toLowerCase().includes(q) ||
        a.value.toLowerCase().includes(q) ||
        a.sessionTitle.toLowerCase().includes(q)
      );
    });
  }, [artifacts, kindFilter, query]);

  const visibleImages = useMemo(() => visibleArtifacts.filter((a) => a.kind === 'image'), [visibleArtifacts]);
  const visibleNonImages = useMemo(() => visibleArtifacts.filter((a) => a.kind !== 'image'), [visibleArtifacts]);

  const imagePageCount = Math.max(1, Math.ceil(visibleImages.length / IMAGE_PAGE_SIZE));
  const filePageCount = Math.max(1, Math.ceil(visibleNonImages.length / FILE_PAGE_SIZE));
  const curImagePage = Math.min(imagePage, imagePageCount);
  const curFilePage = Math.min(filePage, filePageCount);
  const pagedImages = useMemo(
    () => visibleImages.slice((curImagePage - 1) * IMAGE_PAGE_SIZE, curImagePage * IMAGE_PAGE_SIZE),
    [visibleImages, curImagePage],
  );
  const pagedNonImages = useMemo(
    () => visibleNonImages.slice((curFilePage - 1) * FILE_PAGE_SIZE, curFilePage * FILE_PAGE_SIZE),
    [visibleNonImages, curFilePage],
  );

  const counts = useMemo(() => ({
    all: artifacts?.length ?? 0,
    image: artifacts?.filter((a) => a.kind === 'image').length ?? 0,
    file: artifacts?.filter((a) => a.kind === 'file').length ?? 0,
    link: artifacts?.filter((a) => a.kind === 'link').length ?? 0,
  }), [artifacts]);

  /** 打开产物（Hermes openArtifact 等价：link/file → 系统程序；失败降级 + 可见错误） */
  const handleOpen = useCallback(async (artifact: GalleryArtifact) => {
    if (!isTauri()) {
      window.open(artifact.href, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      if (artifact.kind === 'link') {
        await shellOpen(artifact.href);
        return;
      }
      if (artifact.kind === 'file') {
        const path = artifact.href.startsWith('file://') ? artifact.href.slice('file://'.length) : artifact.href;
        // 路径有效性验证（fs:allow-stat）：不存在/目录 → 明确提示，避免静默失败
        try {
          const info = await stat(path);
          if (info.isDirectory) {
            notifyError(new Error(path), '这是目录，请选择文件');
            return;
          }
        } catch {
          notifyError(new Error(path), '文件不存在');
          return;
        }
        try {
          await openPath(path);
          return;
        } catch (err) {
          // 打开失败降级：在资源管理器中显示（对齐 Hermes 失败后可自行处理）
          try {
            await revealItemInDir(path);
            notifySuccess('已定位到文件所在目录');
            return;
          } catch {
            notifyError(err, '打开文件失败');
          }
        }
      }
    } catch (err) {
      notifyError(err, '打开失败');
    }
  }, []);

  const markImageFailed = useCallback((id: string) => {
    setFailedImageIds((cur) => {
      if (cur.has(id)) return cur;
      return new Set(cur).add(id);
    });
  }, []);

  const showEmpty = artifacts !== null && visibleArtifacts.length === 0;

  return (
    <TooltipProvider delayDuration={0}>
    <div className="flex h-full min-h-0 flex-col">
      {/* 过滤 tabs（搜索/刷新在外部「产物库」栏） */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-1.5">
        {ARTIFACT_FILTERS.map((f) => (
          <TextTab key={f} active={kindFilter === f} onClick={() => setKindFilter(f)}>
            {f === 'all' ? '全部' : KIND_LABEL[f]}
            {artifacts !== null && <TextTabMeta>{counts[f]}</TextTabMeta>}
          </TextTab>
        ))}
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
        {!artifacts ? (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground/70">
              <Loader2 size={22} className="animate-spin text-accent-cyan/60" />
              <span className="text-xs">正在扫描会话中的产物…</span>
            </div>
          </div>
        ) : showEmpty ? (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-muted/40 text-muted-foreground/40">
                <ImageIcon size={24} />
              </span>
              <div className="mt-1 text-sm font-medium text-foreground">
                {counts.all === 0 ? '还没有产物' : '没有匹配项'}
              </div>
              <div className="max-w-xs text-xs leading-relaxed text-muted-foreground/70">
                {counts.all === 0
                  ? '会话里的图片、文件路径、链接会自动收集到这里，供跨会话复用'
                  : '换个关键词或筛选条件试试'}
              </div>
              {counts.all === 0 && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/30 hover:text-foreground"
                >
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                  重新扫描
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {pagedImages.length > 0 && (
              <section className="flex flex-col gap-2">
                {imagePageCount > 1 && (
                  <div className="mt-1 flex h-7 w-full items-center">
                    <GalleryPagination
                      page={curImagePage}
                      pageCount={imagePageCount}
                      onPageChange={setImagePage}
                      rangeLabel={pageRangeLabel(visibleImages.length, curImagePage, IMAGE_PAGE_SIZE)}
                    />
                  </div>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-2.5">
                  {pagedImages.map((artifact) => (
                    <ArtifactImageCard
                      key={artifact.id}
                      artifact={artifact}
                      failed={failedImageIds.has(artifact.id)}
                      onFailed={markImageFailed}
                      onZoom={() => setZoomArtifact(artifact)}
                      onOpenChat={onSwitchSession}
                    />
                  ))}
                </div>
              </section>
            )}

            {pagedNonImages.length > 0 && (
              <section className="flex flex-col gap-2">
                {filePageCount > 1 && (
                  <div className="mt-1 flex h-7 w-full items-center">
                    <GalleryPagination
                      page={curFilePage}
                      pageCount={filePageCount}
                      onPageChange={setFilePage}
                      rangeLabel={pageRangeLabel(visibleNonImages.length, curFilePage, FILE_PAGE_SIZE)}
                    />
                  </div>
                )}
                <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground/50">
                        <th className="w-[42%] px-1.5 py-1.5 font-medium">名称</th>
                        <th className="px-1.5 py-1.5 font-medium">来源</th>
                        <th className="w-[14rem] px-1.5 py-1.5 font-medium">会话 · 时间</th>
                        <th className="w-[5rem] px-1.5 py-1.5 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedNonImages.map((artifact) => (
                        <ArtifactRow
                          key={artifact.id}
                          artifact={artifact}
                          onOpen={() => void handleOpen(artifact)}
                          onOpenChat={onSwitchSession}
                        />
                      ))}
                    </tbody>
                  </table>
              </section>
            )}
          </div>
        )}
      </div>

      {/* 图片放大预览（🔴 2026-08-21 统一复用 ImageLightbox 增强版：
          滚轮缩放/拖拽平移，与消息区/预览面板同一组件不重复造轮子） */}
      {zoomArtifact && (
        <ZoomedImage artifact={zoomArtifact} onClose={() => setZoomArtifact(null)} />
      )}
    </div>
    </TooltipProvider>
  );
}

/** 分页条（Hermes ArtifactsPagination 等价） */
function GalleryPagination({
  page, pageCount, onPageChange, rangeLabel,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  rangeLabel: string;
}) {
  // 单页无需分页条（避免「1-25/25」贴着过滤栏的噪音；Hermes 一页也只隐藏页码）
  if (pageCount <= 1) return null;
  return (
    <div className="flex h-6 w-full items-center justify-between gap-2 px-1">
      <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{rangeLabel}</div>
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto min-w-0 justify-end">
          <PaginationContent className="gap-0.5">
            <PaginationItem>
              <PaginationPrevious disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} />
            </PaginationItem>
            {paginationItems(page, pageCount).map((item, index) => (
              <PaginationItem key={`${item}-${index}`}>
                {item === 'ellipsis' ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationButton isActive={page === item} onClick={() => onPageChange(item)}>
                    {item}
                  </PaginationButton>
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

/** 图片卡片（Hermes ArtifactImageCard 等价；hover 提升 + 缩放按钮） */
function ArtifactImageCard({
  artifact, failed, onFailed, onZoom, onOpenChat,
}: {
  artifact: GalleryArtifact;
  failed: boolean;
  onFailed: (id: string) => void;
  onZoom: () => void;
  onOpenChat?: (sessionId: string) => void;
}) {
  const [src, setSrc] = useState('');
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setSrc('');
    void resolveImageSrc(artifact.value, artifact.href)
      .then((nextSrc) => {
        if (!active) {
          // 卸载后创建的 Blob URL 立即回收
          if (nextSrc.startsWith('blob:')) URL.revokeObjectURL(nextSrc);
          return;
        }
        urlRef.current = nextSrc;
        setSrc(nextSrc);
      })
      .catch(() => {
        if (active) onFailed(artifact.id);
      });
    return () => {
      active = false;
      if (urlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [artifact.href, artifact.id, artifact.value, onFailed]);

  return (
    <article className="group/card overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-muted-foreground/30 hover:shadow-md">
      {/* 缩略图区 */}
      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-gradient-to-b from-muted/40 via-muted/20 to-muted/10 p-2">
        {!failed && src && (
          <img
            src={src}
            alt={artifact.label}
            loading="lazy"
            decoding="async"
            onClick={onZoom}
            className="max-h-36 max-w-full cursor-zoom-in rounded-lg object-contain shadow-sm transition-transform duration-300 group-hover/card:scale-[1.04]"
            onError={() => onFailed(artifact.id)}
          />
        )}
        {!failed && !src && <Loader2 size={16} className="animate-spin text-muted-foreground/40" />}
        {failed && <ImageIcon size={22} className="text-muted-foreground/25" />}

        {/* kind 徽章 */}
        <span className="absolute left-2 top-2 rounded-full bg-background/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground shadow-sm backdrop-blur-sm">
          图片
        </span>
        {/* 放大按钮（hover 显示） */}
        {!failed && (
          <button
            type="button"
            onClick={onZoom}
            title="放大预览"
            className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-background/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-all hover:text-foreground group-hover/card:opacity-100 focus-visible:opacity-100"
          >
            <Maximize2 size={11} />
          </button>
        )}
      </div>

      {/* 信息区 */}
      <div className="space-y-1 p-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="truncate text-xs font-medium text-foreground">{artifact.label}</div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="break-all">{artifact.label}</span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="truncate text-[10px] text-muted-foreground/60">{artifact.value}</div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[24rem]">
            <span className="break-all">{artifact.value}</span>
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="min-w-0 truncate text-[10px] text-muted-foreground/55">
            {artifact.sessionTitle} · {formatArtifactTime(artifact.timestamp)}
          </span>
          {onOpenChat && (
            <button
              type="button"
              onClick={() => onOpenChat(artifact.sessionId)}
              title="打开会话"
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/80 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-all hover:border-muted-foreground/30 hover:bg-accent/10 hover:text-foreground group-hover/card:opacity-100 focus-visible:opacity-100"
            >
              <FolderOpen className="size-3" />
              会话
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** 放大图片（懒加载 src，支持文件产物；Blob URL 回收） */
function ZoomedImage({ artifact, onClose }: { artifact: GalleryArtifact; onClose: () => void }) {
  const [src, setSrc] = useState('');
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setSrc('');
    void resolveImageSrc(artifact.value, artifact.href)
      .then((nextSrc) => {
        if (active) {
          urlRef.current = nextSrc;
          setSrc(nextSrc);
        } else if (nextSrc.startsWith('blob:')) {
          URL.revokeObjectURL(nextSrc);
        }
      })
      .catch(() => {
        if (active) onClose();
      });
    return () => {
      active = false;
      if (urlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id, artifact.href, artifact.value]);

  if (!src) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
        <Loader2 size={20} className="animate-spin text-muted-foreground/40" />
      </div>
    );
  }
  return <ImageLightbox src={src} alt={artifact.label} onClose={onClose} />;
}

/** 文件/链接行（Hermes ArtifactTable 等价：整行可点击打开 + 会话跳转） */
function ArtifactRow({
  artifact, onOpen, onOpenChat,
}: {
  artifact: GalleryArtifact;
  onOpen: () => void;
  onOpenChat?: (sessionId: string) => void;
}) {
  const isLink = artifact.kind === 'link';
  const Icon = isLink ? Link2 : FileText;
  const accent = isLink ? 'text-emerald-500' : 'text-sky-500';
  return (
    <tr className="group/row border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/30">
      <td className="px-1.5 py-1.5">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full min-w-0 items-center gap-2 text-left"
        >
          <span className={cn('grid size-6 shrink-0 place-items-center rounded-md bg-muted/50', accent)}>
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground/90 transition-colors group-hover/row:text-foreground">
            {artifact.label}
          </span>
        </button>
      </td>
      <td className="px-1.5 py-1.5">
        <div className="group/location flex min-w-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
                <span className="block max-w-[26rem] truncate font-mono text-muted-foreground/70">{artifact.value}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[26rem]">
              <span className="break-all">{artifact.value}</span>
            </TooltipContent>
          </Tooltip>
          <CopyButton
            appearance="icon"
            buttonSize="icon-xs"
            className="shrink-0 opacity-0 transition-opacity group-hover/location:opacity-100 focus-visible:opacity-100"
            iconClassName="size-3.5"
            label={isLink ? '复制链接' : '复制路径'}
            text={artifact.value}
          />
        </div>
      </td>
      <td className="px-1.5 py-1.5">
        {onOpenChat ? (
          <button
            type="button"
            onClick={() => onOpenChat(artifact.sessionId)}
            className="block w-full min-w-0 text-left text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <span className="block truncate">
              {artifact.sessionTitle} <span className="text-muted-foreground/40">·</span> {formatArtifactTime(artifact.timestamp)}
            </span>
          </button>
        ) : (
          <span className="block truncate text-muted-foreground/70">
            {artifact.sessionTitle} <span className="text-muted-foreground/40">·</span> {formatArtifactTime(artifact.timestamp)}
          </span>
        )}
      </td>
      <td className="px-1.5 py-1.5 text-right">
        <button
          type="button"
          onClick={onOpen}
          title={isLink ? '在浏览器中打开' : '用系统程序打开'}
          className="inline-flex items-center gap-1 rounded-full border border-border/80 px-2 py-1 text-[10px] text-muted-foreground opacity-0 transition-all hover:border-muted-foreground/30 hover:bg-accent/10 hover:text-foreground group-hover/row:opacity-100 focus-visible:opacity-100"
        >
          {isLink ? <ExternalLink className="size-3" /> : <FileText className="size-3" />}
          打开
        </button>
      </td>
    </tr>
  );
}
