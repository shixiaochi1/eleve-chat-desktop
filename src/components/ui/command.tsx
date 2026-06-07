import { Command as CommandPrimitive } from 'cmdk'
import * as React from 'react'

import { SearchIcon } from '../../lib/icons'
import { cn } from '../../lib/utils'

interface CommandProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive> {}

function Command({ className, ...props }: CommandProps) {
  return (
    <CommandPrimitive
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        className
      )}
      data-slot="command"
      {...props}
    />
  )
}

interface CommandInputProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {}

function CommandInput({ className, ...props }: CommandInputProps) {
  return (
    <div className="flex h-11 items-center gap-2 border-b border-border px-3" data-slot="command-input-wrapper">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        data-slot="command-input"
        {...props}
      />
    </div>
  )
}

interface CommandListProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.List> {}

function CommandList({ className, ...props }: CommandListProps) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-100 overflow-y-auto overflow-x-hidden', className)}
      data-slot="command-list"
      {...props}
    />
  )
}

interface CommandEmptyProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty> {}

function CommandEmpty({ ...props }: CommandEmptyProps) {
  return (
    <CommandPrimitive.Empty
      className="py-6 text-center text-sm text-muted-foreground"
      data-slot="command-empty"
      {...props}
    />
  )
}

interface CommandGroupProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group> {}

function CommandGroup({ className, ...props }: CommandGroupProps) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:sticky **:[[cmdk-group-heading]]:top-0 **:[[cmdk-group-heading]]:z-10 **:[[cmdk-group-heading]]:bg-popover **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground',
        className
      )}
      data-slot="command-group"
      {...props}
    />
  )
}

interface CommandSeparatorProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator> {}

function CommandSeparator({ className, ...props }: CommandSeparatorProps) {
  return (
    <CommandPrimitive.Separator
      className={cn('-mx-1 h-px bg-border', className)}
      data-slot="command-separator"
      {...props}
    />
  )
}

interface CommandItemProps extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item> {}

function CommandItem({ className, ...props }: CommandItemProps) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50',
        className
      )}
      data-slot="command-item"
      {...props}
    />
  )
}

interface CommandShortcutProps extends React.ComponentPropsWithoutRef<'span'> {}

function CommandShortcut({ className, ...props }: CommandShortcutProps) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      data-slot="command-shortcut"
      {...props}
    />
  )
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
}
