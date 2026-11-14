import { Link } from 'react-router-dom'
import type { PayrollPeriodSummary } from '../../lib/api/payrollPeriod'
import { HANDOFF_STATE_LABELS, LIFECYCLE_LABELS, type HandoffState, type LifecycleStatus } from '../../lib/payrollTerms'
import { StatusPill, StepList } from '../ui'
import { PAYROLL_CONNECTION_HREF } from '../today/links'

const STEPS: Array<Exclude<HandoffState, 'before_locking'>> = ['open', 'locked', 'received', 'in_run', 'paid']
/** Payment statuses that stay "in a payroll run" but need someone to follow up. */
const PAYMENT_PROBLEMS = new Set(['payment_failed', 'payment_voided', 'payment_cancelled'])

export interface HandoffStepsProps {
  period: Pick<PayrollPeriodSummary, 'handoff_state' | 'status' | 'delivery' | 'payroll_status'>
}

/** Open → Locked → Received by Payroll → In a payroll run → Paid. */
export function HandoffSteps({ period }: HandoffStepsProps) {
  const state = period.handoff_state
  const problem = period.payroll_status && PAYMENT_PROBLEMS.has(period.payroll_status.status) ? period.payroll_status.status as LifecycleStatus : null
  const delivery = period.delivery
  const undelivered = state === 'locked' && delivery && (delivery.status === 'failed' || delivery.stuck)

  return (
    <section aria-labelledby="handoff-steps" className="rounded-card border border-line bg-surface p-4">
      <h2 id="handoff-steps" className="text-body font-semibold text-ink">Hand-off to Cornerstone Payroll</h2>
      {state === 'before_locking' ? (
        <p className="mt-2 text-body-sm text-ink-muted">
          {HANDOFF_STATE_LABELS.before_locking}.{' '}
          {period.status === 'finalized'
            ? "AIRE's scheduled lock didn't run for this period; the hours were frozen when it was finalized."
            : "AIRE didn't lock hours for this period."}
        </p>
      ) : (
        <>
          <StepList
            className="mt-3"
            orientation="vertical"
            label="Hand-off to Cornerstone Payroll"
            steps={STEPS.map(key => ({ id: key, label: HANDOFF_STATE_LABELS[key] }))}
            current={state}
            complete={state === 'paid'}
          />
          {problem && <p className="mt-3"><StatusPill tone="needs-fix">{LIFECYCLE_LABELS[problem]}</StatusPill></p>}
          {state === 'locked' && !undelivered && (
            <p role="status" className="mt-3 text-body-sm text-ink-muted">
              Waiting for Cornerstone Payroll to confirm it received the hours. This usually takes under a minute.
            </p>
          )}
          {undelivered && (
            <p role="status" className="mt-3 text-body-sm text-amber-900">
              Cornerstone Payroll hasn't confirmed it received the hours. AIRE keeps trying.{' '}
              <Link to={PAYROLL_CONNECTION_HREF} className="font-semibold underline">Connection details</Link>
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-caption text-ink-muted">At the lock, AIRE freezes the approved hours and sends them to Cornerstone Payroll. You run payroll there.</p>
    </section>
  )
}
