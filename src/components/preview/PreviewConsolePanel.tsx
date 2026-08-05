/**
 * PreviewConsolePanel — 全量移植 Hermes preview-console.tsx（不做简化版）
 *
 * 功能：分级着色 / source:line / 行 hover 复制 + 发送 / 发送到输入区（全选或选中）/
 *       复制全部或选中 / 清空 / 高度拖拽（pointer capture + rAF 节流）/ 自动滚底
 *
 * ELEVE 适配：
 * - 文案中文硬编码（ELEVE 无 i18n，对齐现有组件风格）
 * - 色板映射到 ELEVE CSS 变量（--ui-blue/yellow/red）
 * - Tip → title 属性（ELEVE 无 Hermes Tip 组件）
 * - 发送成功反馈 → ELEVE notifySuccess（Hermes notify 等价物）
 * - 拖拽内聚到组件内部（Hermes 由 preview-pane 传入 startConsoleResize，ELEVE 单消费方自包含）
 */

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { PanelBottom, Send, Trash2 } from 'lucide-react'
import { requestComposerInsert } from '@/lib/composer-events'
import { CopyButton } from '@/components/ui/copy-button'
import { notifySuccess } from '@/utils/notifications'
import { cn } from '@/lib/utils'
import {
  DEFAULT_CONSOLE_HEIGHT,
  isNearConsoleBottom,
  useConsoleStore,
  type ConsoleEntry,
  type PreviewConsoleState,
} from '@/store/preview-console'

const consoleLevelLabel: Record<number, string> = {
  0: 'log',
  1: 'info',
  2: 'warn',
  3: 'error',
}

const consoleLevelClass: Record<number, string> = {
  0: 'text-[var(--ui-text-primary)]',
  1: 'text-[var(--ui-blue)]',
  2: 'text-[var(--ui-yellow)]',
  3: 'text-[var(--ui-red)]',
}

const CONSOLE_HEADER_HEIGHT = 32

export function compactUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname)
    }
    return `${url.host}${url.pathname}${url.search}`
  } catch {
    return value
  }
}

export function formatLogLine(log: ConsoleEntry): string {
  const head = `[${consoleLevelLabel[log.level] || 'log'}]`
  const tail = log.source ? ` (${compactUrl(log.source)}${log.line ? `:${log.line}` : ''})` : ''
  return `${head} ${log.message}${tail}`.trim()
}

export function formatConsoleEntries(entries: ConsoleEntry[]): string {
  return entries.map(formatLogLine).join('\n')
}

export function clampConsoleHeight(value: number): number {
  return Math.max(value, CONSOLE_HEADER_HEIGHT)
}

interface ConsoleRowProps {
  copyText: string
  log: ConsoleEntry
  onSend: () => void
  onToggleSelect: () => void
  selected: boolean
}

function ConsoleRow({ copyText, log, onSend, onToggleSelect, selected }: ConsoleRowProps) {
  return (
    <div
      className={cn(
        'group/row grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-transparent px-1 py-1 transition-colors hover:bg-[var(--ui-row-hover-background)]',
        selected && 'border-[var(--ui-stroke-secondary)] bg-[var(--ui-control-active-background)]'
      )}
    >
      <button
        className={cn(
          'mt-0.5 text-left uppercase opacity-70 transition-colors hover:opacity-100',
          consoleLevelClass[log.level] ?? consoleLevelClass[0]
        )}
        onClick={onToggleSelect}
        title={selected ? '取消选择' : '选择'}
        type="button"
      >
        {consoleLevelLabel[log.level] || 'log'}
      </button>
      <div className="min-w-0" data-selectable-text="true">
        <span className={cn('block wrap-break-word', consoleLevelClass[log.level] ?? consoleLevelClass[0])}>
          {log.message}
        </span>
        {log.source && (
          <span className="block truncate text-[var(--ui-text-tertiary)]/60">
            {compactUrl(log.source)}
            {log.line ? `:${log.line}` : ''}
          </span>
        )}
      </div>
      <span className="opacity-0 transition-opacity group-hover/row:opacity-100">
        <CopyButton
          appearance="inline"
          className="rounded-md p-1 text-[var(--ui-text-tertiary)] transition-colors hover:bg-[var(--ui-row-hover-background)] hover:text-[var(--ui-text-primary)]"
          errorMessage="复制失败"
          iconClassName="size-3"
          label="复制该行"
          showLabel={false}
          text={copyText}
          title="复制该行"
        />
        <button
          className="rounded-md p-1 text-[var(--ui-text-tertiary)] transition-colors hover:bg-[var(--ui-row-hover-background)] hover:text-[var(--ui-text-primary)]"
          onClick={onSend}
          title="发送该行到输入区"
          type="button"
        >
          <Send className="size-3" />
        </button>
      </span>
    </div>
  )
}

interface PreviewConsolePanelProps {
  consoleBodyRef: RefObject<HTMLDivElement | null>
  consoleShouldStickRef: RefObject<boolean>
  consoleState: PreviewConsoleState
}

export function PreviewConsolePanel({
  consoleBodyRef,
  consoleShouldStickRef,
  consoleState,
}: PreviewConsolePanelProps) {
  const { height, logs, selectedLogIds } = useConsoleStore(consoleState)
  const visibleSelection = useMemo(
    () => logs.filter((log) => selectedLogIds.has(log.id)),
    [logs, selectedLogIds]
  )
  const sendableLogs = visibleSelection.length > 0 ? visibleSelection : logs
  const stickScrollRafRef = useRef<number | null>(null)
  const resizeRafRef = useRef<number | null>(null)

  // ── 自动滚底（对齐 Hermes：stick 状态 + rAF scrollTo）──
  useEffect(() => {
    if (!consoleShouldStickRef.current) return
    if (stickScrollRafRef.current !== null) {
      window.cancelAnimationFrame(stickScrollRafRef.current)
      stickScrollRafRef.current = null
    }
    stickScrollRafRef.current = window.requestAnimationFrame(() => {
      stickScrollRafRef.current = null
      consoleBodyRef.current?.scrollTo({ top: consoleBodyRef.current.scrollHeight })
    })
    return () => {
      if (stickScrollRafRef.current !== null) {
        window.cancelAnimationFrame(stickScrollRafRef.current)
        stickScrollRafRef.current = null
      }
    }
  }, [consoleBodyRef, height, consoleShouldStickRef, logs])

  // ── 发送到输入区（对齐 Hermes：code fence 包裹 + requestComposerInsert + 成功提示）──
  function sendLogsToComposer(entries: ConsoleEntry[]) {
    if (!entries.length) return
    const block = ['页面控制台日志：', '```', ...entries.map(formatLogLine), '```'].join('\n')
    requestComposerInsert(block)
    consoleState.clearSelection()
    notifySuccess(`已将 ${entries.length} 条日志发送到输入区`, '已发送到输入区')
  }

  // ── 高度拖拽（对齐 Hermes：pointer capture + rAF 节流；双击恢复默认高度）──
  const startConsoleResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const startY = event.clientY
    const startHeight = height
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    const move = (ev: PointerEvent) => {
      ev.preventDefault()
      const delta = ev.clientY - startY
      // 向上拖 = 面板变高（顶部把手，delta 取反）
      const next = clampConsoleHeight(startHeight - delta)
      // rAF 节流：拖拽帧率内至多更新一次（对齐 Hermes rafCoalesce 语义）
      if (resizeRafRef.current !== null) return
      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null
        consoleState.setHeight(next)
      })
    }

    const cleanup = () => {
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      handle.releasePointerCapture?.(event.pointerId)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', cleanup, true)
      window.removeEventListener('pointercancel', cleanup, true)
      window.removeEventListener('blur', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
    }

    handle.setPointerCapture?.(event.pointerId)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', cleanup, true)
    window.addEventListener('pointercancel', cleanup, true)
    window.addEventListener('blur', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
  }

  return (
    <div
      className="flex flex-col shrink-0 overflow-hidden border-t border-[var(--ui-stroke-secondary)] bg-[var(--ui-bg-editor)]"
      style={{ height: `${height}px` }}
    >
      {/* 拖拽把手（双击恢复默认高度） */}
      <div
        aria-label="拖动调整高度"
        className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        onDoubleClick={() => consoleState.setHeight(DEFAULT_CONSOLE_HEIGHT)}
        onPointerDown={startConsoleResize}
        role="separator"
      >
        <span className="absolute left-1/2 top-1/2 h-0.5 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ui-text-tertiary)]/80 opacity-0 transition-opacity duration-100 group-hover:opacity-50" />
      </div>

      {/* 头部 */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--ui-stroke-secondary)]/50 px-2">
        <div className="flex items-center gap-2 text-[0.6875rem] font-medium text-[var(--ui-text-tertiary)]">
          <PanelBottom className="size-3.5" />
          页面控制台
          {selectedLogIds.size > 0 && (
            <span className="rounded-full bg-[var(--ui-bg-tertiary)] px-1.5 py-px text-[0.5625rem] text-[var(--ui-text-tertiary)]">
              已选 {selectedLogIds.size} 条
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] text-[var(--ui-text-secondary)] transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] disabled:opacity-40"
            disabled={sendableLogs.length === 0}
            onClick={() => sendLogsToComposer(sendableLogs)}
            type="button"
          >
            <Send className="size-3.5" />
            发送到输入区
          </button>
          <CopyButton
            appearance="inline"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] text-[var(--ui-text-secondary)] transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] disabled:opacity-40"
            disabled={sendableLogs.length === 0}
            errorMessage="复制失败"
            iconClassName="size-3.5"
            label={visibleSelection.length > 0 ? '复制选中' : '复制全部'}
            showLabel={true}
            text={() => formatConsoleEntries(sendableLogs)}
          >
            复制
          </CopyButton>
          <button
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] text-[var(--ui-text-secondary)] transition-colors hover:bg-[var(--ui-control-hover-background)] hover:text-[var(--ui-text-primary)] disabled:opacity-40"
            disabled={logs.length === 0}
            onClick={consoleState.clear}
            type="button"
          >
            <Trash2 className="size-3.5" />
            清空
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5 font-mono text-[0.6875rem] leading-relaxed"
        ref={consoleBodyRef}
      >
        {logs.length > 0 ? (
          logs.map((log) => {
            const selected = selectedLogIds.has(log.id)
            return (
              <ConsoleRow
                copyText={formatLogLine(log)}
                key={log.id}
                log={log}
                onSend={() => sendLogsToComposer([log])}
                onToggleSelect={() => consoleState.toggleSelection(log.id)}
                selected={selected}
              />
            )
          })
        ) : (
          <div className="py-2 text-[var(--ui-text-quaternary)]/70">暂无页面日志</div>
        )}
      </div>
    </div>
  )
}
