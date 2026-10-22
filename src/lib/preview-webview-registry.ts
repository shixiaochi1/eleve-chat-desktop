/**
 * preview-webview-registry — label ↔ tabId 模块级注册表（单一事实源）
 *
 * 🔴 2026-10-23 S1 多 webview 保活架构（对齐 Hermes：每 preview tab 持有独立
 * webview，pane 隐藏不销毁）：Rust 侧（src-tauri/src/preview_webview.rs）头注释
 * 规定"前端持有 label ↔ tab.id 映射"。旧实现该映射是 PreviewWebPane 的局部
 * state + 全局单值 preview-reader，随单实例组件复用/卸载而丢失；per-tab 常驻后
 * 升级为本模块级注册表——对齐 Hermes read_preview 的 per-tab readers
 * （right-rail/preview-reader.ts Map<tabId, PageReader>）。
 *
 * 生命周期：usePreviewWebview 创建成功 → register；组件卸载（tab 关闭移出
 * mountedTabs）→ unregister。幂等；unregister 带 label 防闭包乱序误删。
 */

export interface PreviewWebviewEntry {
  /** Rust 生成的 webview label（preview-<n>） */
  label: string
  /** 宿主 tab 的 target.kind（url tab / file HTML rendered） */
  kind: 'file' | 'url'
}

const byTabId = new Map<string, PreviewWebviewEntry>()

/** webview 创建成功后登记（同 tabId 重复 register = 刷新映射，幂等） */
export function registerPreviewWebview(tabId: string, entry: PreviewWebviewEntry): void {
  byTabId.set(tabId, entry)
}

/** tab 关闭/pane 卸载时注销。传 label 时仅当注册表里还是自己的 label 才删
 *  （异步闭包乱序防御：重建竞态期间旧 cleanup 不得误删新映射） */
export function unregisterPreviewWebview(tabId: string, label?: string): void {
  const current = byTabId.get(tabId)
  if (!current) return
  if (label && current.label !== label) return
  byTabId.delete(tabId)
}

/** 查 tab 对应的 webview（无 / 未就绪 → null） */
export function lookupPreviewWebview(tabId: string): PreviewWebviewEntry | null {
  return byTabId.get(tabId) ?? null
}

/** 解析"当前激活 tab"的 webview（read_preview / drive_preview 消费）：
 *  preview-events 已解析激活 tab 时传 activeTabId；无 tab 时为 null */
export function resolveActivePreviewWebviewLabel(activeTabId: string | null): string | null {
  if (!activeTabId) return null
  return byTabId.get(activeTabId)?.label ?? null
}
