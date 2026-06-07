import * as React from 'react'

import { cn } from '../../lib/utils'

interface CodiconProps extends React.ComponentPropsWithoutRef<'i'> {
  name: string
  size?: string | number
  spinning?: boolean
}

export function Codicon({ className, name, size, spinning, style, ...props }: CodiconProps) {
  return (
    <i
      aria-hidden="true"
      className={cn('codicon', `codicon-${name}`, spinning && 'codicon-modifier-spin', className)}
      style={{ fontSize: size, ...style }}
      {...props}
    />
  )
}
