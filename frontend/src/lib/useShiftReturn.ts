import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type TimeEntry } from './api'
import { RETURN_EDIT, RETURN_PARAM, shiftParamFor } from './shiftHistory'

export const SHIFT_GONE_MESSAGE =
  "That shift was deleted or can't be edited any more, so there is nothing to reopen. Nothing else changed."

export type ShiftReturn =
  | { status: 'idle' }
  | { status: 'loading'; entryId: number }
  | { status: 'ready'; entry: TimeEntry }
  | { status: 'gone'; entryId: number }

/**
 * Coming back from a shift's history (`?entry_id=7&return=edit`): fetches the shift's
 * current state so the page can move to its current person and pay period and open
 * Edit shift on it. `finish()` clears the request once the page has dealt with it.
 */
export function useShiftReturn(param?: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const key = param ?? shiftParamFor(window.location.pathname)
  const raw = searchParams.get(key) ?? ''
  const entryId = searchParams.get(RETURN_PARAM) === RETURN_EDIT && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
  const [loaded, setLoaded] = useState<{ entryId: number; entry: TimeEntry | null } | null>(null)

  useEffect(() => {
    if (!entryId) return
    let cancelled = false
    void api.getTimeEntry(entryId).then((response) => {
      if (cancelled) return
      const entry = response.data?.time_entry
      setLoaded({ entryId, entry: entry && entry.id === entryId ? entry : null })
    })
    return () => { cancelled = true }
  }, [entryId])

  const finish = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete(RETURN_PARAM)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const state: ShiftReturn = !entryId
    ? { status: 'idle' }
    : loaded?.entryId !== entryId
      ? { status: 'loading', entryId }
      : loaded.entry
        ? { status: 'ready', entry: loaded.entry }
        : { status: 'gone', entryId }
  return { state, finish }
}
