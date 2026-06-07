import { Root as TabsRoot, List as TabsListPrimitive, Trigger as TabsTriggerPrimitive } from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '../../lib/utils'

interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsRoot> {}

function Tabs({ className, ...props }: TabsProps) {
  return <TabsRoot className={cn('flex flex-col gap-2', className)} data-slot="tabs" {...props} />
}

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsListPrimitive> {}

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <TabsListPrimitive
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className
      )}
      data-slot="tabs-list"
      {...props}
    />
  )
}

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsTriggerPrimitive> {}

function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsTriggerPrimitive
      className={cn(
        'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger }
