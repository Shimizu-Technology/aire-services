import { Link } from 'react-router-dom'
import { TriangleAlert, Unplug } from 'lucide-react'
import { cx } from '../../lib/cx'
import type { PayrollConnectionStatus } from '../../lib/api/attention'
import { Skeleton } from '../ui/Skeleton'
import { ErrorState } from '../ui'
import { plural } from './format'
import { payrollConnectionCopy } from '../../lib/payrollConnection'
import { PAYROLL_CONNECTION_HREF } from './links'
import { StaleNote } from './StaleNote'

export interface ConnectionCardProps {
  connection: PayrollConnectionStatus | null
  load: 'loading' | 'error' | 'ready' | 'stale'
  /** When `connection` was last loaded, for the stale note. */
  updatedAt?: Date | null
  now: Date
  onRetry: () => void
}

/** Whether Cornerstone Payroll is connected and when it last answered. */
export function ConnectionCard({ connection, load, updatedAt = null, now, onRetry }: ConnectionCardProps) {
  return (
    <section aria-labelledby="today-connection">
      <h2 id="today-connection" className="text-body font-semibold text-ink">Payroll connection</h2>
      <div className="mt-2">
        {load === 'loading' && <Skeleton className="h-20 w-full" />}
        {load === 'error' && <ErrorState title="Couldn't load the payroll connection." onRetry={onRetry} />}
        {load === 'stale' && <div className="mb-2"><StaleNote what="the connection" loadedAt={updatedAt} onRetry={onRetry} /></div>}
        {(load === 'ready' || load === 'stale') && connection && <Details connection={connection} now={now} />}
      </div>
    </section>
  )
}

function Details({ connection, now }: { connection: PayrollConnectionStatus; now: Date }) {
  const paused = connection.state === 'paused'
  const problem = connection.state === 'delivery_problem'
  const copy = payrollConnectionCopy(connection, now)

  return (
    <div className="rounded-card border border-line bg-surface px-3.5 py-3 text-body-sm">
      <p className="flex items-center gap-2 font-semibold text-ink">
        {paused
          ? <Unplug aria-hidden="true" className="size-4 shrink-0 text-red-600" />
          : problem
            ? <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-amber-600" />
            : <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', copy.connected ? 'bg-emerald-600' : 'bg-slate-400')} />}
        {copy.title}
      </p>
      {problem && (
        <p className="mt-1 text-amber-900">
          {plural(connection.undelivered.count, 'update')} for Payroll {connection.undelivered.count === 1 ? "hasn't" : "haven't"} arrived.
        </p>
      )}
      <p className="mt-1 text-ink-muted">{copy.detail}</p>
      <Link to={PAYROLL_CONNECTION_HREF} className="mt-1 inline-flex min-h-11 items-center font-semibold text-primary underline pointer-fine:min-h-0">
        Connection details
      </Link>
    </div>
  )
}

export interface PausedBannerProps {
  className?: string
}

/** The first thing on the page when the payroll connection is paused. */
export function PausedBanner({ className }: PausedBannerProps) {
  return (
    <div
      role="alert"
      className={cx('flex items-start gap-3 rounded-card border border-red-200 bg-danger-soft px-4 py-3 text-body-sm text-red-900', className)}
    >
      <Unplug aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-600" />
      <p>
        <b>Payroll connection paused.</b> AIRE can't send locked hours to Cornerstone Payroll. Time tracking still works.{' '}
        <Link to={PAYROLL_CONNECTION_HREF} className="font-bold underline">See details</Link>
      </p>
    </div>
  )
}
