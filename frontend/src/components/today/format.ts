import { formatBusinessTime, formatDateOnly } from '../../lib/dateUtils'
import { lockDistance } from '../../lib/lockTime'
import { formatPayPeriod } from '../../lib/payPeriods'
import type { PayrollLockControl } from '../../lib/api'
import type { AttentionPeriod } from '../../lib/api/attention'
import type { StatusTone } from '../ui'

const GUAM = 'Pacific/Guam'
const DAY_MS = 86_400_000

const guam = (value: string | Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: GUAM, ...options }).format(new Date(value))

/** "Fri, Nov 6" from a work date. */
export const dayLabel = (date: string) => formatDateOnly(date, { weekday: 'short', month: 'short', day: 'numeric' })

/** "Nov 1" from a work date. */
export const monthDay = (date: string) => formatDateOnly(date, { month: 'short', day: 'numeric' })

/** "Nov 1–15" for a pay period's dates. */
export const periodLabel = (period: { start_date: string; end_date: string }) =>
  formatPayPeriod({ start: period.start_date, end: period.end_date })

/** "Wednesday, November 11" for the page subtitle. */
export const longDay = (now: Date) => guam(now, { weekday: 'long', month: 'long', day: 'numeric' })

/** "7:02 AM" in Guam time. */
export const timeLabel = (instant: string | Date) => formatBusinessTime(instant)

/** "Tue, Nov 10, 7:02 AM" in Guam time. */
export const dayTimeLabel = (instant: string | Date) =>
  `${guam(instant, { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeLabel(instant)}`

/** "Tue 7:02 AM" for a clock that started on an earlier day. */
export const weekdayTime = (instant: string | Date) => `${guam(instant, { weekday: 'short' })} ${timeLabel(instant)}`

/** "36.7h". */
export const hoursLabel = (hours: number) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(hours)}h`

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** "sick_leave" to "sick leave". */
export const leaveKind = (type: string) => type.replaceAll('_', ' ')

const LOCKED_STATES: AttentionPeriod['handoff_state'][] = ['locked', 'received', 'in_run', 'paid']

/** The hours were already handed to Payroll, so there is no lock time to count down to. */
export const isLocked = (period: AttentionPeriod | null) => Boolean(period && LOCKED_STATES.includes(period.handoff_state))

/** "in 5 hours" or "in 40 minutes" inside a day; whole days and "tomorrow" beyond. */
function countdown(cutoffAt: string, now: Date) {
  const remaining = Date.parse(cutoffAt) - now.getTime()
  if (remaining >= DAY_MS) return lockDistance(cutoffAt, now)
  if (remaining < 60_000) return 'in under a minute'
  const minutes = Math.round(remaining / 60_000)
  if (minutes < 60) return `in ${plural(minutes, 'minute')}`
  return `in ${plural(Math.round(minutes / 60), 'hour')}`
}

export type LockKind = 'upcoming' | 'requested' | 'due' | 'hold' | 'failed' | 'locked' | 'none'

export interface LockStatus {
  kind: LockKind
  /** What the pill says, or null when no pill applies. */
  label: string | null
  tone: StatusTone
  /** The words before the absolute lock time ("Locks", "Scheduled lock"), or null to leave it out. */
  prefix: string | null
}

export interface LockStatusInput {
  period: AttentionPeriod | null
  control: PayrollLockControl | null
  cutoffAt: string | null
  now: Date
  /** The Cornerstone Payroll connection is paused, so nothing can be locked. */
  paused: boolean
}

/**
 * The pay period card's pill, kept honest about what is happening:
 * - upcoming: a countdown, waiting while it is more than a day away, needs-fix inside 24 hours
 * - requested: Lock now was asked for and Cornerstone Payroll hasn't confirmed it yet
 * - due: the lock time passed and the connection is up, so AIRE is locking
 * - hold: the lock is due or requested but the connection is paused, so nothing will lock
 */
export function lockStatus({ period, control, cutoffAt, now, paused }: LockStatusInput): LockStatus {
  if (isLocked(period)) return { kind: 'locked', label: period?.label ?? null, tone: 'approved', prefix: null }
  if (control?.status === 'failed') return { kind: 'failed', label: 'Lock failed', tone: 'needs-fix', prefix: 'Lock time' }
  if (!cutoffAt) return { kind: 'none', label: null, tone: 'off', prefix: null }

  const remaining = Date.parse(cutoffAt) - now.getTime()
  const requested = control?.pending_change?.state === 'pending' && control.pending_change.action === 'lock_now'
  const due = remaining <= 0 || control?.cutoff_state === 'due'
  if (paused && (requested || due)) {
    return { kind: 'hold', label: 'Lock on hold: connection paused', tone: 'needs-fix', prefix: 'Lock time' }
  }
  if (requested) {
    return { kind: 'requested', label: 'Lock requested · waiting for Cornerstone Payroll', tone: 'info', prefix: 'Scheduled lock' }
  }
  if (due) return { kind: 'due', label: 'Locking now', tone: 'info', prefix: 'Lock time' }
  return { kind: 'upcoming', label: `Locks ${countdown(cutoffAt, now)}`, tone: remaining < DAY_MS ? 'needs-fix' : 'waiting', prefix: 'Locks' }
}

/** "Wed, Nov 18, 5:00 PM" for the absolute lock time. */
export const lockTimeLabel = dayTimeLabel
