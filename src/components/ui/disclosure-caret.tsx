/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * DisclosureCaret — 折叠指示符。
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
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface DisclosureCaretProps extends Omit<React.ComponentPropsWithoutRef<typeof Codicon>, 'name'> {
  open?: boolean
  size?: string
}

// Chrome caret for collapsible sections: points right when closed (▶),
// rotates to point down (▼) when open. Override `className` to layer
// hover/opacity styling; twMerge resolves transition conflicts.
export function DisclosureCaret({ className, open, size = '0.75rem', ...props }: DisclosureCaretProps) {
  return (
    <Codicon
      className={cn('transition-transform duration-150', open && 'rotate-90', className)}
      name="chevron-right"
      size={size}
      {...props}
    />
  )
}
