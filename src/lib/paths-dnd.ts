/**
 * paths-dnd — 文件树路径拖拽共享协议（对齐 Hermes HERMES_PATHS_MIME）
 *
 * Hermes 树行拖拽载荷：`application/x-hermes-paths` = JSON [{isDirectory, path}]
 * + `text/plain` = 路径兜底；聊天 composer 与终端各自消费（use-composer-drop /
 * use-terminal-session）。ELEVE 同款双 MIME，消费方 = 聊天输入框 / 终端。
 */
export const ELEVE_PATHS_MIME = 'application/x-eleve-paths';

/** 树行 onDragStart 载荷（对齐 Hermes tree.tsx onDragStart） */
export function setPathsDragPayload(dt: DataTransfer, path: string, isDirectory: boolean): void {
  dt.effectAllowed = 'copy';
  dt.setData(ELEVE_PATHS_MIME, JSON.stringify([{ isDirectory, path }]));
  dt.setData('text/plain', path);
}

/** 拖拽目标收集路径（对齐 Hermes collectDroppedPaths：MIME 优先，text/plain 兜底） */
export function collectDroppedPaths(dt: DataTransfer): string[] {
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const p = value.trim();
    if (p) seen.add(p);
  };

  try {
    const raw = dt.getData(ELEVE_PATHS_MIME);
    if (raw) {
      for (const entry of JSON.parse(raw) as { path?: unknown }[]) push(entry?.path);
    }
  } catch {
    // 载荷损坏 → 走 text/plain 兜底
  }

  if (seen.size === 0) push(dt.getData('text/plain'));

  return [...seen];
}

/** 拖拽目标是否有可接受载荷（onDragOver 决定是否 preventDefault 放行） */
export function dragHasPaths(dt: DataTransfer): boolean {
  const types = Array.from(dt.types ?? []);
  return types.includes(ELEVE_PATHS_MIME) || types.includes('text/plain');
}

/** 路径写入 shell 前转义：含空格才加双引号（cmd/pwsh/bash 通用），防路径被拆词 */
export function quoteShellPath(path: string): string {
  const trimmed = path.trim();
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}
