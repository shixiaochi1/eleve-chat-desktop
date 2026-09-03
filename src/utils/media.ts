/**
 * MEDIA: / 本地文件路径标签处理 — 对齐 Hermes renderMediaTags + resolveMediaDisplaySrc
 *
 * 🔴 2026-08-09 重构（send_local_image 乱码事故根因，老大指示对齐 Hermes）：
 *   旧实现把本地图片整段 base64 内联进 markdown 文本（后端 resolve_media 返回
 *   `![Screenshot](data:...)`），大图 base64 触发 StreamBlocks 大文本降级 →
 *   纯文本显示乱码 + DOMPurify 剥 data: URI + marked 解析卡顿三连。
 *
 *   对齐 Hermes 架构（lib/media.ts + markdown-text.tsx）：
 *   1. `MEDIA:path` → markdown 图片语法 `![name](path)`（本地路径直引，不进 base64）
 *   2. markdown 渲染层（rehypeLocalMediaPlaceholder）把本地路径 img 转为
 *      `data-media-src` 占位（不进 markdown 文本流）
 *   3. StreamBlocks 渲染后异步 resolveMediaSrc() 读文件 → 挂载到 img.src
 *      （React 组件层 state，图片永远不进 markdown 文本 → 无降级/过滤/卡顿问题）
 */
import { call, isDesktop } from './bridge';
import { mimeFromExt, arrayBufferToBase64 } from './file';

/** 独立行 MEDIA: 标签（对齐 Hermes MEDIA_LINE_RE：行首/换行后 + 行尾） */
export const MEDIA_LINE_RE = /(^|\n)[\t ]*MEDIA:\s*([^\n\r]+?)[\t ]*(\n|$)/g;

/** 本地图片 markdown 语法（`![](path)`，非 http/data/# 开头） */
const LOCAL_IMG_RE = /!\[[^\]]*\]\((?!https?:|data:|#|\/\/)[^)]+\)/;

/** 裸本地音视频路径快速检测（对齐 extractMediaRefs 的 BARE_MEDIA_RE，轻量版） */
const BARE_MEDIA_QUICK_RE = /[A-Za-z]:[\\/][^`\n"']+\.(?:mp4|webm|mov|mkv|avi|mp3|wav|ogg|flac|m4a|opus)/i;

/**
 * 检查文本是否可能包含需要解析的本地媒体（MEDIA: 标签 / 本地路径图片 /
 * 🔴 2026-09-03 裸本地音视频路径——追问场景 LLM 回反引号路径）
 */
export function mayHaveLocalImage(text?: string): boolean {
  if (!text) return false;
  if (text.includes('MEDIA:')) return true;
  if (BARE_MEDIA_QUICK_RE.test(text)) return true;
  return LOCAL_IMG_RE.test(text);
}

/** 剥离引号包裹（对齐 Hermes unquoteMediaPath：`"path"` / `'path'` / `\`path\``） */
function unquoteMediaPath(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return quote && quote === trimmed.at(-1) && ['"', "'", '`'].includes(quote) ? trimmed.slice(1, -1) : trimmed;
}

/** 从路径提取文件名（对齐 Hermes mediaName） */
export function mediaName(path: string): string {
  // 🔴 Windows 盘符路径（C:\...）优先按路径分割——new URL 会把盘符当 scheme 解析
  // （C:\Users\x.png → scheme=C:，pathname=\Users\x.png），文件名提取全错。
  if (/^[a-z]:[\\/]/i.test(path)) {
    return path.split(/[\\/]/).filter(Boolean).pop() || path;
  }
  try {
    const url = new URL(path);
    return url.pathname.split('/').filter(Boolean).pop() || path;
  } catch {
    return path.split(/[\\/]/).filter(Boolean).pop() || path;
  }
}

// ── 媒体形态分类（🔴 2026-09-03 对齐 Hermes lib/media.ts MEDIA_BY_EXT）──
// 此前视频无任何渲染路径：MEDIA:xx.mp4 / ![x](xx.mp4) 一律按图片渲染 → 破图。
// Hermes 语义：MarkdownImage 按扩展名 mediaKind 分派 <video>/<audio>/<img>。

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

const MEDIA_BY_EXT: Record<string, { kind: MediaKind; mime: string }> = {
  // 视频（对齐 Hermes MEDIA_BY_EXT video 条目）
  avi: { kind: 'video', mime: 'video/x-msvideo' },
  mkv: { kind: 'video', mime: 'video/x-matroska' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  // 音频（TTS 结果 MEDIA: 标签内联播放；对齐 Hermes audio 条目）
  flac: { kind: 'audio', mime: 'audio/flac' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  opus: { kind: 'audio', mime: 'audio/ogg; codecs=opus' },
  wav: { kind: 'audio', mime: 'audio/wav' },
};

/** 路径 → 媒体形态（扩展名判定；未知归 file，对齐 Hermes mediaKind） */
export function mediaKind(path: string): MediaKind {
  const ext = path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() ?? '';
  return MEDIA_BY_EXT[ext]?.kind ?? 'file';
}

function mediaMimeOf(path: string): string {
  const ext = path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() ?? '';
  return MEDIA_BY_EXT[ext]?.mime ?? 'application/octet-stream';
}

/** 音视频（播放器渲染形态判定；无扩展名/blob/data URL 归 file 走图片路径，对齐 Hermes） */
export function isPlayableMedia(path: string): boolean {
  const k = mediaKind(path);
  return k === 'video' || k === 'audio';
}

/**
 * 从文本提取 MEDIA:path 引用列表（🔴 2026-08-09 方案 C：不走 markdown 管线）：
 * MessageBubble 直接用 React 组件渲染图片（对齐 Hermes MediaAttachment 块级组件），
 * 绕开 StreamBlocks 预处理/插件/DOMPurify 任何一环——send_local_image 显示异常
 * 已多次证明 base64 内联和 #media: 链接都不可靠，块级组件 100% 可控。
 *
 * 🔴 2026-09-03 增强：**裸本地音视频路径**（反引号包裹或独立行，如用户追问
 * "视频在哪"后 LLM 回 `` `E:\...\x.mp4` ``）同样提取为块级播放器引用——
 * 此前裸路径只显示代码文本，消息区看不到视频（实测断点，用户报告）。
 * @returns clean 文本（MEDIA 行保留空行结构）+ refs（path/name 列表）
 */
export function extractMediaRefs(text: string): { clean: string; refs: { path: string; name: string }[] } {
  const refs: { path: string; name: string }[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const p = unquoteMediaPath(raw);
    if (!seen.has(p)) {
      seen.add(p);
      refs.push({ path: p, name: mediaName(p) });
    }
  };
  const clean = text.replace(MEDIA_LINE_RE, (_match, lead: string, value: string, trail: string) => {
    push(value);
    // 保留换行结构（lead + trail），仅删 MEDIA 行内容
    return `${lead}${trail}`;
  });
  // 裸本地音视频路径：反引号/引号包裹，或独立行以盘符/正斜杠开头的绝对路径。
  // 仅认音视频扩展名（图片有 send_local_image/MEDIA 既有通道，不扩大改动面）。
  const BARE_MEDIA_RE = /[`"']?((?:[A-Za-z]:[\\/]|\/(?:home|Users|mnt)[\\/])[^`\n"']+\.(?:mp4|webm|mov|mkv|avi|mp3|wav|ogg|flac|m4a|opus))[`"']?/gi;
  let m: RegExpExecArray | null;
  while ((m = BARE_MEDIA_RE.exec(clean)) !== null) {
    push(m[1]);
  }
  return { clean, refs };
}

/**
 * 解析本地媒体路径 → 可渲染 src（对齐 Hermes resolveMediaDisplaySrc）：
 * - 内联/网络 URL（http/data/blob）→ 原样
 * - 🔴 2026-08-29 `/media/...` 相对 URL（image_generate 结果本地化）→ 拼
 *   gateway HTTP base（gateway 有 /media/* ServeDir 静态路由；主 UI origin
 *   是 tauri.localhost，相对请求 404 = 用户实测"图片加载失败"根因）
 * - 本地 Tauri 桌面 → plugin-fs 读文件 → data URL（对齐 Hermes readFileDataUrl）
 * - remote / 读失败兜底 → 后端 WS media.resolve（MEDIA: 单路径 → 提取 data URL）
 */
export async function resolveMediaSrc(path: string): Promise<string | null> {
  if (/^(https?:|data:|blob:)/i.test(path)) return path;

  // 🔴 2026-08-29：gateway 本地化相对 URL（/media/images/...）→ 拼 gateway base
  //（主 UI origin=tauri.localhost 无 /media 路由，必须显式走 gateway HTTP）
  if (/^\/media\//i.test(path)) {
    const { getHttpBase, discoverPort, isDesktop: desktop } = await import('./bridge');
    if (desktop() && !(await import('./bridge')).isHttpBaseSet()) {
      await discoverPort();
    }
    return `${getHttpBase()}${path}`;
  }

  // 本地 Tauri 桌面：直接读文件（与 useImageAttachments.addImageFromPath 同款快路径）
  if (isDesktop()) {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(path);
      const mime = mimeFromExt(path) ?? 'image/png';
      return `data:${mime};base64,${arrayBufferToBase64(bytes)}`;
    } catch (err) {
      console.warn('[media] local read failed, falling back to gateway:', err);
    }
  }

  // remote / 兜底：后端 resolve_media（返回 `![Screenshot](data:...)` → 提取 data URL）
  try {
    const result = await call('resolve_media', { text: `MEDIA:${path}` });
    const text = ((result?.result as string | undefined) ?? (result?.text as string | undefined)) || '';
    const m = text.match(/\]\((data:[^)]+)\)/);
    return m ? m[1] : null;
  } catch (err) {
    console.warn('[media] resolve failed:', err);
    return null;
  }
}

/** 播放源解析结果（🔴 2026-09-03 失败根因透传：failed 态直接显示原因，
 *  终结"视频加载失败"但不知断在哪一环的盲猜） */
export interface MediaPlaybackResult {
  src: string | null;
  /** src 为 null 时的失败原因（多级尝试的最后一环错误） */
  error?: string;
}

/**
 * 解析音视频路径 → 可播放 src（🔴 2026-09-03 对齐 Hermes resolveMediaPlaybackSrc：
 * "Audio/video need a seekable source instead of a whole-file data URL"——图片
 * 走 data URL 可行，音视频不行（体积 + 无法 seek）。ELEVE 无 hermes-media://
 * 自定义协议，等价策略：gateway ServeDir Range 流式优先，blob 兜底）：
 * - http(s)/data/blob → 原样（webview 直接播；跨域 <video> 不受 CORS 限制）
 * - /media/ 相对 URL（gateway 本地化）→ 拼 gateway base（ServeDir Range 流式）
 * - 本地路径：先按文件名探 gateway `/media/{videos|audio}/<name>`
 *   （video_generate 产物在 cache/videos，TTS 在 cache/audio——流式零内存）；
 *   未命中（用户手头文件）→ Tauri 读字节 → blob URL（一次读入，支持 seek）
 */
export async function resolveMediaPlaybackSrc(path: string): Promise<MediaPlaybackResult> {
  if (/^(https?:|data:|blob:)/i.test(path)) return { src: path };

  let gatewayBase: string | null = null;
  try {
    const bridge = await import('./bridge');
    if (bridge.isDesktop() && !bridge.isHttpBaseSet()) {
      const ok = await bridge.discoverPort();
      if (!ok) console.warn('[media] discoverPort failed — gateway HTTP base unavailable');
    }
    gatewayBase = bridge.getHttpBase() || null;
  } catch { /* bridge 不可用（纯浏览器）→ 无 gateway */ }

  if (/^\/media\//i.test(path)) {
    return gatewayBase
      ? { src: `${gatewayBase}${path}` }
      : { src: null, error: `gateway HTTP base 不可用（${path}）` };
  }

  // 本地路径 → 文件名映射 gateway 回服（cache/videos|audio 下的生成产物命中）
  const name = mediaName(path).split(/[?#]/, 1)[0];
  let serveError = 'gateway HTTP base 不可用';
  if (gatewayBase && /\.[a-z0-9]+$/i.test(name)) {
    const segment = mediaKind(path) === 'audio' ? 'audio' : 'videos';
    const serveUrl = `${gatewayBase}/media/${segment}/${encodeURIComponent(name)}`;
    try {
      const resp = await fetch(serveUrl, { method: 'HEAD' });
      if (resp.ok) return { src: serveUrl };
      serveError = `ServeDir ${resp.status}（${serveUrl}）`;
    } catch (err) {
      serveError = `ServeDir 不可达（${err instanceof Error ? err.message : String(err)}）`;
    }
  }

  if (isDesktop()) {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(path);
      return { src: URL.createObjectURL(new Blob([bytes], { type: mediaMimeOf(path) })) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn('[media] playback read failed:', err);
      return { src: null, error: `读文件失败：${detail}；${serveError}` };
    }
  }
  return { src: null, error: serveError };
}

/**
 * 🔴 2026-08-31 任意 src → 可编辑 data URL（图片编辑器入口归一化）。
 *
 * 编辑器合成走 canvas.drawImage + toDataURL——跨域 http 图会 taint canvas 直接
 * SecurityError；本地路径/http URL /media 相对路径必须先归一成 data URL。
 * - data: → 原样（已是 data URL）
 * - 其余 → resolveMediaSrc（本地路径读文件 / /media 拼 gateway base / http 透传）
 *   → 若结果仍是 http(s)（/media 相对 URL 拼接后的 gateway 地址、远程 URL）→
 *   fetch → blob → data URL（gateway CORS 默认谓词放行 tauri.localhost——含 "localhost"）
 * 失败 → null（调用方显示错误，禁用编辑）。
 */
export async function resolveToEditableDataUrl(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src;
  try {
    const resolved = await resolveMediaSrc(src);
    if (!resolved) return null;
    if (resolved.startsWith('data:')) return resolved;
    const resp = await fetch(resolved);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.onabort = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
