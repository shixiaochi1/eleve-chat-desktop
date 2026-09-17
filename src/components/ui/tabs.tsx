/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * Tabs — 标签页（radix）。
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
import { Root as TabsRoot, List as TabsListPrimitive, Trigger as TabsTriggerPrimitive } from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '../../lib/utils'

interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsRoot> {}

function Tabs({ className, ...props }: TabsProps) {
  return <TabsRoot className={cn('flex flex-col gap-2', className)} data-slot="tabs" {...props} />
}

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsListPrimitive> {}

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <TabsListPrimitive
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className
      )}
      data-slot="tabs-list"
      {...props}
    />
  )
}

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsTriggerPrimitive> {}

function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsTriggerPrimitive
      className={cn(
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger }
