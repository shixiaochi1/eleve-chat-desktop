import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * cn — merge Tailwind class names, resolve conflicts
 * Wraps clsx + tailwind-merge, used by shadcn/ui components
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
