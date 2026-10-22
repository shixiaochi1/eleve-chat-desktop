/**
 * ArtifactPreviewPane — 预览中心 artifact tab 内容区（🔴 2026-08-20 对齐 Hermes
 * preview-artifact.tsx：让生成的 HTML/SVG 产物显示在预览区）
 *
 * 内容源 = store/artifacts 注册表（artifactId = `${sessionId}:${slug}`）：
 * - html → iframe srcDoc（composeArtifactHtml 包完整文档；渲染/源码双模式）
 * - svg → 内联 data URL（渲染/源码双模式）
 * - code → 仅源码
 * - 未知 id / 已清理 → 空态提示（🔴 S2.7：带关闭标签页动作，对齐 Hermes 空态 onClose）
 *
 * 与右栏 ArtifactPanel 的分工：ArtifactPanel 管产物管理（跨会话产物库），
 * 本组件对齐 Hermes 预览头部动作（🔴 2026-10-23 S2.7）：复制内容 / 下载
 * （MIME 映射）/ 系统浏览器打开（写临时文件 → openPath——对齐 Hermes
 * saveImageBuffer 落盘再开）；🔴 S2.8 版本选择记忆（对齐 Hermes
 * $artifactVersionSelection：切 tab 再切回，仍停在上次所选版本）。
 */

import { useEffect, useMemo, useState } from 'react'
import { FileCode2, Loader2, AlertCircle, Copy, Download, ExternalLink, X } from 'lucide-react'
import type { PreviewTab } from '@/store/preview'
import { closeTab } from '@/store/preview'
import { findArtifact, useArtifacts } from '@/store/artifacts'
import { cn } from '@/lib/utils'
import { isDesktop } from '@/utils/bridge'
import { notifySuccess, notifyError } from '@/utils/notifications'
import { openExternal } from '@/lib/external-open'
import WindowedSourceView from '@/components/preview/WindowedSourceView'
import ArtifactHtmlFrame from '@/components/preview/ArtifactHtmlFrame'
// 🔴 复用 ArtifactPanel 的版本步进器（不重复造轮子）
import { VersionStepper } from '@/components/ArtifactPanel'

type ArtifactViewMode = 'rendered' | 'source'

/** 🔴 S2.8 对齐 Hermes $artifactVersionSelection：模块级按 artifactId 记忆版本
 *  选择——pane 是 per-tab 常驻但 tab 关闭/重开会丢本地 state；记忆让"切回
 *  仍停在所选版本"跨组件生命周期成立 */
const versionSelection = new Map<string, number | null>()

/** 本地路径 → file:// URL（外开临时文件用；PreviewWebPane 同款规则） */
function localPathToFileUrl(path: string): string {
  const p = path.replace(/\\/g, '/')
  const enc = (seg: string) => encodeURIComponent(seg).replace(/%3A/gi, ':')
  if (/^[a-zA-Z]:\//.test(p)) return `file:///${p.split('/').map(enc).join('/')}`
  if (p.startsWith('//')) return `file:${p.split('/').map(enc).join('/')}`
  return `file://${p.split('/').map(enc).join('/')}`
}

export default function ArtifactPreviewPane({ tab }: { tab: PreviewTab }) {
  const registry = useArtifacts()
  const record = useMemo(
    () => (tab.target.artifactId ? findArtifact(registry, tab.target.artifactId) : null),
    [registry, tab.target.artifactId],
  )
  const [mode, setMode] = useState<ArtifactViewMode>('rendered')
  // 🔴 2026-08-29 对齐 Hermes preview-artifact VersionStepper：版本步进——
  // 此前 Eye 按钮路径只渲染最新版，无法回看历史版本；null = 跟随最新
  // 🔴 S2.8：初值/切换恢复读记忆（null = 未记忆 = 跟随最新）
  const [versionIdx, setVersionIdxState] = useState<number | null>(
    () => (tab.target.artifactId ? versionSelection.get(tab.target.artifactId) ?? null : null),
  )

  // tab 切换 → 视图模式重置（对齐 Hermes：文件切换重置 userMode）；
  // 🔴 S2.8 版本选择不重置——从记忆恢复（对齐 Hermes $artifactVersionSelection）
  useEffect(() => {
    setMode('rendered')
    setVersionIdxState(
      tab.target.artifactId ? versionSelection.get(tab.target.artifactId) ?? null : null,
    )
  }, [tab.id, tab.target.artifactId])

  const setVersionIdx = (idx: number | null) => {
    if (tab.target.artifactId) versionSelection.set(tab.target.artifactId, idx)
    setVersionIdxState(idx)
  }

  if (!record) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 bg-[var(--ui-bg-editor)] text-[var(--ui-text-quaternary)]">
        <AlertCircle size={28} strokeWidth={1.2} />
        <span className="text-xs text-[var(--ui-text-secondary)]">产物已不在注册表（可能已被清理）</span>
        <span className="text-[10px] text-[var(--ui-text-tertiary)]">{tab.target.artifactId}</span>
        {/* 🔴 S2.7 对齐 Hermes 空态 onClose：给用户出口而不是死胡同 */}
        <button
          className="mt-1 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium bg-[var(--ui-bg-tertiary)] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] transition-colors"
          onClick={() => closeTab(tab.id)}
        >
          <X size={12} />
          关闭标签页
        </button>
      </div>
    )
  }

  const versionIndex =
    versionIdx === null
      ? record.versions.length - 1
      : Math.min(Math.max(0, versionIdx), record.versions.length - 1)
  const current = record.versions[versionIndex]
  const content = current?.content ?? ''
  const isHtml = record.kind === 'html'
  const isSvg = record.kind === 'svg'
  const renderable = isHtml || isSvg
  const effectiveMode: ArtifactViewMode =
    mode === 'rendered' && renderable ? 'rendered' : 'source'
  const svgSrc = isSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}` : ''

  // ── 🔴 S2.7 对齐 Hermes preview-artifact 头部三动作 ──

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      notifySuccess('已复制产物内容', '复制成功')
    } catch (e) {
      notifyError(e instanceof Error ? e : new Error(String(e)), '复制失败')
    }
  }

  const handleDownload = () => {
    // MIME 映射（对齐 Hermes MIME_BY_KIND）+ blob → a[download]
    const mime = isHtml ? 'text/html' : isSvg ? 'image/svg+xml' : 'text/plain'
    const ext = isSvg ? 'svg' : isHtml ? 'html' : record.language || 'txt'
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${record.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpenExternal = async () => {
    if (!isDesktop()) return
    try {
      // 对齐 Hermes openPreviewInBrowser：内容落临时文件再交系统打开
      // （浏览器对 blob:/data: 无 shell 打开语义，必须真实路径）
      const { tempDir, join } = await import('@tauri-apps/api/path')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      const ext = isSvg ? 'svg' : 'html'
      const safe = record.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 50) || 'artifact'
      const file = await join(await tempDir(), `eleve-artifact-${Date.now()}-${safe}.${ext}`)
      await writeTextFile(file, content)
      void openExternal(localPathToFileUrl(file))
    } catch (e) {
      notifyError(e instanceof Error ? e : new Error(String(e)), '外部打开失败')
    }
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[var(--ui-bg-editor)]">
      {/* 头部：名称 + 版本 + 视图切换 + S2.7 三动作（复制/下载/外开） */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-quaternary)]">
        <FileCode2 size={13} className="text-info shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-primary)]" title={record.title}>
          {record.title}
        </span>
        <VersionStepper
          current={versionIndex}
          total={record.versions.length}
          onSelect={setVersionIdx}
        />
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
        <button
          className="p-1 rounded text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
          onClick={() => void handleCopy()}
          title="复制内容"
        >
          <Copy size={12} />
        </button>
        <button
          className="p-1 rounded text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
          onClick={handleDownload}
          title="下载"
        >
          <Download size={12} />
        </button>
        {renderable && (
          <button
            className="p-1 rounded text-[var(--ui-text-secondary)] hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] transition-colors shrink-0"
            onClick={() => void handleOpenExternal()}
            title="在系统浏览器打开"
          >
            <ExternalLink size={12} />
          </button>
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
          // 🔴 sandbox/composeArtifactHtml 基线统一 ArtifactHtmlFrame（单一实现）
          <ArtifactHtmlFrame
            content={content}
            title={record.title}
            className="w-full h-full border-none bg-white"
          />
        ) : effectiveMode === 'rendered' && isSvg ? (
          <div className="flex h-full items-center justify-center p-4 overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgSrc} alt={record.title} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          // 🔴 2026-08-29 对齐 Hermes ArtifactPreview SourceView：窗口化高亮源码
          //（此前裸 pre/code 无高亮；与 ArtifactPanel 同款 WindowedSourceView）
          <WindowedSourceView
            language={isSvg ? 'xml' : isHtml ? 'html' : record.language}
            text={content}
          />
        )}
      </div>
    </div>
  )
}
