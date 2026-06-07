/**
 * MEDIA: / 本地文件路径标签处理 — IPC 版
 * 将 MEDIA:/path/to/file 或 ![alt](local_path) 转换为 base64 data URL markdown 图片
 */
import { call } from './bridge';

/**
 * 检查文本是否可能包含需要解析的本地图片
 */
function mayHaveLocalImage(text: string): boolean {
  if (!text) return false;
  if (text.includes('MEDIA:')) return true;
  return /!\[[^\]]*\]\((?!https?:|data:|#|\/\/)[^)]+\)/.test(text);
}

/**
 * 解析文本中的本地图片引用
 */
export async function resolveMediaText(text: string): Promise<string> {
  if (!mayHaveLocalImage(text)) return text;
  try {
    const result = await call('resolve_media', { text });
    return result?.result || result?.text || text;
  } catch (e) {
    console.warn('[media] resolve-media failed:', e);
    return text;
  }
}
