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
