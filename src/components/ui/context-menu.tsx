import {
  Root as CtxMenuRoot,
  Portal as CtxMenuPortal,
  Trigger as CtxMenuTrigger,
  Group as CtxMenuGroup,
  Content as CtxMenuContent,
  Item as CtxMenuItem,
  Label as CtxMenuLabel,
  Separator as CtxMenuSeparator,
  Sub as CtxMenuSub,
  SubTrigger as CtxMenuSubTrigger,
  SubContent as CtxMenuSubContent
} from '@radix-ui/react-context-menu'
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface ContextMenuProps extends React.ComponentPropsWithoutRef<typeof CtxMenuRoot> {}

function ContextMenu({ ...props }: ContextMenuProps) {
  return <CtxMenuRoot data-slot="context-menu" {...props} />
}

interface ContextMenuPortalProps extends React.ComponentPropsWithoutRef<typeof CtxMenuPortal> {}

function ContextMenuPortal({ ...props }: ContextMenuPortalProps) {
  return <CtxMenuPortal data-slot="context-menu-portal" {...props} />
}

interface ContextMenuTriggerProps extends React.ComponentPropsWithoutRef<typeof CtxMenuTrigger> {}

function ContextMenuTrigger({ ...props }: ContextMenuTriggerProps) {
  return <CtxMenuTrigger data-slot="context-menu-trigger" {...props} />
}

interface ContextMenuGroupProps extends React.ComponentPropsWithoutRef<typeof CtxMenuGroup> {}

function ContextMenuGroup({ ...props }: ContextMenuGroupProps) {
  return <CtxMenuGroup data-slot="context-menu-group" {...props} />
}

interface ContextMenuContentProps extends React.ComponentPropsWithoutRef<typeof CtxMenuContent> {}

function ContextMenuContent({ className, ...props }: ContextMenuContentProps) {
  return (
    <CtxMenuPortal>
      <CtxMenuContent
        className={cn(
          'z-50 max-h-(--radix-context-menu-content-available-height) min-w-36 origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-(--ui-stroke-secondary) bg-[color-mix(in_srgb,var(--ui-bg-elevated)_96%,transparent)] p-1 text-[length:var(--conversation-text-font-size)] text-popover-foreground shadow-md backdrop-blur-md data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className
        )}
        data-slot="context-menu-content"
        {...props}
      />
    </CtxMenuPortal>
  )
}

interface ContextMenuItemProps extends React.ComponentPropsWithoutRef<typeof CtxMenuItem> {
  inset?: boolean
  variant?: 'default' | 'destructive'
}

function ContextMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ContextMenuItemProps) {
  return (
    <CtxMenuItem
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden select-none focus:bg-(--ui-control-active-background) focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-(--ui-text-tertiary) data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      data-inset={inset}
      data-slot="context-menu-item"
      data-variant={variant}
      {...props}
    />
  )
}

interface ContextMenuLabelProps extends React.ComponentPropsWithoutRef<typeof CtxMenuLabel> {
  inset?: boolean
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: ContextMenuLabelProps) {
  return (
    <CtxMenuLabel
      className={cn('px-2 py-1 text-xs font-medium text-(--ui-text-tertiary) data-[inset]:pl-7', className)}
      data-inset={inset}
      data-slot="context-menu-label"
      {...props}
    />
  )
}

interface ContextMenuSeparatorProps extends React.ComponentPropsWithoutRef<typeof CtxMenuSeparator> {}

function ContextMenuSeparator({ className, ...props }: ContextMenuSeparatorProps) {
  return (
    <CtxMenuSeparator
      className={cn('-mx-1 my-1 h-px bg-(--ui-stroke-tertiary)', className)}
      data-slot="context-menu-separator"
      {...props}
    />
  )
}

interface ContextMenuSubProps extends React.ComponentPropsWithoutRef<typeof CtxMenuSub> {}

function ContextMenuSub({ ...props }: ContextMenuSubProps) {
  return <CtxMenuSub data-slot="context-menu-sub" {...props} />
}

interface ContextMenuSubTriggerProps extends React.ComponentPropsWithoutRef<typeof CtxMenuSubTrigger> {
  inset?: boolean
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ContextMenuSubTriggerProps) {
  return (
    <CtxMenuSubTrigger
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden select-none focus:bg-(--ui-control-active-background) focus:text-foreground data-[inset]:pl-7 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-(--ui-text-tertiary)",
        className
      )}
      data-inset={inset}
      data-slot="context-menu-sub-trigger"
      {...props}
    >
      {children}
      <Codicon className="ml-auto text-(--ui-text-tertiary)" name="chevron-right" size="1rem" />
    </CtxMenuSubTrigger>
  )
}

interface ContextMenuSubContentProps extends React.ComponentPropsWithoutRef<typeof CtxMenuSubContent> {}

function ContextMenuSubContent({ className, ...props }: ContextMenuSubContentProps) {
  return (
    <CtxMenuSubContent
      className={cn(
        'z-50 min-w-36 origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-[color-mix(in_srgb,var(--ui-bg-elevated)_96%,transparent)] p-1 text-[length:var(--conversation-text-font-size)] text-popover-foreground shadow-md backdrop-blur-md data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className
      )}
      data-slot="context-menu-sub-content"
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
}
