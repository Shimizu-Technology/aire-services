import { useEffect, useState } from 'react'

export type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T }

const LOADING = { status: 'loading' } as const

/**
 * Loads whenever `key` changes and shows loading until that key's answer
 * arrives, so an older answer never shows under a newer key. `load` throws
 * an Error whose message is shown; `key` must name everything `load` reads.
 */
export function useLoadable<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, fallback: string): Loadable<T> {
  const [state, setState] = useState<{ key: string; value: Loadable<T> } | null>(null)

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    load(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setState({ key, value: { status: 'ready', value } }) })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({ key, value: { status: 'error', message: reason instanceof Error && reason.message ? reason.message : fallback } })
      })
    return () => controller.abort()
    // `key` names everything `load` reads, so a new `load` alone never reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state && state.key === key ? state.value : LOADING
}

/** Unwraps an `api` result for `useLoadable`. */
export function dataOrThrow<T>(response: { data?: T; error?: string }, fallback: string): T {
  if (response.data === undefined || response.data === null) throw new Error(response.error || fallback)
  return response.data
}
