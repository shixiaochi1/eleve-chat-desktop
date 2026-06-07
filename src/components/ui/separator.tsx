import { Root as SeparatorRoot } from '@radix-ui/react-separator'
import * as React from 'react'

import { cn } from '../../lib/utils'

interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof SeparatorRoot> {
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
}

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorRoot
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className
      )}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  )
}

export { Separator }
