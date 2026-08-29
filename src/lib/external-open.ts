/**
 * openExternal — 系统默认程序打开的单一出口
 * （🔴 2026-08-29 严禁重复造轮子：此前 ToolEntry/DirectiveText/StreamBlocks/
 * ArtifactsGallery/PreviewWebPane/PreviewStatusStrip 六处各持一份
 * 「Tauri shell → window.open 降级」内联实现，现统一于此。
 * 对齐 Hermes openExternal 单一出口语义。）
 *
 * URL → 系统默认浏览器；本地路径 → 系统默认程序。非 Tauri 环境（浏览器 dev）
 * 直接 window.open。
 */

import { isDesktop } from '@/utils/bridge';

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
