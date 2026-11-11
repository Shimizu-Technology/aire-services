import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../../lib/cx'
import { currentPayPeriod, formatPayPeriod, isSamePayPeriod, nextPayPeriod, previousPayPeriod, type PayPeriod } from '../../lib/payPeriods'
import { IconButton } from './Button'

export interface PeriodStepperProps {
  period: PayPeriod
  onChange: (period: PayPeriod) => void
  /** Earliest date to reach (YYYY-MM-DD), e.g. the hire date. The period containing it is the first. */
  min?: string
  /** Latest date to reach, e.g. today, so nobody steps past the current period. */
  max?: string
  /** For tests and previews; defaults to now. */
  now?: Date
  className?: string
}

/**
 * ‹ Nov 1–15 · this pay period ›. Steps one semimonthly pay period at a time
 * and announces the new period politely.
 */
export function PeriodStepper({ period, onChange, min, max, now, className }: PeriodStepperProps) {
  const previous = previousPayPeriod(period)
  const next = nextPayPeriod(period)
  const current = currentPayPeriod(now)
  const relation = isSamePayPeriod(period, current) ? 'this pay period'
    : isSamePayPeriod(period, previousPayPeriod(current)) ? 'last pay period'
      : isSamePayPeriod(period, nextPayPeriod(current)) ? 'next pay period'
        : null

  return (
    <div className={cx('flex items-center gap-1', className)}>
      <IconButton
        label="Previous pay period"
        icon={<ChevronLeft className="size-5" />}
        variant="secondary"
        // Previous is reachable while any of it is on or after min (a hire mid-period counts).
        disabled={min !== undefined && previous.end < min}
        onClick={() => onChange(previous)}
      />
      <p aria-live="polite" className="min-w-0 flex-1 px-2 text-center text-body-sm text-ink-muted">
        <span className="font-semibold text-ink tabular-nums">{formatPayPeriod(period, { now })}</span>
        {relation && <> · {relation}</>}
      </p>
      <IconButton
        label="Next pay period"
        icon={<ChevronRight className="size-5" />}
        variant="secondary"
        disabled={max !== undefined && next.start > max}
        onClick={() => onChange(next)}
      />
    </div>
  )
}
