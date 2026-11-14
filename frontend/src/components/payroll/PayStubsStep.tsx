import { Link } from 'react-router-dom'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { buttonClasses } from '../ui'
import { dayLabel } from '../today/format'

export interface PayStubsStepProps {
  payDate: string | null
  /** Today in Guam (YYYY-MM-DD). */
  today: string
}

/**
 * Pay stubs for this period. Sending stays on the Pay stubs page until the
 * period send arrives (PLAN.md PR 13).
 */
export function PayStubsStep({ payDate, today }: PayStubsStepProps) {
  const afterPayday = payDate !== null && payDate <= today
  return (
    <section aria-labelledby="pay-stubs-step" className="rounded-card border border-line bg-surface p-4">
      <h2 id="pay-stubs-step" className="text-body font-semibold text-ink">Pay stubs</h2>
      {afterPayday ? (
        <>
          <p className="mt-1 text-body-sm text-ink-muted">Send each person's stub from the Pay stubs page.</p>
          <Link to={ADMIN_PATHS.payStubs} className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'mt-3' })}>Open Pay stubs</Link>
        </>
      ) : (
        <p className="mt-1 text-body-sm text-ink-muted">
          {payDate ? <>Available after payday ({dayLabel(payDate)}).</> : 'Available after payday.'}
        </p>
      )}
    </section>
  )
}
