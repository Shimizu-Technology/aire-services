import { formatBusinessTime, formatDateOnly } from '../../lib/dateUtils'
import { lockDistance } from '../../lib/lockTime'
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

export interface LockStatus {
  /** What the pill says, or null when no pill applies. */
  label: string | null
  tone: StatusTone
  /** The lock is happening now, so the absolute lock time no longer helps. */
  locking: boolean
}

const LOCKED_STATES: AttentionPeriod['handoff_state'][] = ['locked', 'received', 'in_run', 'paid']

/**
 * The pay period card's pill. Waiting while the lock is more than a day away,
 * needs-fix inside 24 hours, and "Locking now" once Lock now was used or the
 * lock time has arrived.
 */
export function lockStatus(
  period: AttentionPeriod | null,
  control: PayrollLockControl | null,
  cutoffAt: string | null,
  now: Date,
): LockStatus {
  if (period && LOCKED_STATES.includes(period.handoff_state)) return { label: period.label, tone: 'approved', locking: false }
  if (control?.status === 'failed') return { label: 'Lock failed', tone: 'needs-fix', locking: false }
  if (!cutoffAt) return { label: null, tone: 'off', locking: false }

  const remaining = Date.parse(cutoffAt) - now.getTime()
  const lockNowAsked = control?.pending_change?.state === 'pending' && control.pending_change.action === 'lock_now'
  if (lockNowAsked || remaining <= 60_000) {
    return { label: 'Locking now', tone: 'info', locking: true }
  }
  return {
    label: `Locks ${lockDistance(cutoffAt, now)}`,
    tone: remaining < DAY_MS ? 'needs-fix' : 'waiting',
    locking: false,
  }
}

/** "Wed, Nov 18, 5:00 PM" for the absolute lock time. */
export const lockTimeLabel = dayTimeLabel
