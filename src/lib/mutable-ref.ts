/**
 * 1:1 port of Eleve mutable-ref.ts
 * Safe write to ref.current — bypasses react-compiler marking.
 */
import type { RefObject } from 'react'

export function setMutableRef<T>(ref: RefObject<T | null>, value: T): void {
  ref.current = value
}
