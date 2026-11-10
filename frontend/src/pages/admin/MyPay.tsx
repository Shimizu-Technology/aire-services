import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ReceiptText } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { MyPayErrorState, StatementListSkeleton, StatusBadge } from '../../components/my-pay/MyPayParts'
import {
  MyPayError,
  formatHours,
  formatMoney,
  formatPayDate,
  formatPeriod,
  myPayApi,
  paymentStatus,
  runPurposeLabel,
  type MyPayStatementSummary,
  type MyPayWorker,
} from '../../lib/myPayApi'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: MyPayError }
  | { status: 'ready'; worker: MyPayWorker; statements: MyPayStatementSummary[] }

function groupByYear(statements: MyPayStatementSummary[]) {
  const groups: { year: string; statements: MyPayStatementSummary[] }[] = []
  for (const statement of statements) {
    const year = statement.pay_date?.slice(0, 4) || 'Undated'
    const group = groups.at(-1)
    if (group?.year === year) group.statements.push(statement)
    else groups.push({ year, statements: [statement] })
  }
  return groups
}

function StatementCard({ statement, contractor }: { statement: MyPayStatementSummary; contractor: boolean }) {
  const status = paymentStatus(statement.payment)
  const purpose = runPurposeLabel(statement.run_purpose)
  const payDate = formatPayDate(statement.pay_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <li>
      <Link
        to={`/admin/pay/${statement.id}`}
        aria-label={`${contractor ? 'Payment' : 'Paycheck'} for ${payDate}, net ${formatMoney(statement.net_pay)}, ${status.label}`}
        className="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 active:bg-slate-50 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-950 sm:text-lg">{payDate}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge {...status} />
              {purpose && <span className="text-xs font-medium text-slate-600">{purpose}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-right">
            <div>
              <p className="text-xs font-medium text-slate-500">{contractor ? 'Payment' : 'Net pay'}</p>
              <p className="font-display text-xl font-bold tabular-nums text-slate-950 sm:text-2xl">{formatMoney(statement.net_pay)}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400 transition-colors group-hover:text-cyan-700" aria-hidden="true" />
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-sm text-slate-600 sm:grid-cols-3">
          <div className="flex gap-1.5">
            <dt className="sr-only">Pay period</dt>
            <dd>{formatPeriod(statement.period_start, statement.period_end)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-slate-500">Hours</dt>
            <dd className="tabular-nums text-slate-800">{formatHours(statement.total_hours)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-slate-500">Gross</dt>
            <dd className="tabular-nums text-slate-800">{formatMoney(statement.gross_pay)}</dd>
          </div>
        </dl>
      </Link>
    </li>
  )
}

export default function MyPay() {
  const { currentUser, isClerkEnabled } = useAuthContext()
  const enabled = Boolean(currentUser?.my_pay_enabled)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    myPayApi.list(controller.signal)
      .then((data) => setState({ status: 'ready', worker: data.worker, statements: data.statements }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', error: error instanceof MyPayError ? error : new MyPayError('Pay history is temporarily unavailable. Please try again in a few minutes.', 'network') })
      })
    return () => controller.abort()
  }, [enabled, attempt])

  const contractor = state.status === 'ready' && state.worker.contractor

  if (!enabled && (currentUser || !isClerkEnabled)) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Pay</h1>
        <p className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          My Pay isn&apos;t available for your account yet. Your paper pay stub is still your record of each paycheck.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">AIRE Ops</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">My Pay</h1>
        <p className="mt-1 text-sm text-slate-600">
          {contractor ? 'Every payment statement from AIRE Services, newest first.' : 'Every paycheck from AIRE Services, newest first. Your paper stub still comes with each check.'}
        </p>
      </div>

      <div aria-live="polite" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && (
          <>
            <span className="sr-only">Loading your pay history…</span>
            <StatementListSkeleton />
          </>
        )}
        {state.status === 'error' && <MyPayErrorState error={state.error} onRetry={retry} />}
        {state.status === 'ready' && state.statements.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
            <ReceiptText className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">{contractor ? 'No payments yet' : 'No paychecks yet'}</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
              {contractor ? 'Payments' : 'Paychecks'} show up here once payroll is finalized. Hours you&apos;ve worked are in My Time.
            </p>
            <Link to="/admin/time" className="mt-4 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-cyan-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-cyan-600">
              Go to My Time
            </Link>
          </div>
        )}
        {state.status === 'ready' && state.statements.length > 0 && (
          <div className="space-y-6">
            {groupByYear(state.statements).map((group) => (
              <section key={group.year} aria-labelledby={`my-pay-year-${group.year}`}>
                <h2 id={`my-pay-year-${group.year}`} className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{group.year}</h2>
                <ul className="space-y-3">
                  {group.statements.map((statement) => <StatementCard key={statement.id} statement={statement} contractor={contractor} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
