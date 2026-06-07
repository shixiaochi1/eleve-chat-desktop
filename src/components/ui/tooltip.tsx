import {
  Provider as TooltipProviderPrimitive,
  Root as TooltipRoot,
  Trigger as TooltipTriggerPrimitive,
  Content as TooltipContentPrimitive,
  Portal as TooltipPortal,
  Arrow as TooltipArrow,
} from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from '../../lib/utils'

interface TooltipProviderProps extends React.ComponentPropsWithoutRef<typeof TooltipProviderPrimitive> {}

function TooltipProvider({ delayDuration = 0, ...props }: TooltipProviderProps) {
  return <TooltipProviderPrimitive data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

interface TooltipProps extends React.ComponentPropsWithoutRef<typeof TooltipRoot> {}

function Tooltip({ ...props }: TooltipProps) {
  return <TooltipRoot data-slot="tooltip" {...props} />
}

interface TooltipTriggerProps extends React.ComponentPropsWithoutRef<typeof TooltipTriggerPrimitive> {}

function TooltipTrigger({ ...props }: TooltipTriggerProps) {
  return <TooltipTriggerPrimitive data-slot="tooltip-trigger" {...props} />
}

interface TooltipContentProps extends React.ComponentPropsWithoutRef<typeof TooltipContentPrimitive> {
  sideOffset?: number
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPortal>
      <TooltipContentPrimitive
        className={cn(
          'z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className
        )}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
        <TooltipArrow className="z-50 size-2.5 translate-y-[calc(-50%_-_0.125rem)] rotate-45 rounded-[0.125rem] bg-foreground fill-foreground" />
      </TooltipContentPrimitive>
    </TooltipPortal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
