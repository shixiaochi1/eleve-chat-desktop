import {
  Root as DialogRootPrimitive,
  Trigger as DialogTriggerPrimitive,
  Portal as DialogPortalPrimitive,
  Overlay as DialogOverlayPrimitive,
  Content as DialogContentPrimitive,
  Title as DialogTitlePrimitive,
  Description as DialogDescriptionPrimitive,
  Close as DialogClosePrimitive,
} from '@radix-ui/react-dialog'
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface DialogProps extends React.ComponentPropsWithoutRef<typeof DialogRootPrimitive> {
  children?: React.ReactNode
}

function Dialog({ ...props }: DialogProps) {
  return <DialogRootPrimitive data-slot="dialog" {...props} />
}

interface DialogTriggerProps extends React.ComponentPropsWithoutRef<typeof DialogTriggerPrimitive> {}

function DialogTrigger({ ...props }: DialogTriggerProps) {
  return <DialogTriggerPrimitive data-slot="dialog-trigger" {...props} />
}

interface DialogPortalProps extends React.ComponentPropsWithoutRef<typeof DialogPortalPrimitive> {}

function DialogPortal({ ...props }: DialogPortalProps) {
  return <DialogPortalPrimitive data-slot="dialog-portal" {...props} />
}

interface DialogCloseProps extends React.ComponentPropsWithoutRef<typeof DialogClosePrimitive> {}

function DialogClose({ ...props }: DialogCloseProps) {
  return <DialogClosePrimitive data-slot="dialog-close" {...props} />
}

interface DialogOverlayProps extends React.ComponentPropsWithoutRef<typeof DialogOverlayPrimitive> {}

function DialogOverlay({ className, ...props }: DialogOverlayProps) {
  return (
    <DialogOverlayPrimitive
      className={cn(
        'fixed inset-0 z-[120] pointer-events-auto bg-overlay/22 backdrop-blur-[0.125rem] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  )
}

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogContentPrimitive> {
  showCloseButton?: boolean
  children?: React.ReactNode
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogContentPrimitive
        className={cn(
          // Cap height at 85vh and let long content scroll inside the dialog
          // instead of overflowing off-screen (long cron titles, tool detail
          // dumps, etc.). Individual dialogs can still override via className.
          'fixed left-1/2 top-1/2 z-[130] pointer-events-auto grid max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) p-4 text-[length:var(--conversation-text-font-size)] text-foreground shadow-md duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className
        )}
        data-slot="dialog-content"
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogClosePrimitive
            className="absolute right-2.5 top-2.5 rounded-md p-1 text-(--ui-text-tertiary) opacity-70 transition-opacity hover:bg-(--chrome-action-hover) hover:text-foreground hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none"
            data-slot="dialog-close-button"
          >
            <Codicon name="close" size="1rem" />
            <span className="sr-only">Close</span>
          </DialogClosePrimitive>
        )}
      </DialogContentPrimitive>
    </DialogPortal>
  )
}

interface DialogHeaderProps extends React.ComponentPropsWithoutRef<'div'> {}

function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return (
    <div
      className={cn('flex flex-col gap-1 text-center sm:text-left', className)}
      data-slot="dialog-header"
      {...props}
    />
  )
}

interface DialogFooterProps extends React.ComponentPropsWithoutRef<'div'> {}

function DialogFooter({ className, ...props }: DialogFooterProps) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      data-slot="dialog-footer"
      {...props}
    />
  )
}

interface DialogTitleProps extends React.ComponentPropsWithoutRef<typeof DialogTitlePrimitive> {
  children?: React.ReactNode
}

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogTitlePrimitive
      className={cn('text-[0.9375rem] font-semibold tracking-tight text-foreground', className)}
      data-slot="dialog-title"
      {...props}
    />
  )
}

interface DialogDescriptionProps extends React.ComponentPropsWithoutRef<typeof DialogDescriptionPrimitive> {}

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <DialogDescriptionPrimitive
      className={cn(
        'text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)',
        className
      )}
      data-slot="dialog-description"
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
