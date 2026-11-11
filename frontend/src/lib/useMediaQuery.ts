import { useCallback, useSyncExternalStore } from 'react'

function query(media: string) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(media) : null
}

/** Whether a CSS media query matches now. Updates when it changes. False during SSR and where matchMedia is missing. */
export function useMediaQuery(media: string) {
  const subscribe = useCallback((onChange: () => void) => {
    const list = query(media)
    if (!list) return () => undefined
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [media])
  return useSyncExternalStore(subscribe, () => query(media)?.matches ?? false, () => false)
}

/** The visitor asked the OS for less motion. Movement becomes instant; short fades can stay. */
export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
