import { Root as CheckboxRoot, Indicator as CheckboxIndicator } from '@radix-ui/react-checkbox'
import * as React from 'react'

import { Codicon } from './codicon'
import { cn } from '../../lib/utils'

interface CheckboxProps extends React.ComponentPropsWithoutRef<typeof CheckboxRoot> {}

function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxRoot
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-input shadow-xs outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxIndicator
        className="flex items-center justify-center text-current"
        data-slot="checkbox-indicator"
      >
        <Codicon name="check" size="0.875rem" />
      </CheckboxIndicator>
    </CheckboxRoot>
  )
}

export { Checkbox }
