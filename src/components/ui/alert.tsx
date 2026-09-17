/**
 * 🔴 @deprecated 未挂载（unreachable）
 *
 * Alert — 提示横幅（cva 变体）。
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
import { type VariantProps, cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '../../lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow-xs [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-[var(--ui-stroke-tertiary)]',
        destructive:
          'border-destructive/35 bg-[color-mix(in_srgb,var(--dt-card)_96%,var(--dt-destructive)_4%)] [&>svg]:text-destructive',
        warning:
          'border-primary/30 bg-[color-mix(in_srgb,var(--dt-card)_96%,var(--dt-primary)_4%)] [&>svg]:text-primary',
        success:
          'border-primary/25 bg-[color-mix(in_srgb,var(--dt-card)_97%,var(--dt-primary)_3%)] [&>svg]:text-primary'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

interface AlertProps extends React.ComponentPropsWithoutRef<'div'>, VariantProps<typeof alertVariants> {}

function Alert({ className, variant, ...props }: AlertProps) {
  return <div className={cn(alertVariants({ variant }), className)} data-slot="alert" role="alert" {...props} />
}

interface AlertTitleProps extends React.ComponentPropsWithoutRef<'div'> {}

function AlertTitle({ className, ...props }: AlertTitleProps) {
  return (
    <div
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight text-foreground', className)}
      data-slot="alert-title"
      {...props}
    />
  )
}

interface AlertDescriptionProps extends React.ComponentPropsWithoutRef<'div'> {}

function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  return (
    <div
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-muted-foreground [&_p]:leading-relaxed',
        className
      )}
      data-slot="alert-description"
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
