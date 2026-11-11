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
 * Time since `since`, updated once a second while the page is visible. When
 * the tab is hidden the interval stops; on return it catches up at once, since
 * the value is always computed from the clock, never counted.
 */
export function LiveTimer({ since, format = 'clock', label, paused = false, className }: LiveTimerProps) {
  const start = typeof since === 'string' ? new Date(since) : since
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (paused) return
    let interval: number | null = null
    const tick = () => setNow(Date.now())
    const run = () => {
      if (interval !== null) window.clearInterval(interval)
      interval = null
      if (document.visibilityState === 'hidden') return
      tick()
      interval = window.setInterval(tick, 1000)
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => {
      document.removeEventListener('visibilitychange', run)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [paused])

  return (
    <span className={cx('tabular-nums', className)}>
      <span className="sr-only">{label}</span>
      <time aria-hidden="true" aria-live="off" dateTime={start.toISOString()}>{formatElapsed(now - start.getTime(), format)}</time>
    </span>
  )
}
