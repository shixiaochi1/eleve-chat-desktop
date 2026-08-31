/**
 * PreviewFilePane — 本地文件预览内容区（对齐 Hermes preview-file.tsx）
 *
 * 按扩展名分派渲染：
 * - 图片（png/jpg/gif/webp/bmp/svg）→ readFile → blob URL → img
 * - markdown → renderMarkdown（复用消息区 unified/rehype 管线，零新机制）
 * - 代码/文本 → 围栏包裹 renderMarkdown 高亮（内容含 ``` 时降级纯文本 pre）
 * - 大文件（>512KB）→ 警告条 + 截断渲染；二进制 → 拦截提示
 *
 * 文件读取走 tauri-plugin-fs（Hermes Electron 直读 fs 的 Tauri 等价物）。
 *
 * spot editor（对齐 Hermes L580-850）：
 * - 可编辑 = 完整可读文本（非图片/二进制/大文件拦截态）
 * - 编辑态：CodeEditor（CodeMirror 6）+ 保存/取消 + stale-on-disk 冲突保护
 * - 保存 → writeTextFile 写回 → selfReload 重读 → tab 脏标记清除
 * - dirty 发布到 lib/preview-edit.ts → tab 条「已修改」圆点
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { readFile, readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs';
import { AlertCircle, Download, File, Loader2, Pencil, RefreshCw, X } from 'lucide-react';
import type { PreviewTab } from '@/store/preview';
import { renderMarkdown } from '@/utils/markdown';
import { formatFileSize } from '@/utils/format';
import { cn } from '@/lib/utils';
import { setPreviewDirty } from '@/lib/preview-edit';
import { notifyWorkspaceChanged } from '@/lib/workspace-events';
import { CodeEditor } from '@/components/chat/code-editor';
import DiffLines from '@/components/DiffLines';
import ModeSwitcher from '@/components/preview/ModeSwitcher';
import ImageLightbox from '@/components/ImageLightbox';
import WindowedSourceView from '@/components/preview/WindowedSourceView';
import { usePreviewWebview } from '@/hooks/use-preview-webview';
import { enhanceRichFences } from '@/lib/rich-fence';
import { isDesktop, call } from '@/utils/bridge';
import { isFsRemoteMode, remoteReadText, remoteReadDataUrl, remoteStat, remoteWriteText } from '@/lib/remote-fs';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown']);
const LARGE_FILE_THRESHOLD = 512 * 1024;

function extension(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] || path;
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx).toLowerCase() : '';
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

/** HTML 文件判定（.html/.htm；对齐 Hermes previewKind 'html' 归一化） */
function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path.split(/[?#]/, 1)[0] || path);
}

/** 🔴 2026-08-29 对齐 Hermes 二进制检测（preview-file.tsx:209-227）：前 4KB 含
 *  NUL 字节即二进制；或控制字符（除 \t\n\r）占比 >12%。此前用 UTF-8 替换符
 *  占比 >1%——UTF-16/宽字节文本会被误判 */
function isLikelyBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 4096);
  if (head.length === 0) return false;
  if (head.includes(0)) return true;
  let controls = 0;
  for (let i = 0; i < head.length; i += 1) {
    const b = head[i];
    if (b < 9 || (b > 13 && b < 32)) controls += 1;
  }
  return controls / head.length > 0.12;
}

/** remote 降级：无字节流（remoteReadText 直出文本）→ 保留替换符占比检测 */
function isLikelyBinaryText(text: string): boolean {
  if (!text) return false;
  const replacements = text.split('\uFFFD').length - 1;
  return replacements / text.length > 0.01;
}

interface PreviewFilePaneProps {
  tab: PreviewTab;
}

export default function PreviewFilePane({ tab }: PreviewFilePaneProps) {
  const path = tab.target.url;
  const ext = extension(path);
  // 🔴 2026-08-20 对齐 Hermes PreviewTarget.dataUrl：内联图片（粘贴/拖拽截图，
  //   磁盘副本不可靠）→ 直接渲染 data URL，不走文件读取
  const inlineDataUrl = tab.target.dataUrl;
  const isImage = IMAGE_EXTENSIONS.has(ext) || !!inlineDataUrl;
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);
  // 🔴 HTML 文件（对齐 Hermes previewKind 'html' + renderMode）：工具/显式链接
  //   递来的 HTML = 执行渲染（'preview'）；文件树浏览/手动打开 = 看源码（'source'）
  const isHtmlFile = isHtmlPath(path);
  // 🔴 PDF 预览（对齐 Hermes previewKind 'pdf'：扩展名归一化判定；blockedByTarget
  //   豁免 = !isImage && !isPdf && ...——PDF 不走 large/binary 拦截，iframe blob 渲染）
  const isPdf = ext === '.pdf';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 🔴 2026-08-21：全屏图片查看（图片点击 → ImageLightbox）
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [byteSize, setByteSize] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // 🔴 PDF blob URL（对齐 Hermes pdfUrl：Chromium PDF viewer 对大 data: URL 在
  //   iframe 中空白，必须走 objectURL；target/字节变化时 revoke）
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 🔴 大文件拦截（对齐 Hermes blockedByTarget large：stat 预检后不读内容，
  // 用户点「仍要预览」才读全量，防大文件全量读入内存卡死）
  const [largeBlocked, setLargeBlocked] = useState(false);
  const [forcePreview, setForcePreview] = useState(false);
  // ── git diff 视图（对齐 Hermes state.diff：工作树 vs HEAD 未提交变更）──
  const [diff, setDiff] = useState<string | null>(null);
  // 用户选择的视图；null = auto（有 diff → diff；markdown → rendered；否则 source，
  // 对齐 Hermes autoMode）。文件切换/重读时重置。
  const [userMode, setUserMode] = useState<'source' | 'rendered' | 'diff' | null>(null);


  // ── 裸 e 快捷键（对齐 Hermes：read 视图 hover 或 focus-within + 非输入框 → 进编辑）──
  const readViewRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef(false);
  // rendered 分支容器（富围栏提升扫描目标）
  const mdRef = useRef<HTMLDivElement | null>(null);

  // 富围栏提升（mermaid / svg，对齐 Hermes MarkdownPreview RichCodeBlock）：
  // renderMarkdown 输出 data-mermaid/data-svg 占位，渲染后扫描异步提升为图形
  // （与消息区 StreamBlocks 共享 lib/rich-fence.ts，不重复造轮子）

  // ── spot editor 状态（对齐 Hermes L585-597：draft/baseline 走 ref，
  //    打字不触发重渲染——dirty 是唯一 render-worthy 信号；selfReload 保存后重读）──
  const [editing, setEditing] = useState(false);
  const draftRef = useRef('');
  const baselineRef = useRef('');
  const [dirty, setDirty] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [selfReload, setSelfReload] = useState(0);

  // ── 读取文件（对齐 Hermes L586-701：image → dataUrl / text → text）──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBinary(false);
    setByteSize(0);
    // 🔴 去 key remount 后 pane 常驻：跨文件切换必须重置大文件拦截状态，
    //    否则上一个文件的「仍要预览」残留到新文件（旧实现靠 key 重建隐式重置）
    setForcePreview(false);
    setText(null);
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    (async () => {
      try {
        // 🔴 先 stat 预检大小（对齐 Hermes byteSize 前置判断）
        let size = 0;
        // 🔴 remote 模式：文件在远端，Tauri plugin-fs 直读必然失败——走 HTTP
        // /api/fs/*（对齐 Hermes desktop-fs remote 分支；见 lib/remote-fs.ts）
        if (isFsRemoteMode()) {
          try {
            const info = await remoteStat(path);
            size = info.size;
          } catch { /* stat 失败则回退整读 */ }
        } else {
          try {
            const info = await stat(path);
            size = info.size;
          } catch { /* stat 失败则回退整读 */ }
        }
        if (cancelled) return;
        setByteSize(size);

        if (isImage) {
          if (inlineDataUrl) {
            // 🔴 dataUrl 内联：renderer 已持有字节，直接渲染（不持久化、不读盘）
            setImageUrl(inlineDataUrl);
          } else if (isFsRemoteMode()) {
            const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;
            const { dataUrl } = await remoteReadDataUrl(path, mime);
            if (cancelled) return;
            const blob = await (await fetch(dataUrl)).blob();
            setImageUrl(URL.createObjectURL(blob));
          } else {
            const bytes = await readFile(path);
            if (cancelled) return;
            const blob = new Blob([bytes], {
              type: ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`,
            });
            setImageUrl(URL.createObjectURL(blob));
          }
        } else if (isPdf) {
          // 🔴 PDF：豁免 large/binary 拦截（对齐 Hermes blockedByTarget），读字节
          //   → Blob → objectURL（Chromium iframe 对大 data: URL 空白，必须 blob）
          if (isFsRemoteMode()) {
            const { dataUrl } = await remoteReadDataUrl(path, 'application/pdf');
            if (cancelled) return;
            const blob = await (await fetch(dataUrl)).blob();
            setPdfUrl(URL.createObjectURL(blob));
          } else {
            const bytes = await readFile(path);
            if (cancelled) return;
            setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
          }
        } else if (size > LARGE_FILE_THRESHOLD && !forcePreview) {
          // 大文本文件：拦截（不读内容），用户确认后才读
          setLargeBlocked(true);
        } else {
          let bin: boolean;
          if (isFsRemoteMode()) {
            // remote：无字节流 → 文本直读 + 替换符检测降级
            const value = (await remoteReadText(path)).text;
            if (cancelled) return;
            bin = isLikelyBinaryText(value);
            setText(value);
            setBinary(bin);
          } else {
            // 🔴 对齐 Hermes：字节读取 → 前 4KB 检测 → UTF-8 解码
            const bytes = await readFile(path);
            if (cancelled) return;
            bin = isLikelyBinary(bytes);
            setText(new TextDecoder('utf-8').decode(bytes));
            setBinary(bin);
          }
          // diff 拉取（对齐 Hermes L670-684：best-effort；非 git 仓库/无变更 → 空 →
          // diff 模式不显示；二进制无 diff）
          if (!bin) {
            try {
              const data = (await call('files_diff', { path })) as { diff?: string };
              if (!cancelled) setDiff((data?.diff ?? '').trim() || null);
            } catch {
              if (!cancelled) setDiff(null);
            }
          } else {
            if (!cancelled) setDiff(null);
          }
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
  }, [path, isImage, isPdf, ext, reloadKey, selfReload]);

  // ── 文件切换/重读 → 退出编辑、清脏标记（对齐 Hermes filePath/reloadKey effect）──
  useEffect(() => {
    setEditing(false);
    setDirty(false);
    setSaving(false);
    setSaveError(null);
    setConflict(false);
    setUserMode(null);
    setDiff(null);
    draftRef.current = '';
    baselineRef.current = '';
  }, [path, reloadKey]);

  // ── dirty 发布到 tab 条（对齐 Hermes setPreviewDirty：keyed by url，unmount 清除）──
  useEffect(() => {
    setPreviewDirty(tab.target.url, editing && dirty);
    return () => setPreviewDirty(tab.target.url, false);
  }, [tab.target.url, editing, dirty]);

  // ── 文件系统 watcher（对齐 Hermes preview-pane watchPreviewFile：磁盘变化
  //    （外部/Agent/spot editor 保存）→ debounce 200ms → 自动重载。
  //    Rust 侧 notify watch 父目录 + basename 过滤 → preview-file-changed 事件；
  //    watch 生命周期跟随 path（切文件 → 旧 watch 停 + 新 watch 起，对齐 Hermes
  //    effect [target.kind, target.url]）。浏览器模式（非 Tauri）降级：无自动刷新）──
  const watchIdRef = useRef<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    let debounceTimer: number | null = null;
    let unlisten: UnlistenFn | null = null;

    const onChanged = (event: { payload: { path?: string } }) => {
      if (cancelled) return;
      // basename 匹配（与 Rust 侧同规则；多 watch 并存/事件重放防御）
      const changed = event.payload?.path ?? '';
      const current = pathRef.current;
      if (basename(changed) !== basename(current)) return;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        if (!cancelled) setReloadKey((k) => k + 1);
      }, 200); // 对齐 Hermes FILE_RELOAD_DEBOUNCE_MS
    };

    void listen<{ path?: string }>('preview-file-changed', onChanged).then((u) => {
      if (cancelled) {
        u();
        return;
      }
      unlisten = u;
    });

    invoke<string>('preview_file_watch', { path })
      .then((id) => {
        if (cancelled) {
          // 创建完成前已卸载（异步竞态）→ 立即停止
          invoke('preview_file_unwatch', { id }).catch(() => {});
          return;
        }
        watchIdRef.current = id;
      })
      .catch(() => {
        // watch 失败（文件不存在/权限）：静默降级，手动刷新仍可用
      });

    return () => {
      cancelled = true;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      unlisten?.();
      const id = watchIdRef.current;
      watchIdRef.current = null;
      if (id) {
        invoke('preview_file_unwatch', { id }).catch(() => {});
      }
    };
  }, [path]);

  // ── 下载：blob → a[download] ──
  const handleDownload = useCallback(async () => {
    try {
      let blob: Blob;
      if (isFsRemoteMode()) {
        const { dataUrl } = await remoteReadDataUrl(path);
        blob = await (await fetch(dataUrl)).blob();
      } else {
        const bytes = await readFile(path);
        blob = new Blob([bytes]);
      }
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

  // ── 编辑能力（对齐 Hermes canEdit：完整可读文本；largeBlocked 拦截态不读内容 →
  //    不可编辑，force 预览后解除——Hermes blockedByTarget 同款语义）──
  // 编辑仅限完整可读文本（对齐 Hermes：never images, binaries, or files we only
  // loaded the first 512 KB of）——PDF 无文本态，显式排除（防御语义）
  const canEdit = text !== null && !binary && !largeBlocked && !isImage && !isPdf;

  // 每击键：更新 draft ref（不重渲染），仅 dirty 边界翻转时 setState
  const handleEditorChange = useCallback((value: string) => {
    draftRef.current = value;
    const next = value !== baselineRef.current;
    setDirty((prev) => (prev === next ? prev : next));
  }, []);

  const beginEdit = () => {
    const value = text ?? '';
    baselineRef.current = value;
    draftRef.current = value;
    setDirty(false);
    setEditorKey((k) => k + 1);
    setSaving(false);
    setSaveError(null);
    setConflict(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
    setConflict(false);
  };

  const discardAndReload = () => {
    setEditing(false);
    setConflict(false);
    setSaveError(null);
    setSelfReload((n) => n + 1);
  };

  // 裸 e 进编辑（对齐 Hermes beginEditRef 模式：监听器常驻不重建，beginEdit 恒最新）
  const beginEditRef = useRef(beginEdit);
  beginEditRef.current = beginEdit;

  useEffect(() => {
    if (!canEdit || editing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)
      ) {
        return;
      }
      const root = readViewRef.current;
      const focusWithin = Boolean(root && document.activeElement && root.contains(document.activeElement));
      if (!hoverRef.current && !focusWithin) return;
      e.preventDefault();
      beginEditRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit, editing]);

  // 保存（对齐 Hermes saveEdit：stale-on-disk guard——保存前重读磁盘对比
  // baseline，外部/Agent 并行改动不静默覆盖，交给用户选 overwrite/discard）
  const saveEdit = async (force = false) => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);

    try {
      if (!force) {
        try {
          const current = isFsRemoteMode() ? (await remoteReadText(path)).text : await readTextFile(path);
          if (current !== baselineRef.current) {
            setConflict(true);
            setSaving(false);
            return;
          }
        } catch {
          // 重读失败 → 放行尝试写入
        }
      }

      if (isFsRemoteMode()) {
        await remoteWriteText(path, draftRef.current);
      } else {
        await writeTextFile(path, draftRef.current);
      }
      baselineRef.current = draftRef.current;
      setDirty(false);
      setConflict(false);
      setEditing(false);
      // 工作区变化信号（对齐 Hermes preview-file saveEdit → notifyWorkspaceChanged）：
      // 文件树等消费方刷新
      notifyWorkspaceChanged();
      setSelfReload((n) => n + 1);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };



  // ── 渲染 ──
  // 内容渲染（markdown → 完整管线；源码视图统一走 WindowedSourceView，
  // 其内部处理内容含 ``` 时的围栏降级——Hermes Shiki 直高亮无此问题，
  // ELEVE 用 markdown 围栏需自检）
  let bodyHtml: string | null = null;
  if (text !== null && !binary && isMarkdown) {
    bodyHtml = renderMarkdown(text, { highlight: true });
  }

  // ── 视图模式决策（对齐 Hermes L925-940：modes 顺序 rendered→source→diff；
  //    auto 落点 = 有 diff 优先，其次 markdown 渲染，否则源码）──
  const hasDiff = Boolean(diff && diff.trim());
  const modes: ('source' | 'rendered' | 'diff')[] = [];
  if (isMarkdown || isHtmlFile) modes.push('rendered');
  modes.push('source');
  if (hasDiff) modes.push('diff');
  const autoMode: 'source' | 'rendered' | 'diff' = hasDiff
    ? 'diff'
    : isHtmlFile
      ? // 🔴 HTML 首选视图 = renderMode（对齐 Hermes previewTargetForSource 首值语义）
        tab.target.renderMode === 'preview'
        ? 'rendered'
        : 'source'
      : isMarkdown
        ? 'rendered'
        : 'source';
  const mode = userMode && modes.includes(userMode) ? userMode : autoMode;

  // 富围栏提升（mermaid / svg，对齐 Hermes MarkdownPreview RichCodeBlock）：
  // renderMarkdown 输出 data-mermaid/data-svg 占位，rendered 视图渲染后扫描提升
  // （与消息区 StreamBlocks 共享 lib/rich-fence.ts，不重复造轮子）
  useEffect(() => {
    if (mode !== 'rendered' || !bodyHtml) return;
    const el = mdRef.current;
    if (!el) return;
    return enhanceRichFences(el);
  }, [mode, bodyHtml]);

  // ── 🔴 2026-08-29 HTML 执行渲染走子 webview（对齐 Hermes isWebPreview：
  //    file:// 真浏览器 guest）——iframe srcDoc 的 about:srcdoc 基准无法解析
  //    相对资源（./assets/x.js），file:// webview 可以。生命周期统一
  //    usePreviewWebview（严禁重复造轮子，与 PreviewWebPane 同一份实现）；
  //    文件变化/保存后重读（reloadKey/selfReload）→ 重建载入新内容。
  //    remote 模式降级 srcDoc iframe ──
  const htmlWebviewActive =
    isDesktop() && !isFsRemoteMode() && isHtmlFile && mode === 'rendered' && text !== null;

  const { containerRef: htmlContainerRef } = usePreviewWebview({
    active: htmlWebviewActive,
    url: path,
    reloadKey: `${path}:${reloadKey}:${selfReload}`,
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--ui-bg-editor)]">
      {/* ── 文件头：名称 + 操作（编辑态换保存/取消，对齐 Hermes EditControls）── */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)]">
        <File size={13} className="text-warning shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-primary)]" title={path}>
          {basename(path)}
        </span>
        {!editing && byteSize > 0 && (
          <span className="text-[10px] text-[var(--ui-text-tertiary)] shrink-0">
            {/* 🔴 2026-09-01 收敛：统一 formatFileSize（原固定 KB 显示，大文件现在自适应为 MB） */}
            {formatFileSize(byteSize)}
          </span>
        )}
        {editing ? (
          <>
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
              title="取消编辑（Esc）"
            >
              <X size={12} />
              取消
            </button>
            <button
              onClick={() => void saveEdit()}
              disabled={!dirty || saving}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors shrink-0',
                dirty && !saving
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-[var(--ui-bg-tertiary)] text-[var(--ui-text-tertiary)] opacity-60 cursor-not-allowed',
              )}
              title="保存（Ctrl+S）"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              {saving ? '保存中' : '保存'}
            </button>
          </>
        ) : (
          <>
            {canEdit && (
              <button
                onClick={beginEdit}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
                title="编辑文件"
              >
                <Pencil size={12} />
                编辑
              </button>
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
          </>
        )}
      </div>

      {/* ── 冲突/保存错误横幅（编辑态；对齐 Hermes conflict banner）── */}
      {editing && conflict && (
        <div className="shrink-0 border-b border-[var(--ui-yellow)]/40 bg-[var(--ui-yellow)]/10 px-3 py-2 text-xs text-[var(--ui-text-primary)]">
          <div className="font-semibold">磁盘上的文件已变更</div>
          <div className="mt-0.5 text-[var(--ui-text-secondary)] leading-relaxed">
            文件在您开始编辑后被外部修改（Agent 或其它程序）。直接保存会覆盖这些改动。
          </div>
          <div className="mt-1.5 flex gap-3">
            <button
              className="font-bold underline underline-offset-4 transition-opacity hover:opacity-80 text-[var(--ui-yellow)]"
              onClick={() => void saveEdit(true)}
            >
              覆盖写入
            </button>
            <button
              className="font-bold underline underline-offset-4 transition-opacity hover:opacity-80 text-[var(--ui-text-secondary)]"
              onClick={discardAndReload}
            >
              丢弃编辑并重新加载
            </button>
          </div>
        </div>
      )}
      {editing && saveError && (
        <div className="shrink-0 border-b border-[var(--ui-status-error)]/40 bg-[var(--ui-status-error)]/10 px-3 py-1.5 text-xs text-[var(--ui-status-error)]">
          保存失败：{saveError}
        </div>
      )}

      {/* ── 内容区（编辑态 → CodeEditor；文本视图 → 模式切换行 + 三视图滚动区）── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {editing ? (
          <CodeEditor
            filePath={path}
            initialValue={baselineRef.current}
            key={editorKey}
            onCancel={cancelEdit}
            onChange={handleEditorChange}
            onSave={() => void saveEdit()}
            disabled={saving}
          />
        ) : loading ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-xs">读取中...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
              <AlertCircle size={32} strokeWidth={1} className="text-[var(--ui-status-error)]" />
              <span className="text-xs text-[var(--ui-text-secondary)]">读取失败</span>
              <span className="text-[10px] text-[var(--ui-text-tertiary)]">{error}</span>
            </div>
          </div>
        ) : isPdf && pdfUrl ? (
          /* 🔴 PDF 预览（对齐 Hermes isPdf 分支：iframe blob URL，内置查看器带
             下载/缩放；不进文本读取路径，永远不落"二进制文件"提示） */
          <iframe
            src={pdfUrl}
            title={basename(path)}
            className="h-full w-full border-0 bg-white"
          />
        ) : binary ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-2">
              <File size={32} strokeWidth={1} />
              <span className="text-xs text-[var(--ui-text-secondary)]">二进制文件，无法预览</span>
            </div>
          </div>
        ) : largeBlocked ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="flex flex-col items-center justify-center h-full text-[var(--ui-text-quaternary)] gap-3">
              <File size={32} strokeWidth={1} />
              <span className="text-xs text-[var(--ui-text-secondary)]">文件较大，未加载内容</span>
              <span className="text-[10px] text-[var(--ui-text-tertiary)]">
                {formatFileSize(byteSize)}（超过 {formatFileSize(LARGE_FILE_THRESHOLD, 0)}）
              </span>
              <button
                onClick={handleForcePreview}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Download size={12} />
                仍要预览
              </button>
            </div>
          </div>
        ) : isImage && imageUrl ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="flex items-center justify-center h-full p-2">
              {/* 🔴 2026-08-21：点击图片打开全屏查看（ImageLightbox 滚轮缩放/拖拽平移） */}
              <img
                src={imageUrl}
                alt={basename(path)}
                className="max-w-full max-h-full object-contain cursor-zoom-in"
                onClick={() => setLightboxSrc(imageUrl)}
              />
            </div>
          </div>
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col"
            onMouseEnter={() => {
              hoverRef.current = true;
            }}
            onMouseLeave={() => {
              hoverRef.current = false;
            }}
            ref={readViewRef}
          >
            {/* 模式切换行（对齐 Hermes PreviewModeSwitcher：仅多模式时显示；
                渲染/源码/变更——有 git diff 时出现「变更」） */}
            {modes.length > 1 && (
              <div className="flex h-7 shrink-0 items-center justify-end border-b border-[var(--ui-stroke-secondary)] px-3">
                <ModeSwitcher
                  modes={modes.map((m) => ({ key: m, label: m === 'rendered' ? '渲染' : m === 'diff' ? '变更' : '源码' }))}
                  active={mode}
                  onSelect={setUserMode}
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">
              {mode === 'diff' ? (
                <div className="h-full overflow-auto p-3">
                  <DiffLines text={diff ?? ''} maxHeight="none" showLineNumbers />
                </div>
              ) : mode === 'rendered' && isHtmlFile && text !== null ? (
                /* 🔴 2026-08-29 HTML 执行渲染走子 webview（对齐 Hermes
                   isWebPreview：file:// 真浏览器 guest）——相对资源可解析
                   （iframe srcDoc 的 about:srcdoc 基准做不到）；原生 HWND
                   在 DOM 之上，容器仅承担定位锚点。remote/浏览器模式降级
                   srcDoc iframe（相对资源无法解析，功能受限） */
                isDesktop() && !isFsRemoteMode() ? (
                  <div ref={htmlContainerRef} className="h-full w-full" />
                ) : (
                  <iframe
                    srcDoc={text}
                    title={basename(path)}
                    className="h-full w-full border-0 bg-white"
                    sandbox="allow-scripts allow-forms allow-popups"
                  />
                )
              ) : mode === 'rendered' && bodyHtml ? (
                <div className="h-full overflow-auto p-3">
                  <div
                    className="prose-preview text-xs leading-relaxed text-[var(--ui-text-primary)]"
                    // renderMarkdown 输出已过 DOMPurify sanitize（对齐消息区安全边界）
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                    ref={mdRef}
                  />
                </div>
              ) : (
                /* 源码视图（对齐 Hermes SourceView）：单滚动容器 + chunk 窗口化，
                   行号与内容天然同步（根治旧双滚动容器失联）；行选择/拖拽/⌘L
                   交互在 WindowedSourceView 内部（Hermes SourceView 同款） */
                <WindowedSourceView filePath={path} language={ext.slice(1)} text={text ?? ''} />
              )}
            </div>
          </div>
        )}
      </div>
      {/* 🔴 2026-08-21：全屏图片查看（滚轮缩放/拖拽平移，ImageLightbox 增强版） */}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} alt={basename(path)} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}
