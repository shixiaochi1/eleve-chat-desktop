import { useEffect, useState } from 'react'

export const matchesQuery = (query: string): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => matchesQuery(query))

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return
    }

    const mql = window.matchMedia(query)
    const onChange = (): void => setMatches(mql.matches)

    setMatches(mql.matches)
    mql.addEventListener('change', onChange)

    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
