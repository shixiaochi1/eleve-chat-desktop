import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface DisclosureCaretProps extends Omit<React.ComponentPropsWithoutRef<typeof Codicon>, 'name'> {
  open?: boolean
  size?: string
}

// Chrome caret for collapsible sections: points right when closed (▶),
// rotates to point down (▼) when open. Override `className` to layer
// hover/opacity styling; twMerge resolves transition conflicts.
export function DisclosureCaret({ className, open, size = '0.75rem', ...props }: DisclosureCaretProps) {
  return (
    <Codicon
      className={cn('transition-transform duration-150', open && 'rotate-90', className)}
      name="chevron-right"
      size={size}
      {...props}
    />
  )
}
