/**
 * ArtifactHtmlFrame — HTML 产物沙箱 iframe 单一实现
 * （🔴 2026-08-29 严禁重复造轮子：ArtifactPanel 预览区/全屏浮层/ArtifactCard
 * 宫格浮层/ArtifactPreviewPane 此前各持一份同款 iframe 配置，现统一于此）
 *
 * 安全基线（对齐 Hermes preview-artifact）：sandbox 仅 allow-scripts——
 * srcDoc + allow-same-origin 组合会给生成页面开同源能力（可读父域存储/
 * 带凭据发请求）；内容经 composeArtifactHtml 包完整文档（片段 HTML 直塞
 * srcDoc 走 quirks 模式）。
 */

import { composeArtifactHtml } from '@/lib/artifact-render';

interface ArtifactHtmlFrameProps {
  content: string;
  title: string;
  className?: string;
}

export default function ArtifactHtmlFrame({ content, title, className }: ArtifactHtmlFrameProps) {
  return (
    <iframe
      sandbox="allow-scripts"
      srcDoc={composeArtifactHtml(content)}
      referrerPolicy="no-referrer"
      className={className ?? 'block size-full border-0 bg-white'}
      style={{ colorScheme: 'light' }}
      title={title}
    />
  );
}
