import { forwardRef, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { renderMarkdown, repairMarkdownTail, splitMarkdownBlocksCached, autolinkOutsideFences, mergeSingleNewlines } from '@/utils/markdown';
import { detectArtifact, type ArtifactDetection } from '@/lib/artifact-detect';
import { enhanceRichFences } from '@/lib/rich-fence';
import { resolveMediaSrc, mediaName } from '@/utils/media';
import { ArtifactCard } from './ArtifactCard';
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview';
import { getCurrentSessionCwd } from '@/lib/session-cwd';
import { openPreview } from '@/store/preview';
import { openExternal } from '@/lib/external-open';

/**
 * StreamBlocks — 块级流式 Markdown 渲染（对齐 Hermes Streamdown 分块模型）
 *
 * 架构（对应 Hermes markdown-text.tsx 的 parseMarkdownIntoBlocks + 块数组）：
 * - 文本按空行切分成块（fence 感知，代码块内空行不切），split 结果走 LRU 缓存
 *   （对齐 Hermes blockCache：同一文本重新挂载/多 surface 渲染直接命中）
 * - 每块独立渲染为 HTML（marked + DOMPurify + hljs），React.memo 按
 *   (text, highlight) 跳过稳定块的重渲染 → 流式 flush 只有"活动尾块"重解析
 * - 流式/完成共用同一渲染管线 → 消息落定时无 DOM 结构切换、无高度突变
 * - 代码高亮 defer（对齐 Hermes Shiki defer={isStreaming}）：流式尾块不高亮
 *   （纯文本 + class 结构一致），落定后一次性高亮 → 大代码块流式不卡顿，
 *   且高亮只加 span class 不改变布局 → 无高度突变
 * - repairMarkdownTail 只修复尾部未闭合构造（fence/行内 code/强调/链接），
 *   对齐 Hermes tailBoundedRemend 的"修复只发生在尾部窗口"
 *
 * 排版（对齐 Hermes MARKDOWN_CONTAINER_CLASS_NAME）：
 * - wrap-anywhere（overflow-wrap: anywhere）：长词/URL 任意断行，不溢出
 * - text-pretty（text-wrap: pretty）：段落折行均衡，避免单词孤悬
 * - 块间间距统一 --paragraph-gap（0.7rem），首尾块零外边距
 *
 * 大文本降级（对齐 Hermes MAX_MARKDOWN_CHARS / HugeTextFallback）：
 * - 流式中 >40k 字符：跳过解析管线直接纯文本（防每 flush 全量 marked+hljs 卡顿）
 * - 完成态 >100k 字符：同样降级（一次性解析也重，分块 + content-visibility 渲染）
 */
const MAX_STREAM_RENDER_CHARS = 40_000;
const MAX_FINAL_RENDER_CHARS = 100_000;
const PLAIN_CHUNK_LINES = 200;

interface StreamBlocksProps {
  text: string;
  /** 流式进行中（尾块会持续增长） */
  streaming?: boolean;
  /** 禁止 artifact 提升（reasoning 草稿不提升，对齐 Hermes disableArtifacts） */
  disableArtifacts?: boolean;
  /** 会话 ID（artifact 版本注册按会话隔离，对齐 Hermes） */
  sessionId?: string | null;
}

interface BlockPlan {
  text: string;
  /** 代码块是否启用高亮：流式尾块 false（延迟高亮），其余 true */
  highlight: boolean;
  /** 提升为 artifact 的围栏（无 = 普通块） */
  artifact?: {
    detection: ArtifactDetection;
    code: string;
    /** 围栏仍在流式增长（卡片 shimmer 态，不注册版本） */
    streaming: boolean;
  };
  /** 会话 ID（透传给 ArtifactCard） */
  sessionId?: string | null;
}

/**
 * 单围栏块解析：块文本本身就是一个完整代码 fence（```lang\nbody\n```）。
 * splitMarkdownBlocks 后"纯 fence 块"才可提升（fence 与文本混排的块保持原样）。
 */
function parseSingleFence(block: string): { lang: string; code: string } | null {
  const trimmed = block.trim();
  const lines = trimmed.split('\n');
  if (lines.length < 2) return null;
  const open = lines[0].match(/^```([^\n`]*)$/) ?? lines[0].match(/^~~~([^\n~]*)$/);
  if (!open) return null;
  if (!/^(```|~~~)\s*$/.test(lines[lines.length - 1])) return null;
  return { lang: open[1].trim(), code: lines.slice(1, -1).join('\n') };
}

/**
 * 单块渲染 — memo 按 (text, highlight, artifactStreaming) 比较：
 * 文本与高亮态都不变则完全跳过（含 unified 解析与 hljs 高亮）。
 * 流式中稳定块命中 memo；落定瞬间只有尾块补高亮重渲染一次。
 *
 * artifact 块：直接渲染 ArtifactCard（跳过 markdown 解析，性能最优）；
 * 其余块走 HTML 渲染 + 富围栏提升（对齐 Hermes embeds LAZY_FENCE 懒加载路由）：
 * mermaid → 懒加载 mermaid.js 渲染 SVG（securityLevel strict + 主题跟随）；
 * svg → DOMPurify svg profile 硬清洗后内联渲染；失败均回退代码卡片。
 * 提升逻辑在 lib/rich-fence.ts（与文件预览 markdown 视图共享，不重复造轮子）。
 */

const Block = memo(
  function Block({ text, highlight, artifact, sessionId }: BlockPlan) {
    const html = useMemo(() => renderMarkdown(text, { highlight }), [text, highlight]);
    const ref = useRef<HTMLDivElement | null>(null);

    // 富围栏提升（mermaid / svg）：仅 highlight=true（稳定块/落定态）触发，
    // 流式尾块显示代码占位，防止每 flush 全量重渲染图形
    useEffect(() => {
      if (!highlight) return;
      const el = ref.current;
      if (!el) return;
      const cleanup = enhanceRichFences(el);
      // 🔴 2026-08-09 本地媒体异步挂载（对齐 Hermes MarkdownImageContent）：
      // 扫描 data-media-src 占位 → 读文件 → img.src（图片不进 markdown 文本）
      void loadLocalMedia(el);
      return cleanup;
    }, [html, highlight]);

    if (artifact) {
      return <ArtifactCard detection={artifact.detection} code={artifact.code} streaming={artifact.streaming} sessionId={sessionId} />;
    }

    return <div ref={ref} className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />;
  },
  (prev, next) =>
    prev.text === next.text &&
    prev.highlight === next.highlight &&
    (prev.artifact?.streaming ?? false) === (next.artifact?.streaming ?? false)
);

/**
 * 本地媒体异步挂载（对齐 Hermes MarkdownImageContent）：
 * 扫描 markdown 渲染产物中的 img[data-media-src] 占位，逐个读文件挂载 img.src。
 * - data-media-src 由 rehypeLocalMediaPlaceholder 插件生成（本地路径 img）
 * - 加载中标记 data-media-loading 防重复请求（html 变化重扫时跳过）
 * - 失败 → 显示加载失败文案（对齐 Hermes failed → Couldn't load + Open image）
 */
async function loadLocalMedia(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-media-src]'));
  if (imgs.length === 0) return;
  await Promise.all(
    imgs.map(async (img) => {
      if (img.dataset.mediaLoading === '1') return;
      const path = img.getAttribute('data-media-src') || '';
      img.dataset.mediaLoading = '1';
      const src = await resolveMediaSrc(path);
      img.removeAttribute('data-media-src');
      delete img.dataset.mediaLoading;
      if (src) {
        img.setAttribute('src', src);
      } else {
        img.alt = `${img.alt || mediaName(path)}（图片加载失败）`;
      }
    }),
  );
}

/** 按行数分块（大文本降级渲染用）— 对齐 Hermes chunkByLines */
function chunkByLines(text: string, linesPerChunk: number): { text: string; lines: number }[] {
  const lines = text.split('\n');
  const chunks: { text: string; lines: number }[] = [];
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const slice = lines.slice(i, i + linesPerChunk);
    chunks.push({ text: slice.join('\n'), lines: slice.length });
  }
  return chunks;
}

export default forwardRef<HTMLDivElement, StreamBlocksProps>(function StreamBlocks(
  { text, streaming = false, disableArtifacts = false, sessionId = null },
  ref
) {
  // 🔴 2026-08-10 对齐 Hermes MarkdownLink：消息里链接点击 → 预览抽屉 / 系统浏览器。
  // - file:/#preview: → 右侧预览抽屉（对齐 PreviewAttachment openPreview）
  // - http(s) 外链 → 系统浏览器打开（对齐 PrettyLink openExternal；拦截 webview 自身导航）
  // - 站内锚点 #xxx 不拦截
  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('#')) return;
    e.preventDefault();
    e.stopPropagation();

    if (href.startsWith('file:') || href.startsWith('#preview:') || href.startsWith('#preview/')) {
      const raw = href.startsWith('file:')
        ? href
        : decodeURIComponent(href.slice('#preview'.length + 1));
      // 🔴 传当前会话 cwd（对齐 Hermes $currentCwd）：相对路径 #preview 链接 join 成绝对路径
      const preview = normalizeOrLocalPreviewTarget(raw, getCurrentSessionCwd());
      if (preview) openPreview(preview, 'explicit-link');
      return;
    }

    // 外链（http/https/其它 scheme/相对路径）→ 系统浏览器（对齐 Hermes PrettyLink；
    // 传输细节统一 lib/external-open 单一出口，严禁重复造轮子）
    void openExternal(href);
  }, []);

  const plan = useMemo(() => {
    if (!text) return null;

    // 大文本降级：跳过解析管线，直接折叠单换行纯文本显示。
    // 流式中 40k（每 flush 重复解析不可承受）；完成态 100k（一次性也重）。
    // 🔴 2026-08-09 修复（send_local_image 乱码事故根因）：含 data:image/ 内联图片的
    // 文本不降级——base64 长度远超阈值，降级 = 把图片二进制当纯文本显示（“一堆乱码”）。
    // 图片消息 markdown 结构简单（文本 + img），解析开销可控，不触发卡顿。
    if (
      text.length > (streaming ? MAX_STREAM_RENDER_CHARS : MAX_FINAL_RENDER_CHARS) &&
      !/data:image\//.test(text)
    ) {
      return { kind: 'plain' as const, body: text.replace(/\n(?!\n)/g, ' ') };
    }

    // 单换行折叠（块语法感知）：LLM 一行一句的输出习惯 → 句子接回一行，真列表/标题保留
    const merged = mergeSingleNewlines(text);
    const preprocessed = autolinkOutsideFences(merged);
    const repaired = repairMarkdownTail(preprocessed);
    const rawBlocks = splitMarkdownBlocksCached(repaired);
    // 仅流式"活动尾块"延迟高亮；稳定块首次渲染即高亮（一次性成本，memo 后不再重复）
    const blocks: BlockPlan[] = rawBlocks.map((blockText, i) => {
      const isTail = streaming && i === rawBlocks.length - 1;
      // 纯 fence 块 + 命中检测 → 提升 artifact（reasoning 草稿 disableArtifacts 不提升）
      if (!disableArtifacts) {
        const fence = parseSingleFence(blockText);
        if (fence) {
          const detection = detectArtifact(fence.lang, fence.code);
          if (detection) {
            return {
              text: blockText,
              highlight: false,
              artifact: { detection, code: fence.code, streaming: isTail },
              sessionId,
            };
          }
        }
      }
      return {
        text: blockText,
        highlight: !isTail,
        sessionId,
      };
    });
    return { kind: 'blocks' as const, blocks };
  }, [text, streaming, disableArtifacts, sessionId]);

  // 大文本降级分块（hooks 规则：所有 useMemo 必须在 early return 之前）
  const plainChunks = useMemo(
    () => (plan?.kind === 'plain' ? chunkByLines(plan.body, PLAIN_CHUNK_LINES) : null),
    [plan]
  );

  if (!plan) return null;

  if (plan.kind === 'plain') {
    // 分块 + content-visibility：长文本只渲染视口附近的块（对齐 HugeTextFallback）
    return (
      <div className="wrap-anywhere whitespace-pre-wrap break-words leading-(--dt-line-height)">
        {plainChunks!.map((chunk, index) => (
          <div
            key={index}
            style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${chunk.lines * 18}px` }}
          >
            {chunk.text}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      onClick={handleLinkClick}
      className={
        'prose max-w-none wrap-anywhere text-pretty ' +
        '[&>*+*]:mt-(--paragraph-gap) ' +
        '[&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words ' +
        '[&_img]:max-w-full'
      }
    >
      {plan.blocks.map((block, index) => (
        <Block key={index} text={block.text} highlight={block.highlight} artifact={block.artifact} sessionId={block.sessionId} />
      ))}
    </div>
  );
});
