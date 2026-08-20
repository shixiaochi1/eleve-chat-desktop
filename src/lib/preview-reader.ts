/**
 * preview-reader — 预览页面读取注册表（🔴 2026-08-20 对齐 Hermes preview-reader.ts）
 *
 * Hermes 的 read_preview 工具通过 preview.read.request → 前端序列化活跃预览 tab
 * 内容 → preview.read.respond 往返读取页面文本。ELEVE 子 webview 是原生 HWND，
 * 页面文本只能经 Rust `preview_webview_read_text`（wry evaluate_script）获取，
 * 因此需要知道"当前活跃 url tab 对应的 webview label"——本模块维护该注册表：
 *
 * - PreviewWebPane 在 webview label 就绪时 register，卸载/切 tab 时 unregister
 * - preview-events 处理 preview.read.request 时经 getActivePreviewWebview() 取 label
 */
let activeLabel: string | null = null

/** PreviewWebPane 注册当前活跃 url tab 的 webview label */
export function registerActivePreviewWebview(label: string | null): void {
  activeLabel = label
}

/** 取当前活跃 url tab 的 webview label（无 url tab 时为 null） */
export function getActivePreviewWebview(): string | null {
  return activeLabel
}
