/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * ScrollArea — 滚动区域（radix）。
 *
 * 保留理由：作为设计系统基础保留（shadcn/radix 风格，无副作用）。
 * 确认不再需要时可连同其依赖一起删。
 *
 * 最后核实：2026-09-17（从 src/main.tsx 出发的 BFS 可达性分析；
 *          复核方式：node scripts/deadcode-check.mjs）
 * 性质：设计系统预留组件（从未被接入，非「曾用后废」）
 * 消费者：无（全仓零 import）
 * 继承者：无
 *
 * ⚠️ 请勿在此处修补 bug 或新增功能 —— 本文件无消费者，改动对运行时零影响
 *    （历史上已多次出现「给孤儿打补丁」）。要复活请先接回入口；确认废弃则
 *    连同其下游一起删，勿只删链头。
 */
import {
  Root as ScrollAreaRoot,
  Viewport as ScrollAreaViewport,
  Corner as ScrollAreaCorner,
  Scrollbar as ScrollAreaScrollbar,
  Thumb as ScrollAreaThumb,
} from '@radix-ui/react-scroll-area'
import * as React from 'react'

import { cn } from '../../lib/utils'

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaRoot> {}

function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <ScrollAreaRoot className={cn('relative overflow-hidden', className)} data-slot="scroll-area" {...props}>
      <ScrollAreaViewport className="size-full outline-none" data-slot="scroll-area-viewport">
        {children}
      </ScrollAreaViewport>
      <ScrollBar />
      <ScrollAreaCorner />
    </ScrollAreaRoot>
  )
}

interface ScrollBarProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaScrollbar> {}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollBarProps) {
  return (
    <ScrollAreaScrollbar
      className={cn(
        'flex touch-none select-none p-px transition-colors',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaThumb
        className="relative flex-1 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/45"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
