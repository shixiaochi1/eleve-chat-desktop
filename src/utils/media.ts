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

/**
 * 检查文本是否可能包含需要解析的本地媒体（MEDIA: 标签或本地路径图片）
 */
export function mayHaveLocalImage(text?: string): boolean {
  if (!text) return false;
  if (text.includes('MEDIA:')) return true;
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

/**
 * 从文本提取 MEDIA:path 引用列表（🔴 2026-08-09 方案 C：不走 markdown 管线）：
 * MessageBubble 直接用 React 组件渲染图片（对齐 Hermes MediaAttachment 块级组件），
 * 绕开 StreamBlocks 预处理/插件/DOMPurify 任何一环——send_local_image 显示异常
 * 已多次证明 base64 内联和 #media: 链接都不可靠，块级组件 100% 可控。
 * @returns clean 文本（MEDIA 行保留空行结构）+ refs（path/name 列表）
 */
export function extractMediaRefs(text: string): { clean: string; refs: { path: string; name: string }[] } {
  const refs: { path: string; name: string }[] = [];
  const clean = text.replace(MEDIA_LINE_RE, (_match, lead: string, value: string, trail: string) => {
    const path = unquoteMediaPath(value);
    refs.push({ path, name: mediaName(path) });
    // 保留换行结构（lead + trail），仅删 MEDIA 行内容
    return `${lead}${trail}`;
  });
  return { clean, refs };
}

/**
 * 解析本地媒体路径 → 可渲染 src（对齐 Hermes resolveMediaDisplaySrc）：
 * - 内联/网络 URL（http/data/blob）→ 原样
 * - 本地 Tauri 桌面 → plugin-fs 读文件 → data URL（对齐 Hermes readFileDataUrl）
 * - remote / 读失败兜底 → 后端 WS media.resolve（MEDIA: 单路径 → 提取 data URL）
 */
export async function resolveMediaSrc(path: string): Promise<string | null> {
  if (/^(https?:|data:|blob:)/i.test(path)) return path;

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
