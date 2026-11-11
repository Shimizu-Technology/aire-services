import { useEffect, useState } from 'react'
import { cx } from '../../lib/cx'
import { formatElapsed } from '../../lib/formatElapsed'

export interface LiveTimerProps {
  /** When the clock started (ISO string or Date). */
  since: string | Date
  /** `clock` is h:mm:ss; `short` is 3h 12m. */
  format?: 'clock' | 'short'
  /** What screen readers hear instead of a ticking number: "On the clock since 8:00 AM". */
  label: string
  /** Stops ticking, e.g. while on break. */
  paused?: boolean
  className?: string
}

/**
 * Time since `since`, updated on each whole second of elapsed time while the
 * page is visible, so it never skips or repeats a second. When the tab is
 * hidden it stops; on return it catches up at once, since the value is always
 * computed from the clock, never counted. An unreadable `since` shows a dash.
 */
export function LiveTimer({ since, format = 'clock', label, paused = false, className }: LiveTimerProps) {
  const startMs = (typeof since === 'string' ? new Date(since) : since).getTime()
  const valid = Number.isFinite(startMs)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (paused || !valid) return
    let timer: number | null = null
    const stop = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
    }
    const tick = () => {
      const current = Date.now()
      setNow(current)
      // Wait until the next whole second since the start (at least a few ms).
      const elapsed = current - startMs
      const wait = 1000 - (((elapsed % 1000) + 1000) % 1000)
      timer = window.setTimeout(tick, Math.max(wait, 16))
    }
    const run = () => {
      stop()
      if (document.visibilityState !== 'hidden') tick()
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => {
      document.removeEventListener('visibilitychange', run)
      stop()
    }
  }, [paused, valid, startMs])

  return (
    <span className={cx('tabular-nums', className)}>
      <span className="sr-only">{label}</span>
      {valid
        ? <time aria-hidden="true" aria-live="off" dateTime={new Date(startMs).toISOString()}>{formatElapsed(now - startMs, format)}</time>
        : <span aria-hidden="true">–</span>}
    </span>
  )
}
