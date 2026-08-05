/**
 * 跨会话产物画廊（对齐 Hermes app/artifacts）
 *
 * 扫描最近会话历史，从消息里重新提取 image/file/link 三类产物：
 * 过滤 tabs（全部/图片/文件/链接 + 计数）+ 搜索 + 刷新；
 * 图片网格 24/页（点击放大）、文件/链接表格 100/页（点击打开）。
 * 打开：link → 系统浏览器（shell open）；file → 系统默认程序（opener openPath）；
 * 图片本地文件 → fs readFile → Blob URL 显示。
 *
 * 数据链路：session.list → session.history → lib/artifacts-gallery 纯函数提取。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  ExternalLink, FileText, FolderOpen, Image as ImageIcon, Link2, Loader2, RefreshCw, Search, X,
} from 'lucide-react';
import { call } from '@/utils/bridge';
import { cn } from '@/lib/utils';
import {
  ARTIFACT_FILTERS,
  collectArtifactsForSession,
  type ArtifactFilter,
  type GalleryArtifact,
} from '@/lib/artifacts-gallery';
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
  onClose?: () => void;
  /** 打开会话（Hermes openChat 语义） */
  onSwitchSession?: (sessionId: string) => void;
}

export default function ArtifactsGallery({ onClose, onSwitchSession }: ArtifactsGalleryProps) {
  const [artifacts, setArtifacts] = useState<GalleryArtifact[] | null>(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<ArtifactFilter>('all');
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const [imagePage, setImagePage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [zoomArtifact, setZoomArtifact] = useState<GalleryArtifact | null>(null);

  const refreshArtifacts = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = (await call('list_sessions', { limit: 30 })) as { sessions?: Array<{
        id: string; title?: string | null; preview?: string | null;
        started_at?: unknown; last_active?: unknown;
      }> };
      const sessions = data.sessions ?? [];
      const results = await Promise.allSettled(
        sessions.map(async (session) => {
          const hist = (await call('get_session_messages', { session_id: session.id })) as { messages?: unknown[] };
          return collectArtifactsForSession(session, (hist.messages ?? []) as Parameters<typeof collectArtifactsForSession>[1]);
        }),
      );
      const next: GalleryArtifact[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next.push(...result.value);
      });
      setArtifacts(next.sort((a, b) => b.timestamp - a.timestamp));
    } catch (err) {
      console.error('[artifacts-gallery] load failed:', err);
      setArtifacts([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshArtifacts();
  }, [refreshArtifacts]);

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

  /** 打开产物（Hermes openArtifact 等价：link/file → 系统程序；失败降级） */
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
        await openPath(path);
        return;
      }
    } catch (err) {
      console.error('[artifacts-gallery] open failed:', err);
      // file 打开失败降级：在资源管理器中显示（对齐 Hermes notifyError 后用户可自行处理）
      if (artifact.kind === 'file') {
        const path = artifact.href.startsWith('file://') ? artifact.href.slice('file://'.length) : artifact.href;
        try {
          await revealItemInDir(path);
        } catch { /* 忽略 */ }
      }
    }
  }, []);

  const markImageFailed = useCallback((id: string) => {
    setFailedImageIds((cur) => {
      if (cur.has(id)) return cur;
      return new Set(cur).add(id);
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部：标题 + 过滤 tabs + 搜索 + 刷新 + 关闭 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">产物库</h2>
        <div className="ml-2 flex items-center gap-0.5">
          {ARTIFACT_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setKindFilter(f)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                kindFilter === f ? 'bg-accent/15 text-accent-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {f === 'all' ? '全部' : KIND_LABEL[f]}
              {artifacts && <span className="ml-1 tabular-nums text-muted-foreground/70">{counts[f]}</span>}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索路径 / 标题 / 会话"
              className="h-7 w-48 rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-accent-cyan/50 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void refreshArtifacts()}
            disabled={refreshing}
            title={refreshing ? '刷新中…' : '刷新'}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="关闭 (Esc)"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!artifacts ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">扫描会话中…</div>
        ) : visibleArtifacts.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <div className="text-sm font-medium text-foreground">没有产物</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {counts.all === 0 ? '会话里的图片 / 文件路径 / 链接会自动收集到这里' : '当前筛选条件下没有匹配项'}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-3 py-3">
            {pagedImages.length > 0 && (
              <section className="flex flex-col">
                <div className="flex h-7 items-center gap-3">
                  <GalleryPagination
                    page={curImagePage}
                    pageCount={imagePageCount}
                    onPageChange={setImagePage}
                    rangeLabel={pageRangeLabel(visibleImages.length, curImagePage, IMAGE_PAGE_SIZE)}
                  />
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] items-start gap-2 pt-1.5">
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
              <section className="flex flex-col">
                <div className="flex h-7 items-center gap-3">
                  <GalleryPagination
                    page={curFilePage}
                    pageCount={filePageCount}
                    onPageChange={setFilePage}
                    rangeLabel={pageRangeLabel(visibleNonImages.length, curFilePage, FILE_PAGE_SIZE)}
                  />
                </div>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        <th className="w-[45%] px-2.5 py-1.5 font-medium">名称</th>
                        <th className="px-2.5 py-1.5 font-medium">来源</th>
                        <th className="w-[13rem] px-2.5 py-1.5 font-medium">会话 · 时间</th>
                        <th className="w-[6rem] px-2.5 py-1.5 text-right font-medium">操作</th>
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
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* 图片放大预览（Hermes ZoomableImage 等价） */}
      {zoomArtifact && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
          onClick={() => setZoomArtifact(null)}
        >
          <div className="max-h-[90vh] max-w-[92vw] overflow-auto rounded-lg bg-card p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between gap-4 px-1">
              <span className="truncate text-xs text-muted-foreground">{zoomArtifact.label}</span>
              <button
                type="button"
                onClick={() => setZoomArtifact(null)}
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                title="关闭 (Esc)"
              >
                <X size={13} />
              </button>
            </div>
            <ZoomedImage artifact={zoomArtifact} onClose={() => setZoomArtifact(null)} />
          </div>
        </div>
      )}
    </div>
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
  return (
    <div className="flex h-6 items-center justify-between gap-2 px-1">
      <div className="shrink-0 text-[11px] text-muted-foreground">{rangeLabel}</div>
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

/** 图片卡片（Hermes ArtifactImageCard 等价） */
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
    <article className="group/artifact overflow-hidden rounded-lg border border-border bg-card">
      <div
        className={cn(
          'relative flex h-40 w-full items-center justify-center overflow-hidden border-b border-border bg-muted/30 p-1.5',
          failed && 'cursor-default',
        )}
      >
        {!failed && src && (
          <img
            src={src}
            alt={artifact.label}
            loading="lazy"
            decoding="async"
            onClick={onZoom}
            className="max-h-40 max-w-full cursor-zoom-in rounded-md object-contain transition-opacity hover:opacity-90"
            onError={() => onFailed(artifact.id)}
          />
        )}
        {!failed && !src && <Loader2 size={16} className="animate-spin text-muted-foreground/50" />}
        {failed && <ImageIcon size={22} className="text-muted-foreground/30" />}
      </div>
      <div className="space-y-1.5 p-2">
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
            <ImageIcon className="size-3" />
            {KIND_LABEL.image}
          </div>
          <div className="truncate text-xs font-medium text-foreground" title={artifact.label}>{artifact.label}</div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70" title={artifact.value}>{artifact.value}</div>
        </div>
        <div className="truncate text-[10px] text-muted-foreground/70">
          {artifact.sessionTitle} · {formatArtifactTime(artifact.timestamp)}
        </div>
        {onOpenChat && (
          <button
            type="button"
            onClick={() => onOpenChat(artifact.sessionId)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
          >
            <FolderOpen className="size-3" />
            打开会话
          </button>
        )}
      </div>
    </article>
  );
}

/** 放大图片（懒加载 src，支持文件产物） */
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!src) return <Loader2 size={20} className="m-6 animate-spin text-muted-foreground/50" />;
  return <img src={src} alt={artifact.label} className="max-h-[78vh] max-w-full object-contain" />;
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
  return (
    <tr className="group/row border-b border-border/60 transition-colors last:border-b-0 hover:bg-muted/30">
      <td className="px-2.5 py-1.5">
        <button
          type="button"
          onClick={onOpen}
          title={`打开：${artifact.value}`}
          className="flex w-full min-w-0 items-center gap-2 text-left"
        >
          <Icon className={cn('size-3.5 shrink-0', isLink ? 'text-accent-cyan' : 'text-muted-foreground')} />
          <span className="min-w-0 flex-1 truncate text-foreground/90 hover:text-foreground">{artifact.label}</span>
        </button>
      </td>
      <td className="px-2.5 py-1.5">
        <button type="button" onClick={onOpen} title={artifact.value} className="block w-full min-w-0 text-left">
          <span className="block max-w-[24rem] truncate text-muted-foreground/80">{artifact.value}</span>
        </button>
      </td>
      <td className="px-2.5 py-1.5">
        {onOpenChat ? (
          <button
            type="button"
            onClick={() => onOpenChat(artifact.sessionId)}
            className="block w-full min-w-0 text-left text-muted-foreground/80 transition-colors hover:text-foreground"
            title="打开会话"
          >
            <span className="block truncate">{artifact.sessionTitle} · {formatArtifactTime(artifact.timestamp)}</span>
          </button>
        ) : (
          <span className="block truncate text-muted-foreground/80">
            {artifact.sessionTitle} · {formatArtifactTime(artifact.timestamp)}
          </span>
        )}
      </td>
      <td className="px-2.5 py-1.5 text-right">
        <button
          type="button"
          onClick={onOpen}
          title={isLink ? '在浏览器中打开' : '用系统程序打开'}
          className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
        >
          {isLink ? <ExternalLink className="size-3" /> : <FileText className="size-3" />}
          打开
        </button>
      </td>
    </tr>
  );
}
