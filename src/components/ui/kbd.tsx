import * as React from 'react'

import { cn } from '../../lib/utils'

interface KbdProps extends React.ComponentPropsWithoutRef<'kbd'> {}

function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-grid h-4 min-w-4 place-items-center rounded-sm border border-border/70 bg-muted/45 px-1 font-mono text-[0.5625rem] font-medium leading-none text-muted-foreground shadow-xs',
        className
      )}
      data-slot="kbd"
      {...props}
    />
  )
}

interface KbdGroupProps extends React.ComponentPropsWithoutRef<'span'> {
  keys: string[]
}

function KbdGroup({ className, keys, ...props }: KbdGroupProps) {
  return (
    <span
      aria-label={keys.join(' ')}
      className={cn('inline-flex shrink-0 items-center gap-0.5 opacity-55', className)}
      data-slot="kbd-group"
      {...props}
    >
      {keys.map(key => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  )
}

export { Kbd, KbdGroup }
