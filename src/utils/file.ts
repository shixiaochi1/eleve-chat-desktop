/**
 * 文件读取工具 — 通用文件 → base64 转换
 *
 * 提取自 useImageAttachments + KanbanPanel 的公共逻辑，避免重复造轮子。
 * 纯函数，无状态，无副作用（readFileAsDataURL 是标准 FileReader 封装）。
 */

/**
 * 将 File 读取为 base64 data URL
 * @returns data:image/xxx;base64,xxxx 格式的字符串
 */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * 从 data URL 中提取纯 base64 内容（去除 data:image/...;base64, 前缀）
 * 用于上传到后端（后端只需纯 base64，不需要 MIME 前缀）
 */
export function base64FromDataURL(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * base64（纯内容，无前缀）→ 字节。HTTP 直传附件用（原始字节零 base64 膨胀）。
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 从文件扩展名推断 MIME（本地路径读图/读文件预览用；对齐后端扩展名白名单） */
export function mimeFromExt(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    case 'ico': return 'image/x-icon';
    case 'tiff':
    case 'tif': return 'image/tiff';
    default: return undefined;
  }
}

/** Uint8Array → base64（Tauri plugin-fs 读出的字节；浏览器 btoa 处理二进制需分块） */
export function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
