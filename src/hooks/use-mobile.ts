import { useMediaQuery } from './use-media-query'

export const useIsMobile = (): boolean => useMediaQuery(`(max-width: ${768 / 16 - 1 / 16}rem)`)
