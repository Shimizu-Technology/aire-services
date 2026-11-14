import { Link } from 'react-router-dom'
import type { PayrollCarryoverItem } from '../../lib/api'
import { payPeriodIncludes, type PayPeriod } from '../../lib/payPeriods'
import { PAYROLL_WORDS } from '../../lib/payrollTerms'
import { HelpTip } from '../ui'
import { dayLabel, hoursLabel } from '../today/format'
import { carriedDestination, carriedHours } from './payPeriodModel'

export interface CarriedHoursProps {
  items: PayrollCarryoverItem[]
  range: PayPeriod
  /** Every carried shift, for the full history. */
  recordsHref: string
}

/** Shifts from this period that went to a later payroll. Renders nothing when there are none. */
export function CarriedHours({ items, range, recordsHref }: CarriedHoursProps) {
  const carried = items
    .filter(item => payPeriodIncludes(range, item.original_work_date))
    .sort((a, b) => a.original_work_date.localeCompare(b.original_work_date) || a.display_name.localeCompare(b.display_name))
  if (carried.length === 0) return null

  return (
    <section aria-labelledby="carried-hours" className="space-y-2">
      <h2 id="carried-hours" className="flex items-center gap-1 text-body font-semibold text-ink">
        {PAYROLL_WORDS.carriedHours}
        <HelpTip label={PAYROLL_WORDS.carriedHours}>{PAYROLL_WORDS.carriedHoursHelp}</HelpTip>
      </h2>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {carried.map(item => {
          const destination = carriedDestination(item)
          const hours = carriedHours(item)
          return (
            <li key={`${item.source_time_entry_id}-${item.exclusion_reason}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3.5 py-3 text-body-sm">
              <span className="min-w-0">
                <span className="font-semibold text-ink">{item.display_name}</span>
                <span className="text-ink-muted"> · {dayLabel(item.original_work_date)} · {hoursLabel(hours.carried)}{hours.shift !== null && ` of a ${hoursLabel(hours.shift)} shift`}</span>
              </span>
              <span className="text-ink-muted">
                <span aria-hidden="true">→ </span>
                {destination.to
                  ? <Link to={destination.to} className="font-semibold text-primary underline">{destination.label}</Link>
                  : <span className="font-semibold text-ink">{destination.label}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      <Link to={recordsHref} className="inline-flex min-h-11 items-center text-body-sm font-semibold text-primary underline pointer-fine:min-h-0">See every carried shift</Link>
    </section>
  )
}
