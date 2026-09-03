import { useState, useCallback, useEffect, useRef, useMemo, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { extractMediaRefs, resolveMediaSrc, mayHaveLocalImage, mediaKind, resolveMediaPlaybackSrc } from '../utils/media';
import { CopyIcon, CheckIcon, TrashIcon } from './Icons';
import { cn } from '@/lib/utils';
import StreamBlocks from './StreamBlocks';
import UserMessageText from './UserMessageText';
import { useSmoothReveal } from '@/hooks/useSmoothReveal';
import { useEnterAnimation } from '@/hooks/useEnterAnimation';

interface MessageBubbleProps {
  type: string;
  content?: string;
  streaming?: boolean;
  messageId?: string;
  onDelete?: (messageId: string) => void;
  /** 会话 ID（artifact 版本注册按会话隔离，对齐 Hermes） */
  sessionId?: string | null;
}

/**
 * 本地图片块级渲染（🔴 2026-08-09 方案 C，对齐 Hermes MediaAttachment）：
 * 异步读文件 → img.src（data URL，不进 markdown 文本），加载中占位，
 * 失败显示文件名。点击放大走 MessageBubble 的 zoomedSrc lightbox。
 */
function MediaImage({ path, name, onZoom }: { path: string; name: string; onZoom: (src: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    resolveMediaSrc(path)
      .then((s) => { if (!cancelled) { if (s) setSrc(s); else setFailed(true); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);

  if (failed) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed border-[var(--ui-stroke-tertiary)] rounded-md px-3 py-2">
        {name}（图片加载失败）
      </div>
    );
  }
  if (!src) {
    return (
      <div className="text-xs text-muted-foreground/70 animate-pulse flex items-center gap-1.5 py-1">
        <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        加载图片：{name}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      title={name}
      className="max-w-[320px] max-h-[240px] object-contain rounded-lg border border-[var(--ui-stroke-tertiary)] cursor-zoom-in"
      onClick={() => onZoom(src)}
    />
  );
}

/**
 * 本地视频块级渲染（🔴 2026-09-03 对齐 Hermes MediaAttachment video 分支）：
 * resolveMediaPlaybackSrc → <video controls>（gateway ServeDir Range 流式优先，
 * blob 兜底），失败显示文件名。此前面板无视频渲染路径——MEDIA:xx.mp4 走
 * MediaImage 按图片渲染必破图。
 */
function MediaVideo({ path, name }: { path: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(null);
    resolveMediaPlaybackSrc(path)
      .then((r) => { if (!cancelled) { if (r.src) setSrc(r.src); else setFailed(r.error || '未知原因'); } })
      .catch((e) => { if (!cancelled) setFailed(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [path]);

  // blob URL 生命周期跟随组件（gateway/ServeDir URL 不 revoke）
  useEffect(() => () => {
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
  }, [src]);

  if (failed) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed border-[var(--ui-stroke-tertiary)] rounded-md px-3 py-2 max-w-[420px]">
        <div>{name}（视频加载失败）</div>
        <div className="mt-1 text-[10px] text-[var(--ui-text-tertiary)] break-all">{failed}</div>
      </div>
    );
  }
  if (!src) {
    return (
      <div className="text-xs text-muted-foreground/70 animate-pulse flex items-center gap-1.5 py-1">
        <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        加载视频：{name}
      </div>
    );
  }
  return (
    <video
      src={src}
      controls
      preload="metadata"
      title={name}
      onError={() => setFailed(`播放器加载/解码失败（src=${src.slice(0, 60)}…）`)}
      className="max-w-[420px] w-full rounded-lg border border-[var(--ui-stroke-tertiary)] bg-black"
    />
  );
}

/**
 * 本地音频块级渲染（🔴 2026-09-03 对齐 Hermes MediaAttachment audio 分支）：
 * TTS 结果 MEDIA: 标签 → <audio controls> 内联播放（此前走 MediaImage 破图）。
 */
function MediaAudio({ path, name }: { path: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(null);
    resolveMediaPlaybackSrc(path)
      .then((r) => { if (!cancelled) { if (r.src) setSrc(r.src); else setFailed(r.error || '未知原因'); } })
      .catch((e) => { if (!cancelled) setFailed(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => () => {
    if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
  }, [src]);

  if (failed) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed border-[var(--ui-stroke-tertiary)] rounded-md px-3 py-2 max-w-[420px]">
        <div>{name}（音频加载失败）</div>
        <div className="mt-1 text-[10px] text-[var(--ui-text-tertiary)] break-all">{failed}</div>
      </div>
    );
  }
  if (!src) {
    return (
      <div className="text-xs text-muted-foreground/70 animate-pulse flex items-center gap-1.5 py-1">
        <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        加载音频：{name}
      </div>
    );
  }
  return (
    <audio
      src={src}
      controls
      preload="metadata"
      title={name}
      onError={() => setFailed(`播放器加载/解码失败（src=${src.slice(0, 60)}…）`)}
      className="w-full max-w-sm"
    />
  );
}

/**
 * 消息气泡 — user / agent / system / error
 *
 * agent 流式渲染（对齐 Hermes markdown-text 管线）：
 * - 流式/完成共用同一渲染管线（StreamBlocks 块级渲染）→ 落定零突变
 * - useSmoothReveal：rAF 比例排空逐帧揭示，文字平滑流出不跳变
 * - useDeferredValue：渲染降优先级，React 并发调度可跳过中间 token 状态
 * - 气泡宽度占满容器（w-full），宽度恒定 → 消除流式宽度重排抖动
 */
export default function MessageBubble({ type, content, streaming, messageId, onDelete, sessionId }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [zoomedSrc, setZoomedSrc] = useState<string | null>(null);
  const [zoomedName, setZoomedName] = useState<string | undefined>(undefined);
  const textRef = useRef<HTMLDivElement | null>(null);
  // 🔴 2026-08-31 生成结果图再编辑入口（打通"灯箱 → 编辑器 → 新附件 → 再生图"循环）：
  // zoomedSrc 可能是 data URL（本地路径经 resolveMediaSrc）或 gateway http URL
  // （/media 相对路径）——ImageEditorModal 内部统一归一成 data URL 再进 canvas。

  // 🔴 2026-08-09 本地媒体解析（方案 C：块级 MediaImage 组件，不走 markdown 管线）：
  // MEDIA:path 独立行 → 从文本提取 → 气泡文本下方渲染 React 图片组件
  // （对齐 Hermes MediaAttachment 块级组件）。绕开 StreamBlocks 预处理/插件/
  // DOMPurify——send_local_image 显示异常已证明 markdown 管线链路不可靠。
  const mediaRefs = useMemo(() => {
    if (streaming) return { clean: content ?? "", refs: [] as { path: string; name: string }[] };
    if (!mayHaveLocalImage(content ?? "")) return { clean: content ?? "", refs: [] as { path: string; name: string }[] };
    return extractMediaRefs(content ?? "");
  }, [content, streaming]);

  const displayContent = mediaRefs.clean;

  // 🔴 对齐 Hermes：流式平滑揭示 + 渲染降级。
  // hooks 必须在所有 early return 之前（Rules of Hooks）；
  // 非 agent 分支（user/system/error）不受影响（reveal 直接返回原文）。
  const revealed = useSmoothReveal(displayContent || '', !!streaming);
  // useDeferredValue：流式渲染降为低优先级，输入/滚动不被每 token 的
  // Markdown 解析阻塞（对齐 Hermes DeferStreamingText）。
  const deferredContent = useDeferredValue(revealed);

  // 入场动画（对齐 Hermes useEnterAnimation）：仅挂载时处于流式态的消息播放
  // （= 新消息），历史消息/滚动重挂载被 animationKey 去重，不重播
  const enterRef = useEnterAnimation(!!streaming, messageId);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest('img');
      if (!img) return;
      e.preventDefault();
      setZoomedSrc(img.src);
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [deferredContent]);

  useEffect(() => {
    if (!zoomedSrc) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomedSrc(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [zoomedSrc]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [content]);

  if (type === 'system') {
    return (
      <div className="text-xs text-center text-muted-foreground py-1 px-3">
        {content}
      </div>
    );
  }

  if (type === 'error') {
    return (
      <div className="w-fit max-w-[85%] bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-sm text-destructive">
        {content}
      </div>
    );
  }

  if (type === 'user') {
    // 2026-08-10 竖排修复：w-full 占满 wrapper，消除 w-fit 嵌套循环
    return (
      <div className="group relative w-full min-w-0">
        <div className="bg-user-bubble text-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed select-text border border-user-bubble-border shadow-sm">
          {/* 用户消息最小 Markdown（对齐 Hermes UserMessageText）：fence 代码块 + 行内 code */}
          <UserMessageText text={content || ''} />
        </div>
        {/* 🔴 2026-08-10 操作栏悬浮气泡内右下角（不占文档流——原 opacity 占位导致气泡间视觉空隙大） */}
        <div className="absolute bottom-1 right-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-0.5 text-xs',
              'bg-background/80 backdrop-blur-sm shadow-sm',
              'text-muted-foreground hover:text-foreground hover:bg-accent',
              copied && 'text-success'
            )}
            title={copied ? '已复制' : '复制'}
            onClick={handleCopy}
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          </button>
        </div>
      </div>
    );
  }

  // ── agent 消息（对齐 Hermes：流式/非流式同一渲染管线，无切换抖动）──
  // 流式期间：StreamBlocks 块级渲染 + 平滑揭示（文字逐帧流出）
  // 流式结束：同一管线，仅揭示排空，DOM 结构零切换
  // 🔴 操作栏 + 时间戳始终渲染（与流式前同结构），避免 message.complete 时突然插入 DOM 导致气泡跳变
  // 🔴 气泡宽度随文字自适应（w-fit + max-w 上限）：短消息小气泡、长消息封顶；
  //   宽度变化由 useSmoothReveal 逐帧驱动（每帧 ≤30 字符）→ 平滑缩放无跳变
  return (
    <div ref={enterRef} className="group relative w-fit max-w-[85%] min-w-0 select-text">
      <div className="bg-card text-card-foreground rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed border border-[var(--ui-stroke-tertiary)] shadow-sm overflow-hidden">
        <StreamBlocks ref={textRef} text={deferredContent} streaming={!!streaming} sessionId={sessionId} />
        {/* 🔴 2026-08-09 本地媒体块级渲染（对齐 Hermes MediaAttachment）：
            不走 markdown 管线，React 组件直读文件 → img（100% 可控） */}
        {mediaRefs.refs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {/* 🔴 2026-09-03 按媒体形态分派（对齐 Hermes MediaAttachment）：
                video/audio → 播放器，image → 图片（lightbox），file → 图片兜底 */}
            {mediaRefs.refs.map((ref, i) => {
              const kind = mediaKind(ref.path);
              if (kind === 'video') {
                return <MediaVideo key={`${ref.path}-${i}`} path={ref.path} name={ref.name} />;
              }
              if (kind === 'audio') {
                return <MediaAudio key={`${ref.path}-${i}`} path={ref.path} name={ref.name} />;
              }
              return <MediaImage key={`${ref.path}-${i}`} path={ref.path} name={ref.name} onZoom={(src) => { setZoomedSrc(src); setZoomedName(ref.name) }} />;
            })}
          </div>
        )}
      </div>
      {/* 🔴 2026-08-10 操作栏悬浮气泡内右下角（不占文档流——原 opacity 占位导致气泡间视觉空隙大） */}
      <div className="absolute bottom-1 right-1.5 flex gap-0.5 opacity-0 translate-y-[-2px] transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto">
        <button
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 text-xs',
            'bg-background/80 backdrop-blur-sm shadow-sm',
            'text-muted-foreground hover:text-foreground hover:bg-accent',
            copied && 'text-success'
          )}
          title={copied ? '已复制' : '复制'}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </button>
        {onDelete && messageId && (
          <button
            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 bg-background/80 backdrop-blur-sm shadow-sm transition-all outline-none"
            title="删除消息"
            onClick={() => onDelete(messageId)}
          >
            <TrashIcon size={13} />
          </button>
        )}
      </div>
      {/* 图片放大灯箱 — portal 到 body，避免外层 contain-[layout_paint] 裁剪 fixed 定位 */}
      {zoomedSrc && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: 'var(--ui-bg-chrome)', cursor: 'zoom-out' }}
          onClick={() => setZoomedSrc(null)}
        >
          <img
            src={zoomedSrc}
            className="max-w-[95vw] max-h-[95vh] object-contain"
            alt="放大预览"
          />
        </div>,
        document.body
      )}
    </div>
  );
}
