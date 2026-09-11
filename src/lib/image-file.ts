/**
 * 图片文件 → data URL 的**唯一**工具集（选文件 / 方形归一化 / 缩略图）。
 *
 * 🔴 round-97 上提理由：此前 `makeImageThumb` 只活在 `BotsView.tsx` 里，而房间图
 * 需要"选一张图 + 归一到方形"——再各写一份就是第三、第四份 canvas 缩放实现。
 * 三方共用（群聊附件缩略图 / 房间图 / 后续头像）都必须落在这里。
 *
 * 归一化口径对齐 Hermes `apps/desktop/src/plugins/hermes-bots/avatar-image.ts`：
 * `normalizeAvatarImage(dataUrl, edge = 256)` = 居中裁正方形 → `toDataURL('image/png')`。
 */

/** 设备选择图片（返回 data URL）；超限 / 取消 / 读失败 → null（调用方不动状态）。 */
export function pickImageFile(maxBytes = 15_000_000): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (file.size > maxBytes) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };

    input.click();
  });
}

/** 读一个 File/Blob 为 data URL（拖拽 / 粘贴路径用；无大小上限判断）。 */
export function readImageFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * 居中裁正方形 + 缩到 `edge` 边长，输出 PNG data URL。
 *
 * 为什么必须裁方而不是等比缩：房间图渲染在**圆形**容器里（对齐 Hermes
 * `rounded-full` + `object-cover`），非方图不被裁会在圆里露出空白/偏移。
 * 失败（解码失败 / 无 canvas）返回原串——宁可存未归一化的图，也不要丢图。
 */
export async function normalizeSquareImage(dataUrl: string, edge = 256): Promise<string> {
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => res(null);
      img.onerror = () => rej(new Error('image load failed'));
      img.src = dataUrl;
    });
    const w = img.width || edge;
    const h = img.height || edge;
    const side = Math.min(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, edge, edge);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

/**
 * 等比缩到长边 `longEdge` 的 jpeg 缩略图（对齐 Hermes group-attachments
 * downscale；控制事件 payload 体积）。失败 → undefined（调用方降级为无缩略图）。
 */
export async function makeImageThumb(
  dataUrl: string,
  longEdge = 320,
  quality = 0.6,
): Promise<string | undefined> {
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => res(null);
      img.onerror = () => rej(new Error('image load failed'));
      img.src = dataUrl;
    });
    const scale = Math.min(1, longEdge / Math.max(img.width || 1, img.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
    canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return undefined;
  }
}
