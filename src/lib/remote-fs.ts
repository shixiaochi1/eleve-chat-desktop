/**
 * remote-fs.ts — 远程文件内容读写（对齐 Hermes desktop-fs.ts 的 remote 分支）
 *
 * Hermes remote 模式 fs 操作走 HTTP /api/fs/*（read-text/read-data-url/write-text）；
 * ELEVE 文件树/git/cwd 已走 WS 天然远程，仅「文件内容读写」（预览/spot editor）
 * 在 Tauri 壳本地直读——remote 模式下必须改走本模块，否则预览/保存断线。
 *
 * 契约（对齐 Hermes + ELEVE 后端 fs_remote.rs）：
 * - GET  /api/fs/stat?path=            → { size, isDir }
 * - GET  /api/fs/read-text?path=       → { text, byteSize }
 * - GET  /api/fs/read-data-url?path=&mime= → { dataUrl, byteSize }
 * - POST /api/fs/write-text {path,content} → { ok, path }
 */
import { getHttpBase } from '../utils/bridge';
import { isRemoteMode, loadConnection } from './connection';

/** 当前是否为远程 fs 模式（对齐 Hermes isDesktopFsRemoteMode） */
export function isFsRemoteMode(): boolean {
  return isRemoteMode(loadConnection());
}

async function fsApi<T>(path: string, options?: { body?: unknown }): Promise<T> {
  const base = getHttpBase().replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    method: options?.body !== undefined ? 'POST' : 'GET',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function remoteStat(path: string): Promise<{ size: number; isDir: boolean }> {
  return fsApi(`/api/fs/stat?path=${encodeURIComponent(path)}`);
}

export async function remoteReadText(path: string): Promise<{ text: string; byteSize: number }> {
  return fsApi(`/api/fs/read-text?path=${encodeURIComponent(path)}`);
}

export async function remoteReadDataUrl(path: string, mime?: string): Promise<{ dataUrl: string; byteSize: number }> {
  const mimeParam = mime ? `&mime=${encodeURIComponent(mime)}` : '';
  return fsApi(`/api/fs/read-data-url?path=${encodeURIComponent(path)}${mimeParam}`);
}

export async function remoteWriteText(path: string, content: string): Promise<void> {
  await fsApi('/api/fs/write-text', { body: { path, content } });
}
