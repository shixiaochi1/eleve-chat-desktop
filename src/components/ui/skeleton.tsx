import { cn } from '../../lib/utils'

interface SkeletonProps extends React.ComponentPropsWithoutRef<'div'> {}

function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-md bg-accent', className)} data-slot="skeleton" {...props} />
}

export { Skeleton }
