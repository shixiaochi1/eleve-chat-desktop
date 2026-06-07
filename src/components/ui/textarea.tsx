import * as React from 'react'

import { cn } from '../../lib/utils'

interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {}

function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'desktop-input-chrome min-h-16 w-full rounded-md border px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      data-slot="textarea"
      {...props}
    />
  )
}

export { Textarea }
