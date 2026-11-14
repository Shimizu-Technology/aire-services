import type { WorkerStatus } from '../../lib/api'
import { cx } from '../../lib/cx'
import { StatusPill } from '../ui'
import { hoursLabel, timeLabel, weekdayTime } from './format'

const OPEN_STATUSES = ['clocked_in', 'on_break']

/** Hours on the open clock: time since clock-in, less breaks. */
function hoursSoFar(worker: WorkerStatus, now: Date) {
  if (!worker.clock_in_at) return null
  const breakMs = worker.total_break_minutes * 60_000
  const activeMs = worker.active_break && worker.break_started_at ? now.getTime() - Date.parse(worker.break_started_at) : 0
  return Math.max(0, (now.getTime() - Date.parse(worker.clock_in_at) - breakMs - activeMs) / 3_600_000)
}

export interface OnTheClockProps {
  workers: WorkerStatus[]
  now: Date
  /** When the list was loaded, for "Updated 7:41 PM". */
  loadedAt?: Date | null
}

/** Who is clocked in now. A clock left open from an earlier day gets a red pill. */
export function OnTheClock({ workers, now, loadedAt }: OnTheClockProps) {
  const open = workers
    .filter(worker => OPEN_STATUSES.includes(worker.status))
    // Earlier-day clocks first, oldest first, then the rest by who came in first.
    .sort((a, b) => Number(Boolean(b.open_since_work_date)) - Number(Boolean(a.open_since_work_date))
      || (a.clock_in_at ?? '').localeCompare(b.clock_in_at ?? ''))

  return (
    <section aria-labelledby="today-on-the-clock">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-on-the-clock" className="text-body font-semibold text-ink">
          On the clock <span className="font-semibold text-ink-muted tabular-nums">· {open.length}</span>
        </h2>
        {loadedAt && <span className="text-caption text-ink-muted">Updated {timeLabel(loadedAt)}</span>}
      </div>
      {open.length === 0 ? (
        <p className="mt-2 rounded-card border border-line bg-surface px-3.5 py-4 text-body-sm text-ink-muted">Nobody is clocked in.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {open.map((worker) => {
            const earlier = Boolean(worker.open_since_work_date)
            const hours = hoursSoFar(worker, now)
            const since = worker.clock_in_at ? (earlier ? weekdayTime(worker.clock_in_at) : timeLabel(worker.clock_in_at)) : null
            return (
              <li key={worker.user.id} className="flex items-center gap-3 px-3.5 py-3">
                <span
                  aria-hidden="true"
                  className={cx('size-2 shrink-0 rounded-full', earlier ? 'bg-red-600' : worker.status === 'on_break' ? 'bg-amber-500' : 'bg-emerald-600')}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-ink [overflow-wrap:anywhere] pointer-coarse:text-body">{worker.user.full_name}</p>
                  <p className="text-body-sm text-ink-muted">
                    {[
                      since && `Since ${since}`,
                      worker.status === 'on_break' && 'On break',
                      worker.time_category?.name,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {earlier
                  ? <StatusPill tone="needs-fix">Earlier day</StatusPill>
                  : hours !== null && <span className="text-body-sm font-semibold tabular-nums text-ink">{hoursLabel(hours)}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
