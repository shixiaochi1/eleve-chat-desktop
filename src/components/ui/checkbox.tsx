/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * Checkbox — 复选框（radix）。
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
import { Root as CheckboxRoot, Indicator as CheckboxIndicator } from '@radix-ui/react-checkbox'
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface CheckboxProps extends React.ComponentPropsWithoutRef<typeof CheckboxRoot> {}

function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxRoot
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-input shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxIndicator
        className="flex items-center justify-center text-current"
        data-slot="checkbox-indicator"
      >
        <Codicon name="check" size="0.875rem" />
      </CheckboxIndicator>
    </CheckboxRoot>
  )
}

export { Checkbox }
