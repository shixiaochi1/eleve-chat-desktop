'use client'

import {
  Root as DialogRoot,
  Trigger as DialogTrigger,
  Close as DialogClose,
  Portal as DialogPortal,
  Overlay as DialogOverlay,
  Content as DialogContent,
  Title as DialogTitle,
  Description as DialogDescription
} from '@radix-ui/react-dialog'
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface SheetProps extends React.ComponentPropsWithoutRef<typeof DialogRoot> {}

function Sheet({ ...props }: SheetProps) {
  return <DialogRoot data-slot="sheet" {...props} />
}

interface SheetTriggerProps extends React.ComponentPropsWithoutRef<typeof DialogTrigger> {}

function SheetTrigger({ ...props }: SheetTriggerProps) {
  return <DialogTrigger data-slot="sheet-trigger" {...props} />
}

interface SheetCloseProps extends React.ComponentPropsWithoutRef<typeof DialogClose> {}

function SheetClose({ ...props }: SheetCloseProps) {
  return <DialogClose data-slot="sheet-close" {...props} />
}

interface SheetPortalProps extends React.ComponentPropsWithoutRef<typeof DialogPortal> {}

function SheetPortal({ ...props }: SheetPortalProps) {
  return <DialogPortal data-slot="sheet-portal" {...props} />
}

interface SheetOverlayProps extends React.ComponentPropsWithoutRef<typeof DialogOverlay> {}

function SheetOverlay({ className, ...props }: SheetOverlayProps) {
  return (
    <DialogOverlay
      className={cn(
        'fixed inset-0 z-50 bg-black/22 backdrop-blur-[0.125rem] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      data-slot="sheet-overlay"
      {...props}
    />
  )
}

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogContent> {
  side?: 'top' | 'bottom' | 'left' | 'right'
  showCloseButton?: boolean
}

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogContent
        className={cn(
          'fixed z-50 flex flex-col gap-3 border-(--ui-stroke-secondary) bg-(--ui-sidebar-surface-background) text-[length:var(--conversation-text-font-size)] shadow-md transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
          side === 'top' &&
            'inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
          side === 'bottom' &&
            'inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          className
        )}
        data-slot="sheet-content"
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogClose className="absolute top-3 right-3 rounded-md p-1 text-(--ui-text-tertiary) opacity-70 ring-offset-background transition-opacity hover:bg-(--chrome-action-hover) hover:text-foreground hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
            <Codicon name="close" size="1rem" />
            <span className="sr-only">Close</span>
          </DialogClose>
        )}
      </DialogContent>
    </SheetPortal>
  )
}

interface SheetHeaderProps extends React.ComponentPropsWithoutRef<'div'> {}

function SheetHeader({ className, ...props }: SheetHeaderProps) {
  return <div className={cn('flex flex-col gap-1 p-3', className)} data-slot="sheet-header" {...props} />
}

interface SheetFooterProps extends React.ComponentPropsWithoutRef<'div'> {}

function SheetFooter({ className, ...props }: SheetFooterProps) {
  return <div className={cn('mt-auto flex flex-col gap-2 p-3', className)} data-slot="sheet-footer" {...props} />
}

interface SheetTitleProps extends React.ComponentPropsWithoutRef<typeof DialogTitle> {}

function SheetTitle({ className, ...props }: SheetTitleProps) {
  return (
    <DialogTitle
      className={cn('text-[0.9375rem] font-semibold text-foreground', className)}
      data-slot="sheet-title"
      {...props}
    />
  )
}

interface SheetDescriptionProps extends React.ComponentPropsWithoutRef<typeof DialogDescription> {}

function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  return (
    <DialogDescription
      className={cn(
        'text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)',
        className
      )}
      data-slot="sheet-description"
      {...props}
    />
  )
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger }
