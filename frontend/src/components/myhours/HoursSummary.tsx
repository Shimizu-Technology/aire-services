import type { TimeEntry } from '../../lib/api'
import { periodPaidDate, displayPeriodTotals } from '../../lib/myTime'
import type { PayPeriod } from '../../lib/payPeriods'
import { employeeDate } from '../../lib/employeePresentation'
import { ProgressSplit, StatusPill } from '../ui'

export function HoursSummary({
  entries,
  period,
  approverNames = [],
}: {
  entries: TimeEntry[]
  period: PayPeriod
  approverNames?: string[]
}) {
  const totals = displayPeriodTotals(entries, period)
  const paidDate = periodPaidDate(entries)
  return (
    <section
      aria-label="Pay period summary"
      className="space-y-4 rounded-card border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-4xl font-semibold tabular-nums text-ink">
          {totals.total.toFixed(1)}h
        </p>
        {paidDate && (
          <StatusPill tone="approved">
            Paid{' '}
            {employeeDate(paidDate, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </StatusPill>
        )}
      </div>
      <ProgressSplit
        parts={[
          { label: 'approved', value: totals.approved, tone: 'approved' },
          { label: 'waiting', value: totals.waiting, tone: 'waiting' },
        ]}
      />
      {totals.waiting > 0 && (
        <p className="text-body-sm text-ink-muted">
          {totals.waiting.toFixed(1)}h waiting for{' '}
          {approverNames.length ? approverNames.join(' or ') : 'approval'}
        </p>
      )}
    </section>
  )
}
