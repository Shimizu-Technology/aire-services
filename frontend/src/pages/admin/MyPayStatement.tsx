import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronRight, Download } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { MyPayErrorState, StatementDetailSkeleton, StatusBadge } from '../../components/my-pay/MyPayParts'
import { formatDateOnly } from '../../lib/dateUtils'
import { useMyPayScope } from '../../lib/myPayScope'
import {
  MyPayError,
  formatHours,
  formatMoney,
  formatPayDate,
  formatPeriod,
  paymentMethodLabel,
  paymentStatus,
  runPurposeLabel,
  type MyPayEarning,
  type MyPayHoursLine,
  type MyPayStatementDetail,
  type MyPayWithholding,
  type MyPayWorker,
} from '../../lib/myPayApi'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: MyPayError }
  | { status: 'ready'; worker: MyPayWorker; statement: MyPayStatementDetail }

const rateFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })

function sum(lines: { amount: string }[]): string {
  const cents = lines.reduce((total, line) => total + Math.round(Number(line.amount) * 100), 0)
  return (cents / 100).toFixed(2)
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 id={id} className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
      </div>
      {children}
    </section>
  )
}

// Stub labels can put a work-date note on its own line; keep that break and
// let long labels wrap instead of widening the row.
const labelClass = 'whitespace-pre-line break-words font-medium text-slate-900'

function earningDetail(line: MyPayEarning, contractor: boolean): string | null {
  // Salary and flat-fee rows have no hours; show the rate the paper stub prints.
  if (!line.hours && line.rate && line.pay_basis === 'salary') return `${formatMoney(line.rate)}/yr salary`
  if (!line.hours && line.rate && line.pay_basis === 'contractor') return `${formatMoney(line.rate)} contract fee`
  if (!line.hours) return null
  const hours = formatHours(line.hours)
  if (!line.rate) return hours
  // A contractor row with a note was paid above the contract rate; the note says how.
  return `${hours} × ${rateFormat.format(Number(line.rate))}${contractor && !line.note ? '/hr contract rate' : '/hr'}`
}

// Paid on an earlier check this year but not on this one: the paper stub
// prints these as $0.00 rows with a year-to-date amount.
function isEarlierThisYear(line: MyPayEarning): boolean {
  return Number(line.amount) === 0 && !line.hours && line.ytd != null && Number(line.ytd) !== 0
}

const ytdGrid = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]'

function YtdCell({ value }: { value: string | null | undefined }) {
  // Mobile shows a labeled line only when the stub has a YTD for the row; the
  // desktop column keeps the stub's dash so rows stay aligned.
  return (
    <p className={`col-span-2 text-sm tabular-nums text-slate-600 sm:col-span-1 sm:text-right ${value == null ? 'hidden sm:block' : ''}`}>
      <span className="sm:sr-only">Year to date: </span>{formatMoney(value)}
    </p>
  )
}

function EarningsSection({ earnings, gross, grossYtd, contractor }: { earnings: MyPayEarning[]; gross: string | null; grossYtd: string | null; contractor: boolean }) {
  const earlier = earnings.filter(isEarlierThisYear)
  const current = earnings.filter((line) => !isEarlierThisYear(line))
  const showYtd = earnings.some((line) => line.ytd != null)
  return (
    <Section title={contractor ? 'Contract pay' : 'Earnings'}>
      {current.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-600 sm:px-5">No line items were included on this statement.</p>
      ) : (
        <>
          {showYtd && (
            <div aria-hidden="true" className={`hidden border-b border-slate-100 px-5 pt-2 pb-1.5 text-xs font-medium text-slate-500 sm:grid ${ytdGrid}`}>
              <span />
              <span className="text-right">This check</span>
              <span className="text-right">Year to date</span>
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {current.map((line, index) => {
              const detail = earningDetail(line, contractor)
              return (
                <li key={`${line.label}-${index}`} className={`${showYtd ? ytdGrid : 'flex justify-between gap-4'} items-start px-4 py-3 sm:px-5`}>
                  <div className="min-w-0">
                    <p className={labelClass}>{line.label}</p>
                    {detail && <p className="mt-0.5 text-sm tabular-nums text-slate-600">{detail}</p>}
                    {line.note && <p className="mt-0.5 text-sm text-slate-600">{line.note}</p>}
                  </div>
                  <p className="shrink-0 text-right font-semibold tabular-nums text-slate-900">{formatMoney(line.amount)}</p>
                  {showYtd && <YtdCell value={line.ytd} />}
                </li>
              )
            })}
          </ul>
        </>
      )}
      <div className={`${showYtd ? ytdGrid : 'flex justify-between gap-4'} items-center border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5 ${earlier.length === 0 ? 'rounded-b-2xl' : ''}`}>
        <p className="font-semibold text-slate-900">{contractor ? 'Total before deductions' : 'Gross pay'}</p>
        <p className="text-right font-bold tabular-nums text-slate-950">{formatMoney(gross)}</p>
        {showYtd && <YtdCell value={grossYtd} />}
      </div>
      {earlier.length > 0 && (
        <details className="group rounded-b-2xl border-t border-slate-100">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-b-2xl px-4 group-open:rounded-none py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-600 sm:px-5 [&::-webkit-details-marker]:hidden">
            <span>Earlier this year · {earlier.length} {earlier.length === 1 ? 'item' : 'items'}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <div className="px-4 pb-3 sm:px-5">
            <p className="text-sm text-slate-600">
              Paid on earlier {contractor ? 'payments' : 'checks'} this year, not on this one. Included in year to date, not in {contractor ? 'this total' : 'gross pay'}.
            </p>
            <ul className="mt-2 divide-y divide-slate-100">
              {earlier.map((line, index) => (
                <li key={`${line.label}-${index}`} className={`${ytdGrid} items-baseline py-2.5`}>
                  <p className="whitespace-pre-line break-words text-sm text-slate-700">{line.label}</p>
                  {/* Nothing on this check; only the year-to-date column applies. */}
                  <span aria-hidden="true" className="hidden sm:block" />
                  <p className="text-right text-sm tabular-nums text-slate-600"><span className="sm:sr-only">Year to date: </span>{formatMoney(line.ytd)}</p>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </Section>
  )
}

function WithholdingSection({ title, description, lines, emptyText }: { title: string; description?: string; lines: MyPayWithholding[]; emptyText: string }) {
  return (
    <Section title={title} description={description}>
      {lines.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-600 sm:px-5">{emptyText}</p>
      ) : (
        <>
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem] gap-x-4 border-b border-slate-100 px-5 pt-2 pb-1.5 text-xs font-medium text-slate-500 sm:grid">
            <span />
            <span className="text-right">This check</span>
            <span className="text-right">Year to date</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {lines.map((line, index) => (
              <li key={`${line.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:px-5">
                <p className={labelClass}>{line.label}</p>
                <p className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(line.amount)}</p>
                <p className="col-span-2 text-sm tabular-nums text-slate-600 sm:col-span-1 sm:text-right">
                  <span className="sm:sr-only">Year to date: </span>{formatMoney(line.ytd)}
                </p>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:px-5">
            <p className="font-semibold text-slate-900">Total {title.toLowerCase()}</p>
            <p className="text-right font-bold tabular-nums text-slate-950">{formatMoney(sum(lines))}</p>
          </div>
        </>
      )}
    </Section>
  )
}

function hoursBreakdown(line: MyPayHoursLine): string | null {
  if (!line.overtime_hours || Number(line.overtime_hours) === 0) return null
  return `${formatHours(line.regular_hours)} regular · ${formatHours(line.overtime_hours)} overtime`
}

function HoursSection({ lines, statementId, contractor }: { lines: MyPayHoursLine[]; statementId: string; contractor: boolean }) {
  const scope = useMyPayScope()
  return (
    <Section title="Hours on this check">
      {lines.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-600 sm:px-5">This {contractor ? 'payment' : 'paycheck'} doesn&apos;t list individual time entries.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {lines.map((line, index) => {
            const workedOn = line.work_date ? formatDateOnly(line.work_date, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date not recorded'
            const breakdown = contractor ? null : hoursBreakdown(line)
            const href = scope.entryHref(line, statementId)
            const content = (
              <>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{workedOn}</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {line.category || 'Work'}
                    {breakdown && <span className="tabular-nums"> · {breakdown}</span>}
                  </p>
                  {line.prior_period && (
                    <p className="mt-1.5 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                      {line.work_date ? `Worked ${formatDateOnly(line.work_date, { month: 'short', day: 'numeric' })} · paid on this check` : 'Earlier hours · paid on this check'}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <p className="font-semibold tabular-nums text-slate-900">{formatHours(line.total_hours)}</p>
                  {href && <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                </div>
              </>
            )
            return (
              <li key={`${line.time_entry_id ?? 'line'}-${index}`}>
                {href ? (
                  <Link
                    to={href}
                    aria-label={`Open ${workedOn} time entry in ${scope.timeLabel}, ${formatHours(line.total_hours)}`}
                    className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-600 sm:px-5"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

// How the net figure is reached, in the order the stub applies it:
// gross - taxes - deductions + other pay = net.
function NetPayMath({ statement, contractor, otherPay }: { statement: MyPayStatementDetail; contractor: boolean; otherPay: MyPayWithholding[] }) {
  const signed = (sign: '−' | '+', amount: string) => `${Number(amount) === 0 ? '' : sign}${formatMoney(amount)}`
  const parts = [
    { label: contractor ? 'Before deductions' : 'Gross', value: formatMoney(statement.gross_pay) },
    ...(contractor ? [] : [{ label: 'Taxes', value: signed('−', sum(statement.taxes)) }]),
    { label: 'Deductions', value: signed('−', sum(statement.deductions)) },
    // A YTD-only other pay row (nothing added this check) stays in its section, not in this math.
    ...(Number(sum(otherPay)) !== 0 ? [{ label: 'Other pay', value: signed('+', sum(otherPay)) }] : []),
  ]
  const columns = parts.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : parts.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
  return (
    <dl className={`mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm ${columns}`}>
      {parts.map((part) => (
        <div key={part.label}>
          <dt className="text-slate-500">{part.label}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{part.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function DownloadButton({ statementId, payDate }: { statementId: string; payDate: string | null }) {
  const { source } = useMyPayScope()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const { blob, filename } = await source.pdf(statementId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename || `AIRE-pay-statement-${payDate || statementId}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (caught) {
      setError(caught instanceof MyPayError ? caught.message : 'The PDF could not be downloaded. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-100 hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98] disabled:opacity-70 motion-reduce:transition-none sm:w-auto"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {busy ? 'Preparing PDF…' : 'Download PDF stub'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}

export default function MyPayStatement() {
  const { id = '' } = useParams()
  const { currentUser, isClerkEnabled } = useAuthContext()
  const scope = useMyPayScope()
  const { source } = scope
  const enabled = scope.isEnabled(currentUser)
  const [attempt, setAttempt] = useState(0)
  // Results are keyed by statement and attempt, so a new ID or a retry shows
  // the skeleton without resetting state inside the effect.
  const requestKey = `${id}:${attempt}`
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null)
  const state: LoadState = result?.key === requestKey ? result.state : { status: 'loading' }

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    source.statement(id, controller.signal)
      .then((data) => setResult({ key: requestKey, state: { status: 'ready', worker: data.worker, statement: data.statement } }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setResult({ key: requestKey, state: { status: 'error', error: error instanceof MyPayError ? error : new MyPayError('Pay history is temporarily unavailable. Please try again in a few minutes.', 'network') } })
      })
    return () => controller.abort()
  }, [enabled, id, requestKey, source])

  const back = (
    <Link to={scope.listHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-cyan-700 hover:text-cyan-900 focus-visible:outline-2 focus-visible:outline-cyan-600">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      All pay
    </Link>
  )

  if (!enabled && (currentUser || !isClerkEnabled)) {
    return (
      <div className="mx-auto max-w-3xl">
        {back}
        <p className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">My Pay isn&apos;t available for your account yet.</p>
      </div>
    )
  }

  if (state.status !== 'ready') {
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy={state.status === 'loading'}>
        {back}
        {state.status === 'loading' ? (
          <>
            <h1 className="sr-only">Loading paycheck</h1>
            <StatementDetailSkeleton />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Paycheck</h1>
            <MyPayErrorState error={state.error} onRetry={retry} />
          </>
        )}
      </div>
    )
  }

  const { statement, worker } = state
  const contractor = worker.contractor
  const status = paymentStatus(statement.payment, statement.pay_date)
  const otherPay = statement.other_pay ?? []
  const purpose = runPurposeLabel(statement.run_purpose)
  const kind = contractor ? 'Payment statement' : 'Paycheck'
  const payDate = formatPayDate(statement.pay_date)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {back}

      <section aria-labelledby="my-pay-statement-title" className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="my-pay-statement-title" className="text-sm font-semibold text-slate-600">
            {kind} · <span className="text-slate-900">{payDate}</span>
          </h1>
          {status.badge && <StatusBadge label={status.label} tone={status.tone} />}
        </div>
        <p className="mt-4 text-sm font-medium text-slate-500">{contractor ? 'Total payment' : 'Net pay'}</p>
        <p className="font-display text-4xl font-bold tracking-tight tabular-nums text-slate-950 sm:text-5xl">{formatMoney(statement.net_pay)}</p>
        <p className="mt-2 text-sm text-slate-600">
          {formatPeriod(statement.period_start, statement.period_end)}
          {purpose && ` · ${purpose}`}
          {statement.total_hours && ` · ${formatHours(statement.total_hours)}`}
        </p>
        <NetPayMath statement={statement} contractor={contractor} otherPay={otherPay} />
        <div className="mt-5">
          {statement.payment?.status === 'voided'
            ? <p className="text-sm text-slate-600">This {contractor ? 'payment' : 'check'} was voided, so there&apos;s no stub to download.</p>
            : <DownloadButton statementId={statement.id} payDate={statement.pay_date} />}
        </div>
      </section>

      <EarningsSection earnings={statement.earnings} gross={statement.gross_pay} grossYtd={statement.ytd.gross} contractor={contractor} />
      {!contractor && <WithholdingSection title="Taxes" lines={statement.taxes} emptyText="No taxes were withheld from this check." />}
      <WithholdingSection title="Deductions" lines={statement.deductions} emptyText={`No deductions were taken from this ${contractor ? 'payment' : 'check'}.`} />
      {otherPay.length > 0 && (
        <WithholdingSection
          title="Other pay"
          description={contractor ? 'Reimbursements and other pay added to your payment.' : 'Reimbursements and other non-taxable pay, added after taxes and deductions.'}
          lines={otherPay}
          emptyText=""
        />
      )}

      <Section title="Year to date">
        <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:px-5">
          <div>
            <dt className="text-sm text-slate-500">{contractor ? 'Paid before deductions' : 'Gross pay'}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{formatMoney(statement.ytd.gross)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-500">{contractor ? 'Total paid' : 'Net pay'}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{formatMoney(statement.ytd.net)}</dd>
          </div>
        </dl>
      </Section>

      <HoursSection lines={statement.hours_on_check} statementId={statement.id} contractor={contractor} />

      <Section title="Payment">
        <dl className="divide-y divide-slate-100 text-sm">
          <div className="flex justify-between gap-4 px-4 py-3 sm:px-5">
            <dt className="shrink-0 text-slate-500">Status</dt>
            <dd className="text-right">
              <span className="font-semibold text-slate-900">{status.label}</span>
              {status.explanation && <span className="mt-1 block text-slate-600">{status.explanation}</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3 sm:px-5">
            <dt className="text-slate-500">Method</dt>
            <dd className="text-right font-medium text-slate-900">{paymentMethodLabel(statement.payment.method, statement.payment.check_number_last4)}</dd>
          </div>
          {statement.payment.issued_on && (
            <div className="flex justify-between gap-4 px-4 py-3 sm:px-5">
              <dt className="text-slate-500">{statement.payment.method === 'direct_deposit' ? 'Deposited on' : 'Issued on'}</dt>
              <dd className="font-medium text-slate-900">{formatPayDate(statement.payment.issued_on)}</dd>
            </div>
          )}
        </dl>
      </Section>

      <p className="px-1 pb-4 text-xs text-slate-500">
        Your paper stub is the official record of this {contractor ? 'payment' : 'paycheck'}. Questions about your pay? Ask an AIRE administrator.
      </p>
    </div>
  )
}
