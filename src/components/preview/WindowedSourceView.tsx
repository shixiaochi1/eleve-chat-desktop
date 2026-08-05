/**
 * WindowedSourceView — 窗口化源码视图（对齐 Hermes preview-file.tsx SourceView）
 *
 * 单滚动容器 + grid 两列（行号 gutter + 高亮内容），chunk 分块 + 可视窗口
 * 渲染（200 行/chunk，overscan 400 行）——大文件不产生全量 DOM，行号与内容
 * 天然同步滚动（同一个滚动容器，根治旧实现 gutter/内容双滚动容器失联）。
 *
 * 行选择（仅 filePath 存在时）：单击选行 / Shift 扩展 / 再点取消；拖拽或
 * Ctrl/⌘+L → @file:"绝对路径:start[-end]" 引用插入输入框（对齐 ELEVE 既有
 * LINE_REF_MIME 协议；Hermes 同语义但走 HERMES_PATHS_MIME + cwd 相对化）。
 * artifact 内容无路径可引用 → filePath 不传，行号不可交互（Hermes 同款）。
 *
 * 内容高亮：逐 chunk renderMarkdown 围栏包裹（rehype-highlight，输出已过
 * DOMPurify sanitize）——窗口内只高亮可见 chunk，高亮成本与视图同步。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, UIEvent } from 'react'
import { renderMarkdown } from '@/utils/markdown'
import { cn } from '@/lib/utils'
import { requestComposerInsert, fileLineRef, LINE_REF_MIME } from '@/lib/composer-events'

const SOURCE_CHUNK_LINES = 200
const SOURCE_LINE_PX = 20
const SOURCE_OVERSCAN_LINES = 400

export interface LineSelection {
  end: number
  start: number
}

interface TextLineChunk {
  lines: string[]
  start: number
  text: string
}

function chunkTextLines(text: string, perChunk: number): TextLineChunk[] {
  const lines = text.split('\n')
  if (lines.length <= perChunk) {
    return [{ lines, start: 0, text }]
  }
  const chunks: TextLineChunk[] = []
  for (let start = 0; start < lines.length; start += perChunk) {
    const slice = lines.slice(start, start + perChunk)
    chunks.push({ lines: slice, start, text: slice.join('\n') })
  }
  return chunks
}

interface ChunkWindow {
  afterRows: number
  beforeRows: number
  endChunk: number
  startChunk: number
}

/** 可视 chunk 窗口（对齐 Hermes useFixedRowWindow：rAF 节流 + 边界不变不重渲染） */
function useFixedRowWindow(totalRows: number) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const compute = useCallback(
    (node: HTMLDivElement | null): ChunkWindow => {
      const height = node?.clientHeight || 800
      const scrollTop = node?.scrollTop ?? 0
      const firstRow = Math.max(0, Math.floor(scrollTop / SOURCE_LINE_PX) - SOURCE_OVERSCAN_LINES)
      const lastRow = Math.min(totalRows, Math.ceil((scrollTop + height) / SOURCE_LINE_PX) + SOURCE_OVERSCAN_LINES)
      const startChunk = Math.floor(firstRow / SOURCE_CHUNK_LINES)
      const endChunk = Math.max(startChunk, Math.floor(Math.max(firstRow, lastRow - 1) / SOURCE_CHUNK_LINES))
      return {
        afterRows: Math.max(0, totalRows - Math.min(totalRows, (endChunk + 1) * SOURCE_CHUNK_LINES)),
        beforeRows: Math.min(totalRows, startChunk * SOURCE_CHUNK_LINES),
        endChunk,
        startChunk,
      }
    },
    [totalRows],
  )

  const [win, setWin] = useState<ChunkWindow>(() => compute(null))

  const sync = useCallback(
    (node: HTMLDivElement | null = scrollerRef.current) => {
      if (!node) return
      const next = compute(node)
      setWin((prev) =>
        prev.startChunk === next.startChunk &&
        prev.endChunk === next.endChunk &&
        prev.beforeRows === next.beforeRows &&
        prev.afterRows === next.afterRows
          ? prev
          : next,
      )
    },
    [compute],
  )

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const node = event.currentTarget
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        sync(node)
      })
    },
    [sync],
  )

  // 挂载/内容变化后重算一次（对齐 Hermes useLayoutEffect re-sync）
  useEffect(() => {
    sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalRows])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { ...win, onScroll, scrollerRef }
}

/** 扩展名 → hljs 语言名（rehype-highlight；svg 无语法映射到 xml，其余直接用扩展名） */
function languageForExtension(ext: string): string {
  const clean = ext.replace(/\./, '').toLowerCase()
  if (clean === 'svg') return 'xml'
  return clean
}

/** 纯文本降级：内容含围栏时不用 markdown 管线（外层包裹会提前闭合围栏，
 *  Hermes Shiki 直高亮无此问题——ELEVE 用围栏包裹高亮需自检） */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderChunk(chunkText: string, lang: string): string {
  const hasFence = chunkText.split('\n').some((l) => l.trim().startsWith('```'))
  if (hasFence) {
    return `<pre class="whitespace-pre-wrap break-all text-[var(--ui-text-primary)]">${escapeHtml(chunkText)}</pre>`
  }
  const fence = lang && lang !== 'text' ? `\`\`\`${lang}\n${chunkText}\n\`\`\`` : `\`\`\`\n${chunkText}\n\`\`\``
  return renderMarkdown(fence, { highlight: true })
}

interface WindowedSourceViewProps {
  /** 文件路径：存在时行号可交互（选择/拖拽/⌘L 引用）；artifact 内容传 undefined */
  filePath?: string
  /** hljs 语言名（或扩展名，内部归一化）；缺省 → 自动检测 */
  language?: string
  text: string
}

export default function WindowedSourceView({ filePath, language, text }: WindowedSourceViewProps) {
  const chunks = useMemo(() => chunkTextLines(text, SOURCE_CHUNK_LINES), [text])
  const lastChunk = chunks.at(-1)
  const totalLines = lastChunk ? lastChunk.start + lastChunk.lines.length : 0
  const { afterRows, beforeRows, endChunk, onScroll, scrollerRef, startChunk } = useFixedRowWindow(totalLines)
  const visibleChunks = chunks.slice(startChunk, endChunk + 1)
  const [selection, setSelection] = useState<LineSelection | null>(null)

  const lang = languageForExtension(language || '')
  const highlight = useCallback((chunkText: string) => renderChunk(chunkText, lang), [lang])

  const inSelection = (line: number) => selection !== null && line >= selection.start && line <= selection.end

  const handleLineClick = (event: ReactMouseEvent, line: number) => {
    if (!filePath) return
    if (event.shiftKey && selection) {
      setSelection({ end: Math.max(selection.end, line), start: Math.min(selection.start, line) })
      return
    }
    if (selection && selection.start === line && selection.end === line) {
      setSelection(null)
      return
    }
    setSelection({ end: line, start: line })
  }

  const handleDragStart = (event: ReactDragEvent, line: number) => {
    if (!filePath) return
    const sel = inSelection(line) && selection ? selection : { end: line, start: line }
    event.dataTransfer.setData(
      LINE_REF_MIME,
      JSON.stringify({ path: filePath, start: sel.start, end: sel.end }),
    )
    event.dataTransfer.setData(
      'text/plain',
      sel.end > sel.start ? `${filePath}:${sel.start}-${sel.end}` : `${filePath}:${sel.start}`,
    )
    event.dataTransfer.effectAllowed = 'copy'
  }

  // Ctrl/⌘+L：选中行 → 插入 @file:"path:start[-end]" 引用（capture 优先于其它全局快捷键）
  useEffect(() => {
    if (!selection || !filePath) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'l') return
      e.preventDefault()
      e.stopPropagation()
      requestComposerInsert(fileLineRef(filePath, selection.start, selection.end))
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [selection, filePath])

  return (
    <div className="h-full overflow-auto" onScroll={onScroll} ref={scrollerRef}>
      <div className="grid min-w-max grid-cols-[auto_minmax(0,1fr)] font-mono text-xs leading-5">
        {beforeRows > 0 && <div aria-hidden className="col-span-2" style={{ height: beforeRows * SOURCE_LINE_PX }} />}
        {visibleChunks.map((chunk) => (
          <Fragment key={chunk.start}>
            <div className="select-none text-right text-[var(--ui-text-tertiary)]">
              {chunk.lines.map((_lineText, offset) => {
                const line = chunk.start + offset + 1
                const selected = inSelection(line)
                return (
                  <div
                    className={cn(
                      'h-5 w-9 pr-2 leading-5 tabular-nums transition-colors',
                      filePath && 'cursor-pointer',
                      selected
                        ? 'bg-[var(--ui-yellow)]/25 text-[var(--ui-text-primary)]'
                        : filePath && 'hover:text-[var(--ui-text-primary)]',
                    )}
                    draggable={Boolean(filePath)}
                    key={line}
                    onClick={(e) => handleLineClick(e, line)}
                    onDragStart={(e) => handleDragStart(e, line)}
                    title={filePath ? '单击选行 / Shift+单击扩展 / 拖拽或 Ctrl+L 引用到输入框' : undefined}
                  >
                    {line}
                  </div>
                )
              })}
            </div>
            <div
              className="min-w-0 [&_pre]:m-0 [&_pre]:leading-5 [&_pre]:px-3 [&_pre]:py-0 [&_pre]:bg-transparent [&_pre]:text-[var(--ui-text-primary)]"
              // renderMarkdown 输出已过 DOMPurify sanitize（对齐消息区安全边界）
              dangerouslySetInnerHTML={{ __html: highlight(chunk.text) }}
            />
          </Fragment>
        ))}
        {afterRows > 0 && <div aria-hidden className="col-span-2" style={{ height: afterRows * SOURCE_LINE_PX }} />}
      </div>
    </div>
  )
}
