import {
  Root as DDMenuRoot,
  Portal as DDMenuPortal,
  Trigger as DDMenuTrigger,
  Content as DDMenuContent,
  Group as DDMenuGroup,
  Item as DDMenuItem,
  CheckboxItem as DDMenuCheckboxItem,
  ItemIndicator as DDMenuItemIndicator,
  RadioGroup as DDMenuRadioGroup,
  RadioItem as DDMenuRadioItem,
  Label as DDMenuLabel,
  Separator as DDMenuSeparator,
  Sub as DDMenuSub,
  SubTrigger as DDMenuSubTrigger,
  SubContent as DDMenuSubContent
} from '@radix-ui/react-dropdown-menu'
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

// Shared class tokens for edge-to-edge menus (use with `p-0` content): rows go
// full-width, square, and compact so the highlight spans the whole surface.
// Reuse these instead of re-deriving per menu so every searchable/compact menu
// reads identically.
export const dropdownMenuRow = 'gap-2 rounded-none px-2.5 py-1 text-xs'
export const dropdownMenuSectionLabel = 'px-2.5 pt-1 pb-0.5 text-[0.625rem] font-medium uppercase tracking-wide'

// Keys that must reach Radix's menu handler (navigation/close). Everything else
// is a filter keystroke and is stopped so the menu's typeahead doesn't hijack it.
const DROPDOWN_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'])

interface DropdownMenuProps extends React.ComponentPropsWithoutRef<typeof DDMenuRoot> {}

function DropdownMenu({ ...props }: DropdownMenuProps) {
  return <DDMenuRoot data-slot="dropdown-menu" {...props} />
}

interface DropdownMenuPortalProps extends React.ComponentPropsWithoutRef<typeof DDMenuPortal> {}

function DropdownMenuPortal({ ...props }: DropdownMenuPortalProps) {
  return <DDMenuPortal data-slot="dropdown-menu-portal" {...props} />
}

interface DropdownMenuTriggerProps extends React.ComponentPropsWithoutRef<typeof DDMenuTrigger> {}

function DropdownMenuTrigger({ ...props }: DropdownMenuTriggerProps) {
  return <DDMenuTrigger data-slot="dropdown-menu-trigger" {...props} />
}

interface DropdownMenuSearchProps extends React.ComponentPropsWithoutRef<'input'> {
  onValueChange?: (value: string) => void
}

/**
 * Borderless filter input for a searchable dropdown. Autofocuses, keeps the
 * menu's typeahead from eating keystrokes, and still lets arrow/enter/escape
 * drive the list. Drop it in as the first child of a `DropdownMenuContent`.
 */
function DropdownMenuSearch({
  className,
  onChange,
  onKeyDown,
  onValueChange,
  ...props
}: DropdownMenuSearchProps) {
  return (
    <div className="px-2.5 py-1.5" data-slot="dropdown-menu-search">
      <input
        autoFocus
        className={cn(
          'h-4 w-full bg-transparent text-xs leading-none text-foreground placeholder:text-(--ui-text-tertiary) focus:outline-none',
          className
        )}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (!DROPDOWN_NAV_KEYS.has(event.key)) {
            event.stopPropagation()
          }

          onKeyDown?.(event)
        }}
        type="text"
        {...props}
      />
    </div>
  )
}

interface DropdownMenuContentProps extends React.ComponentPropsWithoutRef<typeof DDMenuContent> {
  collisionPadding?: number
  sideOffset?: number
}

function DropdownMenuContent({
  className,
  collisionPadding = 8,
  sideOffset = 4,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DDMenuPortal>
      <DDMenuContent
        // `dt-portal-scrollbar` reproduces the thin themed scrollbar from
        // `.scrollbar-dt` for portaled overlays (Radix renders this under
        // document.body, outside #root's scope). See styles.css.
        className={cn(
          'dt-portal-scrollbar z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-36 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-(--ui-stroke-secondary) bg-[color-mix(in_srgb,var(--ui-bg-elevated)_96%,transparent)] p-1 text-[length:var(--conversation-text-font-size)] text-popover-foreground shadow-md backdrop-blur-md data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className
        )}
        // Keep the menu inside the viewport: Radix flips/shifts away from edges
        // (avoidCollisions defaults on); the padding stops it kissing the edge.
        collisionPadding={collisionPadding}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        {...props}
      />
    </DDMenuPortal>
  )
}

interface DropdownMenuGroupProps extends React.ComponentPropsWithoutRef<typeof DDMenuGroup> {}

function DropdownMenuGroup({ ...props }: DropdownMenuGroupProps) {
  return <DDMenuGroup data-slot="dropdown-menu-group" {...props} />
}

interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<typeof DDMenuItem> {
  inset?: boolean
  variant?: 'default' | 'destructive'
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <DDMenuItem
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden select-none focus:bg-(--ui-control-active-background) focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-(--ui-text-tertiary) data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      data-inset={inset}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      {...props}
    />
  )
}

interface DropdownMenuCheckboxItemProps extends React.ComponentPropsWithoutRef<typeof DDMenuCheckboxItem> {
  checked?: boolean
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <DDMenuCheckboxItem
      checked={checked}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden select-none focus:bg-(--ui-control-active-background) focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      data-slot="dropdown-menu-checkbox-item"
      {...props}
    >
      {children}
      <DDMenuItemIndicator className="ml-auto flex items-center pl-2 text-foreground">
        <Codicon name="check" size="0.75rem" />
      </DDMenuItemIndicator>
    </DDMenuCheckboxItem>
  )
}

interface DropdownMenuRadioGroupProps extends React.ComponentPropsWithoutRef<typeof DDMenuRadioGroup> {}

function DropdownMenuRadioGroup({ ...props }: DropdownMenuRadioGroupProps) {
  return <DDMenuRadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

interface DropdownMenuRadioItemProps extends React.ComponentPropsWithoutRef<typeof DDMenuRadioItem> {}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <DDMenuRadioItem
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden select-none focus:bg-(--ui-control-active-background) focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      data-slot="dropdown-menu-radio-item"
      {...props}
    >
      {children}
      <DDMenuItemIndicator className="ml-auto flex items-center pl-2 text-foreground">
        <Codicon name="check" size="0.75rem" />
      </DDMenuItemIndicator>
    </DDMenuRadioItem>
  )
}

interface DropdownMenuLabelProps extends React.ComponentPropsWithoutRef<typeof DDMenuLabel> {
  inset?: boolean
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: DropdownMenuLabelProps) {
  return (
    <DDMenuLabel
      className={cn('px-2 py-1 text-xs font-medium text-(--ui-text-tertiary) data-[inset]:pl-7', className)}
      data-inset={inset}
      data-slot="dropdown-menu-label"
      {...props}
    />
  )
}

interface DropdownMenuSeparatorProps extends React.ComponentPropsWithoutRef<typeof DDMenuSeparator> {}

function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return (
    <DDMenuSeparator
      className={cn('-mx-1 my-1 h-px bg-(--ui-stroke-tertiary)', className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  )
}

interface DropdownMenuShortcutProps extends React.ComponentPropsWithoutRef<'span'> {}

function DropdownMenuShortcut({ className, ...props }: DropdownMenuShortcutProps) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      data-slot="dropdown-menu-shortcut"
      {...props}
    />
  )
}

interface DropdownMenuSubProps extends React.ComponentPropsWithoutRef<typeof DDMenuSub> {}

function DropdownMenuSub({ ...props }: DropdownMenuSubProps) {
  return <DDMenuSub data-slot="dropdown-menu-sub" {...props} />
}

interface DropdownMenuSubTriggerProps extends React.ComponentPropsWithoutRef<typeof DDMenuSubTrigger> {
  inset?: boolean
  hideChevron?: boolean
}

function DropdownMenuSubTrigger({
  className,
  inset,
  hideChevron = false,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <DDMenuSubTrigger
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden select-none focus:bg-(--ui-control-active-background) focus:text-foreground data-[inset]:pl-7 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-(--ui-text-tertiary)",
        className
      )}
      data-inset={inset}
      data-slot="dropdown-menu-sub-trigger"
      {...props}
    >
      {children}
      {!hideChevron && <Codicon className="ml-auto text-(--ui-text-tertiary)" name="chevron-right" size="1rem" />}
    </DDMenuSubTrigger>
  )
}

interface DropdownMenuSubContentProps extends React.ComponentPropsWithoutRef<typeof DDMenuSubContent> {
  collisionPadding?: number
}

function DropdownMenuSubContent({
  className,
  collisionPadding = 8,
  ...props
}: DropdownMenuSubContentProps) {
  return (
    // Portal the submenu out of the parent Content so it escapes that Content's
    // `overflow` clip. Without this, a submenu opening from a scrollable menu
    // gets visually cut off at the parent's edges. Radix Popper still anchors
    // it to the SubTrigger and handles collision/flip, so portaling is safe.
    <DDMenuPortal>
      <DDMenuSubContent
        // `dt-portal-scrollbar` reproduces the themed scrollbar for portaled
        // overlays (rendered under document.body). Use a fixed `max-h-80`
        // rather than the Radix available-height variable: that variable is
        // only published on Content, NOT SubContent — using it here collapses
        // the submenu to 0px height.
        className={cn(
          'dt-portal-scrollbar z-50 max-h-80 min-w-36 origin-(--radix-dropdown-menu-content-transform-origin) overflow-y-auto rounded-lg border border-(--ui-stroke-secondary) bg-[color-mix(in_srgb,var(--ui-bg-elevated)_96%,transparent)] p-1 text-[length:var(--conversation-text-font-size)] text-popover-foreground shadow-md backdrop-blur-md data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className
        )}
        // Flip to the other side / shift vertically when near a viewport edge
        // (e.g. the status bar menu opening from the bottom-right corner) so
        // the submenu never gets clipped.
        collisionPadding={collisionPadding}
        data-slot="dropdown-menu-sub-content"
        {...props}
      />
    </DDMenuPortal>
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
}
