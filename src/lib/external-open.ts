/**
 * openExternal / openLink — 链接打开的单一出口
 * （🔴 2026-08-29 严禁重复造轮子：此前 ToolEntry/DirectiveText/StreamBlocks/
 * ArtifactsGallery/PreviewWebPane/PreviewStatusStrip 六处各持一份
 * 「Tauri shell → window.open 降级」内联实现，现统一于此。）
 *
 * 🔴 2026-08-30 对齐 Hermes openLink（lib/external-link.tsx L232-251）：
 * - web 页面（http/https）→ **内嵌预览面板**（openPreview）——"A web page
 *   opens in the in-app browser — that pane exists so reading a doc doesn't
 *   cost a context switch out of the app, and it is the surface the agent
 *   can see."（点击消息里的链接在前端界面内打开，这就是 Hermes 内置浏览器
 *   的入口语义）
 * - Ctrl(Win/Linux)/⌘(mac)/中键 → 系统浏览器（wantsNativeBrowser：要登录态
 *   的场景逃逸，"where you go for anything needing your logged-in session"）
 * - 非 web 协议（mailto:/file:/自定义 scheme）→ OS（webview 里没有意义）
 * - openExternal 保留：显式逃逸动作（预览面板"系统浏览器打开"按钮等）
 */

import { isDesktop } from '@/utils/bridge';
// 🔴 2026-09-01 分层归位：use-link-title 已从 lib/ 迁至 hooks/
import { normalizeExternalUrl } from '@/hooks/use-link-title';

export async function openExternal(target: string): Promise<void> {
  if (isDesktop()) {
    try {
      const { open: shellOpen } = await import('@tauri-apps/plugin-shell');
      await shellOpen(target);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(target, '_blank', 'noopener,noreferrer');
}

/** 对齐 Hermes wantsNativeBrowser（external-link.tsx L214-220）：中键 /
 *  Ctrl(Win/Linux) / ⌘(mac) = 用户要求系统浏览器——"the modifier every app
 *  uses for 'open this somewhere else'"。 */
export function wantsNativeBrowser(
  event?: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey'> | null,
): boolean {
  if (!event) return false;
  const isMac = /mac/i.test(navigator.platform);
  return event.button === 1 || (isMac ? event.metaKey : event.ctrlKey);
}

/** 链接打开决策（对齐 Hermes openLink 逐条规则）：
 *  web 页面 → 内嵌预览面板；修饰键或非 web 协议 → 系统默认程序。
 *  lazy import store/preview（对齐 Hermes：leaf 模块不把预览布局依赖图
 *  拖进每个渲染链接的 surface，tab 落地晚一个 microtask 不可见）。 */
export async function openLink(
  href: string,
  event?: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey'> | null,
): Promise<void> {
  const target = normalizeExternalUrl(href);
  if (!target) return;

  let protocol = '';
  try {
    protocol = new URL(target).protocol;
  } catch {
    // 非 URL 形态 → 交 OS
    await openExternal(target);
    return;
  }

  if (wantsNativeBrowser(event) || !/^https?:$/i.test(protocol)) {
    await openExternal(target);
    return;
  }

  void import('@/store/preview').then(({ openPreview }) =>
    openPreview({ kind: 'url', url: target }, 'explicit-link'),
  );
}
