import { useId } from 'react'
import { Link } from 'react-router-dom'
import type { PayrollLockControl } from '../../lib/api'
import type { AttentionPeriod } from '../../lib/api/attention'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { currentPayPeriod, formatPayPeriod } from '../../lib/payPeriods'
import { Skeleton } from '../ui/Skeleton'
import { ProgressSplit, StatusPill, buttonClasses } from '../ui'
import { dayLabel, hoursLabel, isLocked, lockStatus, lockTimeLabel, plural } from './format'
import { approvalsHref, payrollHref } from './links'

type Load = 'loading' | 'error' | 'ready'

export interface PayPeriodCardProps {
  /** The period and its hours from `GET /attention`. */
  period: AttentionPeriod | null
  periodLoad: Load
  /** The next lock from `GET /payroll_cutoff`, or null when none is scheduled. */
  lock: PayrollLockControl | null
  lockLoad: Load
  now: Date
  onRetryPeriod: () => void
  onRetryLock: () => void
}

function RetryLine({ children, onRetry }: { children: string; onRetry: () => void }) {
  return (
    <p className="text-body-sm text-ink-muted">
      {children}{' '}
      <button type="button" onClick={onRetry} className="min-h-11 font-semibold text-primary underline pointer-fine:min-h-0">
        Try again
      </button>
    </p>
  )
}

/**
 * The pay period at a glance: how close the lock is and how much is still
 * waiting. The lock time and the hours load separately, so either can fail
 * without hiding the other.
 */
export function PayPeriodCard({ period, periodLoad, lock, lockLoad, now, onRetryPeriod, onRetryLock }: PayPeriodCardProps) {
  const headingId = useId()

  if (periodLoad === 'ready' && period && !period.published) {
    return (
      <section aria-labelledby={headingId} className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <h2 id={headingId} className="text-title font-semibold text-ink">Pay period</h2>
        <p className="mt-1 text-body-sm text-ink-muted">No pay period is published yet. Cornerstone Payroll publishes each period.</p>
        <div className="mt-4">
          <Link to={ADMIN_PATHS.payroll} className={buttonClasses({ variant: 'secondary' })}>Open Payroll</Link>
        </div>
      </section>
    )
  }

  const dates = period ?? (lock ? { start_date: lock.period.start_date, end_date: lock.period.end_date } : null)
  const range = dates
    ? { start: dates.start_date, end: dates.end_date }
    : currentPayPeriod(now)
  const cutoffAt = isLocked(period) ? null : lock?.cutoff_at ?? (lockLoad === 'ready' ? period?.cutoff_at ?? null : null)
  const status = lockStatus(period, lock, cutoffAt, now)
  const payDate = lock?.period.pay_date ?? period?.pay_date ?? null
  const waiting = period && period.waiting_count > 0
    ? { label: `waiting (${plural(period.waiting_count, 'shift')})`, value: period.waiting_hours, tone: 'waiting' as const }
    : null

  return (
    <section aria-labelledby={headingId} className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-title font-semibold text-ink">{formatPayPeriod(range)} pay period</h2>
        {lockLoad === 'ready' && status.label && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
      </div>

      <div className="mt-1 text-body-sm text-ink-muted">
        {lockLoad === 'loading' && <Skeleton className="h-5 w-56" />}
        {lockLoad === 'error' && <RetryLine onRetry={onRetryLock}>Couldn't load the lock time.</RetryLine>}
        {lockLoad === 'ready' && (
          <p>
            {cutoffAt && !status.locking && (
              <>Locks <b className="font-semibold text-ink"><time dateTime={cutoffAt}>{lockTimeLabel(cutoffAt)}</time></b></>
            )}
            {cutoffAt && status.locking && 'AIRE is locking these hours.'}
            {cutoffAt && payDate && ' · '}
            {payDate && `pays ${dayLabel(payDate)}`}
            {!cutoffAt && !payDate && 'No lock time is set yet.'}
          </p>
        )}
      </div>

      <div className="mt-3">
        {periodLoad === 'loading' && <Skeleton className="h-9 w-full" />}
        {periodLoad === 'error' && <RetryLine onRetry={onRetryPeriod}>Couldn't load the hours.</RetryLine>}
        {periodLoad === 'ready' && period && (
          <>
            <ProgressSplit
              parts={[{ label: 'approved', value: period.approved_hours, tone: 'approved' }, ...(waiting ? [waiting] : [])]}
              label={`${hoursLabel(period.approved_hours)} approved, ${waiting ? `${hoursLabel(waiting.value)} ${waiting.label}` : 'nothing waiting'}`}
            />
            {!waiting && <p className="mt-1 text-caption text-ink-muted">Nothing waiting for approval</p>}
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={approvalsHref(period ? { period: period.start_date } : {})} className={buttonClasses({})}>
          Review approvals
        </Link>
        <Link to={payrollHref(period)} className={buttonClasses({ variant: 'secondary' })}>
          Open pay period
        </Link>
      </div>
    </section>
  )
}
