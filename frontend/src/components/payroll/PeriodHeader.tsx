import type { ReactNode } from 'react'
import type { PayrollLockControl } from '../../lib/api'
import type { AttentionPeriod } from '../../lib/api/attention'
import type { PayrollPeriodSummary } from '../../lib/api/payrollPeriod'
import { businessDateISO } from '../../lib/dateUtils'
import type { PayPeriod } from '../../lib/payPeriods'
import { HANDOFF_STATE_LABELS, isLockedState } from '../../lib/payrollTerms'
import { PageHeader, StatusPill, type StatusTone } from '../ui'
import { dayLabel, lockStatus, lockTimeLabel, monthDay, periodLabel } from '../today/format'

/** The period in the shape Today's lock pill reads. */
function asAttentionPeriod(period: PayrollPeriodSummary): AttentionPeriod {
  return {
    published: true,
    start_date: period.start_date,
    end_date: period.end_date,
    pay_date: period.pay_date,
    cutoff_at: period.cutoff_at,
    handoff_state: period.handoff_state,
    label: HANDOFF_STATE_LABELS[period.handoff_state],
    label_provisional: period.label_provisional,
    people: period.people,
    approved_hours: period.approved_hours ?? 0,
    waiting_hours: period.waiting_hours ?? 0,
    waiting_count: period.waiting_count ?? 0,
    hours_source: period.hours_source,
  }
}

export interface PeriodHeaderProps {
  range: PayPeriod
  /** Null when Cornerstone Payroll hasn't published these dates. */
  period: PayrollPeriodSummary | null
  /** The lock control for this period, when it is the one AIRE locks next. */
  control: PayrollLockControl | null
  paused: boolean
  /** Null while the connection is still loading. */
  connectionPill: { label: string; tone: StatusTone } | null
  now: Date
  actions?: ReactNode
  children?: ReactNode
}

/** "Nov 1–15 pay period", when it locks and pays, and where it stands. */
export function PeriodHeader({ range, period, control, paused, connectionPill, now, actions, children }: PeriodHeaderProps) {
  const locked = Boolean(period && isLockedState(period.handoff_state, period.status))
  const cutoffAt = period && !locked ? control?.cutoff_at ?? period.cutoff_at : null
  const status = period && !locked && period.handoff_state !== 'before_locking'
    ? lockStatus({ period: asAttentionPeriod(period), control, cutoffAt, now, paused })
    : null
  const pill = period
    ? status?.label
      ? { tone: status.tone, label: period.handoff_state === 'open' && status.kind === 'upcoming' ? `Open · ${status.label.toLowerCase()}` : status.label }
      : { tone: period.handoff_state === 'paid' ? 'approved' as const : period.handoff_state === 'before_locking' ? 'off' as const : 'info' as const, label: HANDOFF_STATE_LABELS[period.handoff_state] }
    : { tone: 'off' as const, label: 'Not published' }

  const facts = period
    ? [
        cutoffAt
          ? <>{status?.prefix ?? 'Locks'} <b className="font-semibold text-ink"><time dateTime={cutoffAt}>{lockTimeLabel(cutoffAt)}</time></b></>
          : period.locked_at ? <>Locked {monthDay(businessDateISO(new Date(period.locked_at)))}</> : null,
        <>pays {dayLabel(period.pay_date)}</>,
      ].filter(Boolean)
    : []

  return (
    <PageHeader
      title={`${periodLabel({ start_date: range.start, end_date: range.end })} pay period`}
      description={facts.length > 0 ? facts.map((fact, index) => <span key={index}>{index > 0 && ' · '}{fact}</span>) : undefined}
      actions={actions}
    >
      <ul aria-label="Status" className="flex flex-wrap gap-2">
        <li><StatusPill tone={pill.tone}>{pill.label}</StatusPill></li>
        {connectionPill && <li><StatusPill tone={connectionPill.tone}>{connectionPill.label}</StatusPill></li>}
      </ul>
      {children}
    </PageHeader>
  )
}
