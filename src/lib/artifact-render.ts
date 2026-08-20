/**
 * artifact-render — HTML/SVG 产物渲染工具（🔴 2026-08-20 从 ArtifactPanel 提取共享）
 *
 * ArtifactPanel（右栏产物）与 ArtifactPreviewPane（预览中心 artifact tab）共用：
 * composeArtifactHtml 把片段包成完整 HTML 文档（iframe srcDoc 渲染用）。
 */

/** 片段 → 完整 HTML 文档（完整文档原样返回；对齐 Hermes artifact-utils composeHtml） */
export function composeArtifactHtml(content: string): string {
  if (/<html[\s>]|<!doctype\s+html/i.test(content)) return content
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>',
    content,
    '</body></html>',
  ].join('\n')
}
