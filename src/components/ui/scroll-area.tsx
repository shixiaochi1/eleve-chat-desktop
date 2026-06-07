import {
  Root as ScrollAreaRoot,
  Viewport as ScrollAreaViewport,
  Corner as ScrollAreaCorner,
  Scrollbar as ScrollAreaScrollbar,
  Thumb as ScrollAreaThumb,
} from '@radix-ui/react-scroll-area'
import * as React from 'react'

import { cn } from '../../lib/utils'

interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaRoot> {}

function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <ScrollAreaRoot className={cn('relative overflow-hidden', className)} data-slot="scroll-area" {...props}>
      <ScrollAreaViewport className="size-full outline-none" data-slot="scroll-area-viewport">
        {children}
      </ScrollAreaViewport>
      <ScrollBar />
      <ScrollAreaCorner />
    </ScrollAreaRoot>
  )
}

interface ScrollBarProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaScrollbar> {}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollBarProps) {
  return (
    <ScrollAreaScrollbar
      className={cn(
        'flex touch-none select-none p-px transition-colors',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaThumb
        className="relative flex-1 rounded-full bg-muted-foreground/30 hover:bg-muted-foreground/45"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
