import {
  Root as SelectRootPrimitive,
  Trigger as SelectTriggerPrimitive,
  Value as SelectValuePrimitive,
  Icon as SelectIconPrimitive,
  Portal as SelectPortalPrimitive,
  Content as SelectContentPrimitive,
  Viewport as SelectViewportPrimitive,
  Item as SelectItemPrimitive,
  ItemText as SelectItemTextPrimitive,
  ItemIndicator as SelectItemIndicatorPrimitive,
} from '@radix-ui/react-select'
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface SelectProps extends React.ComponentPropsWithoutRef<typeof SelectRootPrimitive> {}

function Select({ ...props }: SelectProps) {
  return <SelectRootPrimitive data-slot="select" {...props} />
}

interface SelectTriggerProps extends React.ComponentPropsWithoutRef<typeof SelectTriggerPrimitive> {}

function SelectTrigger({ className, children, ...props }: SelectTriggerProps) {
  return (
    <SelectTriggerPrimitive
      className={cn(
        'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectIconPrimitive asChild>
        <Codicon className="opacity-60" name="chevron-down" size="1rem" />
      </SelectIconPrimitive>
    </SelectTriggerPrimitive>
  )
}

interface SelectValueProps extends React.ComponentPropsWithoutRef<typeof SelectValuePrimitive> {}

function SelectValue({ ...props }: SelectValueProps) {
  return <SelectValuePrimitive data-slot="select-value" {...props} />
}

interface SelectContentProps extends React.ComponentPropsWithoutRef<typeof SelectContentPrimitive> {
  position?: 'popper' | 'item-aligned'
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: SelectContentProps) {
  return (
    <SelectPortalPrimitive>
      <SelectContentPrimitive
        className={cn(
          'relative z-[140] max-h-72 min-w-32 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=top]:slide-in-from-bottom-2 data-[side=right]:slide-in-from-left-2',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className
        )}
        data-slot="select-content"
        position={position}
        {...props}
      >
        <SelectViewportPrimitive
          className={cn(
            'p-1',
            position === 'popper' && 'h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)'
          )}
        >
          {children}
        </SelectViewportPrimitive>
      </SelectContentPrimitive>
    </SelectPortalPrimitive>
  )
}

interface SelectItemProps extends React.ComponentPropsWithoutRef<typeof SelectItemPrimitive> {}

function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <SelectItemPrimitive
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className
      )}
      data-slot="select-item"
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectItemIndicatorPrimitive>
          <Codicon name="check" size="1rem" />
        </SelectItemIndicatorPrimitive>
      </span>
      <SelectItemTextPrimitive>{children}</SelectItemTextPrimitive>
    </SelectItemPrimitive>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
