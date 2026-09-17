/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * Separator — 分隔线（radix）。
 *
 * 保留理由：作为设计系统基础保留（shadcn/radix 风格，无副作用）。
 * 确认不再需要时可连同其依赖一起删。
 *
 * 最后核实：2026-09-17（从 src/main.tsx 出发的 BFS 可达性分析；
 *          复核方式：node scripts/deadcode-check.mjs）
 * 性质：设计系统预留组件（从未被接入，非「曾用后废」）
 * 消费者：仅 ui/sidebar.tsx（自身不可达）
 * 继承者：无
 *
 * ⚠️ 请勿在此处修补 bug 或新增功能 —— 本文件无消费者，改动对运行时零影响
 *    （历史上已多次出现「给孤儿打补丁」）。要复活请先接回入口；确认废弃则
 *    连同其下游一起删，勿只删链头。
 */
import { Root as SeparatorRoot } from '@radix-ui/react-separator'
import * as React from 'react'

import { cn } from '../../lib/utils'

interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof SeparatorRoot> {
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
}

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorRoot
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className
      )}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  )
}

export { Separator }
