import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { PayrollPeriodSummary } from '../../lib/api/payrollPeriod'
import { HANDOFF_STATE_LABELS, type HandoffState } from '../../lib/payrollTerms'
import { StatusPill, type StatusTone } from '../ui'
import { periodLabel } from '../today/format'
import { periodFacts, periodHref } from './payPeriodModel'

const TONES: Record<HandoffState, StatusTone> = {
  open: 'waiting',
  locked: 'info',
  received: 'info',
  in_run: 'info',
  paid: 'approved',
  before_locking: 'off',
}

export interface EarlierPeriodsProps {
  periods: PayrollPeriodSummary[]
  /** Periods that start before this date are listed. */
  before: string
}

/** Earlier pay periods, newest first, each opening its own page. */
export function EarlierPeriods({ periods, before }: EarlierPeriodsProps) {
  const earlier = periods.filter(period => period.start_date < before).slice(0, 6)
  return (
    <section aria-labelledby="earlier-periods" className="rounded-card border border-line bg-surface p-4">
      <h2 id="earlier-periods" className="text-body font-semibold text-ink">Earlier pay periods</h2>
      {earlier.length === 0 ? (
        <p className="mt-1 text-body-sm text-ink-muted">No earlier pay periods yet.</p>
      ) : (
        <ul className="-mx-2 mt-1">
          {earlier.map(period => (
            <li key={period.start_date}>
              <Link to={periodHref(period.start_date)} className="flex min-h-14 items-center gap-2 rounded-control px-2 py-2 hover:bg-surface-muted">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-ink">{periodLabel(period)}</span>
                    <StatusPill tone={TONES[period.handoff_state]}>{HANDOFF_STATE_LABELS[period.handoff_state]}</StatusPill>
                  </span>
                  <span className="mt-0.5 block text-caption text-ink-muted">{periodFacts(period)}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
