/**
 * ArtifactPreviewPane — 预览中心 artifact tab 内容区（🔴 2026-08-20 对齐 Hermes
 * preview-artifact.tsx：让生成的 HTML/SVG 产物显示在预览区）
 *
 * 内容源 = store/artifacts 注册表（artifactId = `${sessionId}:${slug}`）：
 * - html → iframe srcDoc（composeArtifactHtml 包完整文档；渲染/源码双模式）
 * - svg → 内联 data URL（渲染/源码双模式）
 * - code → 仅源码
 * - 未知 id / 已清理 → 空态提示
 *
 * 与右栏 ArtifactPanel 的分工：ArtifactPanel 管产物管理（版本/下载/浏览器打开/
 * 跨会话产物库），本组件只做"把产物渲染进预览中心"——对齐 Hermes 统一预览分派。
 */

import { useEffect, useMemo, useState } from 'react'
import { FileCode2, Loader2, AlertCircle } from 'lucide-react'
import type { PreviewTab } from '@/store/preview'
import { findArtifact, useArtifacts } from '@/store/artifacts'
import { composeArtifactHtml } from '@/lib/artifact-render'
import { cn } from '@/lib/utils'

type ArtifactViewMode = 'rendered' | 'source'

export default function ArtifactPreviewPane({ tab }: { tab: PreviewTab }) {
  const registry = useArtifacts()
  const record = useMemo(
    () => (tab.target.artifactId ? findArtifact(registry, tab.target.artifactId) : null),
    [registry, tab.target.artifactId],
  )
  const [mode, setMode] = useState<ArtifactViewMode>('rendered')

  // tab 切换 → 重置视图模式（对齐 Hermes：文件切换重置 userMode）
  useEffect(() => {
    setMode('rendered')
  }, [tab.id])

  if (!record) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 bg-[var(--ui-bg-editor)] text-[var(--ui-text-quaternary)]">
        <AlertCircle size={28} strokeWidth={1.2} />
        <span className="text-xs text-[var(--ui-text-secondary)]">产物已不在注册表（可能已被清理）</span>
        <span className="text-[10px] text-[var(--ui-text-tertiary)]">{tab.target.artifactId}</span>
      </div>
    )
  }

  const current = record.versions[record.versions.length - 1]
  const content = current?.content ?? ''
  const isHtml = record.kind === 'html'
  const isSvg = record.kind === 'svg'
  const renderable = isHtml || isSvg
  const effectiveMode: ArtifactViewMode =
    mode === 'rendered' && renderable ? 'rendered' : 'source'
  const htmlDoc = isHtml ? composeArtifactHtml(content) : ''
  const svgSrc = isSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}` : ''

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[var(--ui-bg-editor)]">
      {/* 头部：名称 + 视图切换（渲染/源码，对齐 Hermes PreviewModeSwitcher） */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)]">
        <FileCode2 size={13} className="text-info shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-primary)]" title={record.title}>
          {record.title}
        </span>
        {record.versions.length > 1 && (
          <span className="text-[10px] text-[var(--ui-text-tertiary)] shrink-0" title="最新版本">
            v{record.versions.length}
          </span>
        )}
        {renderable && (
          <div className="flex shrink-0 items-center rounded-md border border-[var(--ui-stroke-secondary)] overflow-hidden">
            {(['rendered', 'source'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'px-2 py-0.5 text-[10px] font-medium transition-colors',
                  effectiveMode === m
                    ? 'bg-[var(--ui-control-active-background)] text-[var(--ui-text-primary)]'
                    : 'text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)]',
                )}
              >
                {m === 'rendered' ? '渲染' : '源码'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0">
        {!current ? (
          <div className="flex h-full items-center justify-center gap-2 text-[var(--ui-text-quaternary)]">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">加载中...</span>
          </div>
        ) : effectiveMode === 'rendered' && isHtml ? (
          <iframe
            srcDoc={htmlDoc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            title={record.title}
            className="w-full h-full border-none bg-white"
          />
        ) : effectiveMode === 'rendered' && isSvg ? (
          <div className="flex h-full items-center justify-center p-4 overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgSrc} alt={record.title} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <pre className="h-full overflow-auto p-3 text-[11px] leading-relaxed text-[var(--ui-text-primary)] whitespace-pre-wrap break-all">
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
