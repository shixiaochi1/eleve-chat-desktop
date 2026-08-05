/**
 * preview-targets — `#preview/` markdown 链接协议（对齐 Hermes lib/preview-targets.ts）
 *
 * 工具/模型输出 `[Preview:xxx](#preview/url)` 形式的链接：
 * - stripPreviewTargets：从正文剥离链接（正文不再显示裸链接）
 * - extractPreviewTargets：提取为预览目标列表 → 渲染可点击行 → openPreview
 * - previewMarkdownHref / previewTargetFromMarkdownHref：编解码
 */

const PREVIEW_MARKDOWN_RE = /\[Preview:[^\]]+\]\((?<href>#preview[:/][^)]+)\)/gi;

export function stripPreviewTargets(text: string): string {
  return text
    .replace(PREVIEW_MARKDOWN_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPreviewTargets(text: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(PREVIEW_MARKDOWN_RE)) {
    const target = previewTargetFromMarkdownHref(match.groups?.href);
    if (target && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
  }

  return targets;
}

export function previewMarkdownHref(target: string): string {
  return `#preview/${encodeURIComponent(target)}`;
}

export function previewTargetFromMarkdownHref(href?: string): string | null {
  if (!href?.startsWith('#preview:') && !href?.startsWith('#preview/')) {
    return null;
  }
  try {
    return decodeURIComponent(href.slice('#preview'.length + 1));
  } catch {
    return null;
  }
}

export function previewName(target: string): string {
  try {
    const url = new URL(target);
    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname).split(/[\\/]/).filter(Boolean).pop() || target;
    }
    const file = url.pathname.split('/').filter(Boolean).pop();
    return file || url.host;
  } catch {
    return target.split(/[\\/]/).filter(Boolean).pop() || target;
  }
}

export function previewDisplayLabel(target: string): string {
  const escaped = previewName(target).replace(/[[\]\\]/g, '\\$&');
  return `Preview: ${escaped}`;
}
