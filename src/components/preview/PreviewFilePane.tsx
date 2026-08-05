/**
 * PreviewFilePane — 本地文件预览内容区（对齐 Hermes LocalFilePreview）
 *
 * 按扩展名分派渲染：markdown（复用 lib/markdown unified 管线）/ 代码高亮 / 图片 / CSV。
 * 文件读取走 tauri-plugin-fs（Hermes Electron 直读 fs 的 Tauri 等价物）。
 */

import { File } from 'lucide-react';
import type { PreviewTab } from '@/store/preview';

interface PreviewFilePaneProps {
  tab: PreviewTab;
}

export default function PreviewFilePane({ tab }: PreviewFilePaneProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-0 text-[var(--ui-text-quaternary)] gap-2">
      <File size={32} strokeWidth={1} />
      <span className="text-xs">文件预览（建设中）</span>
      <span className="text-[10px] text-[var(--ui-text-quaternary)]/70">{tab.target.url}</span>
    </div>
  );
}
