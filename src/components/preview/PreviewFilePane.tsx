/**
 * PreviewFilePane — 本地文件预览内容区（对齐 Hermes LocalFilePreview）
 *
 * 按扩展名分派渲染：
 * - 图片（png/jpg/gif/webp/bmp/svg）→ readFile → blob URL → img
 * - markdown → renderMarkdown（复用消息区 unified/rehype 管线，零新机制）
 * - 代码/文本 → 围栏包裹 renderMarkdown 高亮（内容含 ``` 时降级纯文本 pre）
 * - 大文件（>512KB）→ 警告条 + 截断渲染；二进制 → 拦截提示
 *
 * 文件读取走 tauri-plugin-fs（Hermes Electron 直读 fs 的 Tauri 等价物）。
 */

import { useCallback, useEffect, useState } from 'react';
import { readFile, readTextFile, stat } from '@tauri-apps/plugin-fs';
import { AlertCircle, Download, File, Loader2, RefreshCw } from 'lucide-react';
import type { PreviewTab } from '@/store/preview';
import { renderMarkdown } from '@/utils/markdown';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown']);
const LARGE_FILE_THRESHOLD = 512 * 1024;
const MAX_RENDER_CHARS = 200 * 1024;

function extension(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] || path;
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx).toLowerCase() : '';
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

/** 二进制检测：UTF-8 替换符占比 >1% 判为二进制（Tauri readTextFile 对二进制返回替换字符） */
function isLikelyBinary(text: string): boolean {
  if (!text) return false;
  const replacements = text.split('\uFFFD').length - 1;
  return replacements / text.length > 0.01;
}

/** escapeHtml 纯文本降级（围栏包裹不可用时的兜底渲染） */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface PreviewFilePaneProps {
  tab: PreviewTab;
}

export default function PreviewFilePane({ tab }: PreviewFilePaneProps) {
  const path = tab.target.url;
  const ext = extension(path);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [byteSize, setByteSize] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 🔴 大文件拦截（对齐 Hermes blockedByTarget large：stat 预检后不读内容，
  // 用户点「仍要预览」才读全量，防大文件全量读入内存卡死）
  const [largeBlocked, setLargeBlocked] = useState(false);
  const [forcePreview, setForcePreview] = useState(false);

  // ── 读取文件（对齐 Hermes L586-701：image → dataUrl / text → text）──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBinary(false);
    setByteSize(0);
    setText(null);
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    (async () => {
      try {
        // 🔴 先 stat 预检大小（对齐 Hermes byteSize 前置判断）
        let size = 0;
        try {
          const info = await stat(path);
          size = info.size;
        } catch { /* stat 失败则回退整读 */ }
        if (cancelled) return;
        setByteSize(size);

        if (isImage) {
          const bytes = await readFile(path);
          if (cancelled) return;
          const blob = new Blob([bytes], {
            type: ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`,
          });
          setImageUrl(URL.createObjectURL(blob));
        } else if (size > LARGE_FILE_THRESHOLD && !forcePreview) {
          // 大文本文件：拦截（不读内容），用户确认后才读
          setLargeBlocked(true);
        } else {
          const value = await readTextFile(path);
          if (cancelled) return;
          setText(value);
          setBinary(isLikelyBinary(value));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, isImage, ext, reloadKey]);

  // ── 下载：blob → a[download] ──
  const handleDownload = useCallback(async () => {
    try {
      const bytes = await readFile(path);
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = basename(path);
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* 静默 */ }
  }, [path]);

  const handleReload = useCallback(() => setReloadKey((k) => k + 1), []);

  // 仍要预览：大文件拦截后用户确认 → 读全量
  const handleForcePreview = useCallback(() => {
    setForcePreview(true);
    setLargeBlocked(false);
    setReloadKey((k) => k + 1);
  }, []);

  // ── 渲染 ──
  const isLarge = byteSize > LARGE_FILE_THRESHOLD;

  // 内容渲染（markdown → 完整管线；代码 → 围栏包裹高亮；含 ``` → 纯文本降级）
  let bodyHtml: string | null = null;
  let plainText: string | null = null;
  if (text !== null && !binary) {
    const display = isLarge ? text.slice(0, MAX_RENDER_CHARS) : text;
    if (isMarkdown) {
      bodyHtml = renderMarkdown(display, { highlight: true });
    } else {
      const hasFence = display.split('\n').some((l) => l.trim().startsWith('```'));
      if (hasFence) {
        plainText = display;
      } else {
        bodyHtml = renderMarkdown(`\`\`\`\n${display}\n\`\`\``, { highlight: true });
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--ui-bg-editor)]">
      {/* ── 文件头：名称 + 操作 ── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)]">
        <File size={13} className="text-warning shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-primary)]" title={path}>
          {basename(path)}
        </span>
        {byteSize > 0 && (
          <span className="text-[10px] text-[var(--ui-text-tertiary)] shrink-0">
            {(byteSize / 1024).toFixed(byteSize > 1024 * 1024 ? 1 : 0)} KB
          </span>
        )}
        <button
          onClick={handleReload}
          className="p-1 rounded text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
          title="重新加载"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={handleDownload}
          className="p-1 rounded text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
          title="下载"
        >
          <Download size={12} />
        </button>
      </div>

      {/* ── 内容区 ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-xs">读取中...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <AlertCircle size={32} strokeWidth={1} className="text-[var(--ui-status-error)]" />
            <span className="text-xs text-[var(--ui-text-secondary)]">读取失败</span>
            <span className="text-[10px] text-[var(--ui-text-tertiary)]">{error}</span>
          </div>
        ) : binary ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
            <File size={32} strokeWidth={1} />
            <span className="text-xs text-[var(--ui-text-secondary)]">二进制文件，无法预览</span>
          </div>
        ) : largeBlocked ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-3">
            <File size={32} strokeWidth={1} />
            <span className="text-xs text-[var(--ui-text-secondary)]">文件较大，未加载内容</span>
            <span className="text-[10px] text-[var(--ui-text-tertiary)]">
              {(byteSize / 1024 / 1024).toFixed(1)} MB（超过 {(LARGE_FILE_THRESHOLD / 1024 / 1024).toFixed(0)} MB）
            </span>
            <button
              onClick={handleForcePreview}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Download size={12} />
              仍要预览
            </button>
          </div>
        ) : isImage && imageUrl ? (
          <div className="flex items-center justify-center h-full p-2">
            <img src={imageUrl} alt={basename(path)} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="p-3">
            {bodyHtml ? (
              <div
                className="prose-preview text-xs leading-relaxed text-[var(--ui-text-primary)]"
                // renderMarkdown 输出已过 DOMPurify sanitize（对齐消息区安全边界）
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : plainText !== null ? (
              <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-[var(--ui-text-primary)]">
                {escapeHtml(plainText)}
              </pre>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
