import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, type HoursReportDownloadType, type PayrollBatchDetail } from '../../lib/api'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { downloadBlob } from '../../lib/download'
import { parsePayPeriodStart, todayInGuam, type PayPeriod } from '../../lib/payPeriods'
import { withPayrollPeriod } from '../../lib/payrollPeriods'
import { isLockedState, PAYROLL_WORDS } from '../../lib/payrollTerms'
import { useCapabilities } from '../../lib/useCapabilities'
import PayrollLockControl from '../../components/payroll/PayrollLockControl'
import PayrollRecords, { FinalizeDialog, ManualProcessingDialog } from '../../components/payroll/PayrollRecords'
import { BeforeLockChecklist } from '../../components/payroll/BeforeLockChecklist'
import { CarriedHours } from '../../components/payroll/CarriedHours'
import { EarlierPeriods } from '../../components/payroll/EarlierPeriods'
import { periodHref } from '../../components/payroll/payPeriodModel'
import { HandoffSteps } from '../../components/payroll/HandoffSteps'
import { PayStubsStep } from '../../components/payroll/PayStubsStep'
import { PeriodHeader } from '../../components/payroll/PeriodHeader'
import { blockLoad, usePayPeriodData } from '../../components/payroll/usePayPeriodData'
import { WhatGoesToPayroll } from '../../components/payroll/WhatGoesToPayroll'
import { ConnectionCard, PausedBanner } from '../../components/today/ConnectionCard'
import { periodLabel } from '../../components/today/format'
import { Button, ErrorState, Menu, PeriodStepper, useConfirm, type MenuItem, type StatusTone } from '../../components/ui'
import { Skeleton } from '../../components/ui/Skeleton'

const PAYROLL_RECORDS_PATH = '/admin/payroll/records'

/**
 * Which pay period an old `/admin/payroll?start_date=…&end_date=…` link means,
 * or null when it names a custom range that only the records page can show.
 */
function linkedPeriodStart(params: URLSearchParams): string | null | 'records' {
  const start = params.get('start_date')
  const end = params.get('end_date')
  if (!start && !end) return null
  const period = parsePayPeriodStart(start)
  return period && (!end || end === period.end) ? period.start : 'records'
}

/**
 * /admin/payroll (the current pay period) and /admin/payroll/periods/:start.
 * Old links keep landing: `?batch_id=` and custom date ranges open the
 * records page, and `?start_date=` for a pay period opens that period.
 */
export default function PayrollRuns() {
  const { start: routeStart } = useParams()
  const [params] = useSearchParams()
  const linked = linkedPeriodStart(params)
  if (params.has('batch_id') || linked === 'records') return <PayrollRecords />
  if (routeStart !== undefined && !parsePayPeriodStart(routeStart)) {
    return (
      <ErrorState
        title="That isn't a pay period."
        description="A pay period starts on the 1st or the 16th."
      />
    )
  }
  return <PayPeriodPage key={routeStart ?? linked ?? 'current'} requestedStart={routeStart ?? linked} />
}

function PayPeriodPage({ requestedStart }: { requestedStart: string | null }) {
  const capabilities = useCapabilities()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const data = usePayPeriodData(requestedStart)
  const { periods, show, range, isCurrent, attention, cutoff, connection, waiting, preview, batch, carryovers, now, refresh } = data
  const [dialog, setDialog] = useState<'manual' | 'finalize' | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const period = show.data?.period ?? null
  const published = show.data !== null && period !== null
  const locked = Boolean(period && isLockedState(period.handoff_state, period.status))
  // Paid before AIRE locked hours and never frozen here: no checklist and no "if it locked now".
  const beforeLocking = period?.handoff_state === 'before_locking' && !locked
  const label = range ? periodLabel({ start_date: range.start, end_date: range.end }) : null

  useEffect(() => {
    document.title = label ? `${label} pay period | AIRE Ops` : 'Pay period | AIRE Ops'
  }, [label])

  const connectionEnabled = periods.data?.connected_payroll.enabled === true
  const paused = periods.data?.connected_payroll.enabled === false || connection.data?.state === 'paused'
    || cutoff.data?.connected_payroll?.enabled === false
  const connectionPill: { label: string; tone: StatusTone } | null = paused
    ? { label: 'Payroll connection paused', tone: 'needs-fix' }
    : connection.data?.state === 'delivery_problem'
      ? { label: 'Payroll updates delayed', tone: 'waiting' }
      : connection.data
        // Same rule as the connection card: enabled, but nothing published, received or linked yet.
        ? connection.data.last_publication || connection.data.last_delivery || connection.data.account_link
          ? { label: 'Connected to Cornerstone Payroll', tone: 'approved' }
          : { label: 'Not connected yet', tone: 'off' }
        : null
  const control = cutoff.data?.lock_control && period && cutoff.data.lock_control.period.start_date === period.start_date
    ? cutoff.data.lock_control
    : null
  const currentStart = periods.data?.current_start_date ?? null
  const returnTo = `${location.pathname}${location.search}`
  const payload = locked ? batch.data?.payload ?? null : preview.data
  const payloadLoad = beforeLocking ? null : locked ? (period?.payroll_batch_id ? blockLoad(batch) : null) : blockLoad(preview)

  const exportReport = async (kind: 'pdf' | 'csv' | 'locked_csv', acknowledgeDraft = false) => {
    if (!range) return
    setExporting(kind)
    setExportError(null)
    try {
      if (kind === 'locked_csv') {
        const id = period?.payroll_batch_id
        if (!id) return
        const response = await api.downloadPayrollBatch(id)
        if (response.blob) downloadBlob(response.blob, response.filename || `${id}.csv`)
        else setExportError(response.error || 'The locked hours could not be downloaded.')
        return
      }
      const type: HoursReportDownloadType = kind === 'pdf' ? 'pdf' : 'summary_csv'
      const response = await api.downloadHoursReport(type, { start_date: range.start, end_date: range.end, status: 'all', approval_status: 'approved_or_standard' }, acknowledgeDraft)
      if (response.code === 'draft_acknowledgement_required' && !acknowledgeDraft) {
        const confirmed = await confirm({
          title: 'Download a clearly marked draft anyway?',
          description: 'This report includes approved entries without work categories.',
          confirmLabel: 'Download draft',
        })
        if (confirmed) await exportReport(kind, true)
        return
      }
      if (response.blob) downloadBlob(response.blob, response.filename || 'AIRE_Report')
      else setExportError(response.error || 'The report could not be downloaded.')
    } finally {
      setExporting(current => (current === kind ? null : current))
    }
  }

  const openBatch = (created: PayrollBatchDetail) => navigate(`${ADMIN_PATHS.payroll}?${new URLSearchParams({ batch_id: created.id })}`)

  const finalize = async (note?: string) => {
    if (!range || !preview.data) return
    setFinalizing(true)
    setDialogError(null)
    const response = await api.finalizePayrollBatch({
      start_date: range.start,
      end_date: range.end,
      acknowledge_negative_adjustments: Boolean(note),
      negative_adjustment_note: note,
    })
    setFinalizing(false)
    if (response.data) {
      setDialog(null)
      openBatch(response.data)
    } else setDialogError(response.error || 'The payroll batch could not be finalized.')
  }

  const menuItems: MenuItem[] = [
    ...(connectionEnabled && range ? [{ id: 'manual', label: `Record ${PAYROLL_WORDS.manualPayroll.toLowerCase()}…`, onSelect: () => setDialog('manual') }] : []),
    ...(connectionEnabled && show.data && !published ? [{
      id: 'finalize',
      label: 'Finalize without a published period…',
      disabled: !preview.data?.can_finalize || Boolean(preview.data?.published_calendar_periods?.length),
      onSelect: () => { setDialogError(null); setDialog('finalize') },
    }] : []),
    ...(range ? [{ id: 'report', label: 'Hours report for these dates', onSelect: () => navigate(withPayrollPeriod(ADMIN_PATHS.reports, range)) }] : []),
    { id: 'records', label: 'All payroll records', onSelect: () => navigate(PAYROLL_RECORDS_PATH) },
  ]

  // Only a failed lock gets the banner. A refused or expired lock-time change
  // is explained in the #170 lock control's own note, not twice.
  const lockProblem = period && !locked && isCurrent && period.status === 'failed'
    ? `AIRE couldn’t lock the ${label} hours. ${paused ? 'It tries again once the payroll connection is resumed.' : 'It tries again on its own.'}`
    : null

  const goToPeriod = (next: PayPeriod) => navigate(next.start === currentStart ? ADMIN_PATHS.payroll : periodHref(next.start))

  if (periods.error && !periods.data && requestedStart === null) {
    return <ErrorState title="Couldn't load the pay period." description={periods.error} onRetry={() => void refresh()} />
  }

  return (
    <div className="space-y-4">
      {!isCurrent && range && (
        <Link to={ADMIN_PATHS.payroll} className="inline-flex min-h-11 items-center text-body-sm font-semibold text-primary pointer-fine:min-h-0">
          Back to the current pay period
        </Link>
      )}

      {range ? (
        <PeriodHeader
          range={range}
          period={period}
          loaded={show.data !== null}
          control={control}
          paused={paused}
          connectionPill={connectionPill}
          now={now}
        >
          {/* The overflow sits beside the stepper so it never wraps onto a row of its own on a phone. */}
          <div className="mt-3 flex items-center gap-2">
            <PeriodStepper className="w-full max-w-xs" period={range} onChange={goToPeriod} max={currentStart ?? undefined} now={now} />
            <Menu label="More payroll actions" title="More" items={menuItems} triggerVariant="secondary" className="shrink-0" />
          </div>
        </PeriodHeader>
      ) : (
        <Skeleton className="h-20 w-full" />
      )}

      {paused && <PausedBanner />}

      {lockProblem && (
        <div role="alert" className="flex flex-col gap-3 rounded-card border border-red-200 bg-danger-soft px-4 py-3 text-body-sm text-red-900 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 font-semibold">{lockProblem}</p>
          <Button variant="secondary" size="sm" onClick={() => void refresh()} className="self-start sm:self-auto">Try again</Button>
        </div>
      )}

      {isCurrent && published && !locked && connectionEnabled && capabilities.manage_payroll && <PayrollLockControl />}

      {show.error && !show.data && (
        <ErrorState title="Couldn't load this pay period." description={show.error} onRetry={() => void refresh()} />
      )}

      {show.data && !published && range && (
        <section aria-label="No published pay period" className="rounded-card border border-line bg-surface px-4 py-3 text-body-sm text-ink-muted">
          {isCurrent
            ? <>Cornerstone Payroll hasn't published a pay period yet. Hours are still tracked. The manual tools are under More.</>
            : <>Cornerstone Payroll didn't publish a pay period for {label}. <Link className="font-semibold text-primary underline" to={withPayrollPeriod(PAYROLL_RECORDS_PATH, range)}>See its payroll records</Link></>}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {beforeLocking && range && (
            <p className="rounded-card border border-line bg-surface px-4 py-3 text-body-sm text-ink-muted">
              AIRE didn't lock hours for this pay period, so nothing went to payroll from here.{' '}
              <Link className="font-semibold text-primary underline" to={withPayrollPeriod(PAYROLL_RECORDS_PATH, range)}>See its payroll records</Link>
            </p>
          )}

          {range && show.data && !locked && !beforeLocking && (published || isCurrent) && (
            <BeforeLockChecklist
              range={range}
              today={todayInGuam(now)}
              attention={attention.data}
              preview={preview.data}
              waiting={waiting.data}
              previousStart={show.data.previous_start_date}
              sources={[
                { load: blockLoad(waiting), loadedAt: waiting.loadedAt },
                { load: blockLoad(preview), loadedAt: preview.loadedAt },
                ...(isCurrent ? [{ load: blockLoad(attention), loadedAt: attention.loadedAt }] : []),
              ]}
              onRetry={() => void refresh()}
            />
          )}

          {payloadLoad === 'loading' && <Skeleton className="h-48 w-full" />}
          {payloadLoad === 'error' && (
            <ErrorState title={locked ? "Couldn't load what went to payroll." : "Couldn't load what goes to payroll."} onRetry={() => void (locked ? batch.reload() : preview.reload())} />
          )}
          {payload && (
            <WhatGoesToPayroll
              payload={payload}
              locked={locked}
              initialOpen={params.get('user_id')}
              highlightEntry={params.get('entry_id')}
              returnTo={returnTo}
              exporting={exporting}
              onExport={kind => void exportReport(kind)}
              staleSince={payloadLoad === 'stale' ? (locked ? batch.loadedAt : preview.loadedAt) : undefined}
              onRetry={() => void (locked ? batch.reload() : preview.reload())}
            />
          )}
          {exportError && <p role="alert" className="rounded-card border border-red-200 bg-danger-soft px-4 py-3 text-body-sm text-red-900">{exportError}</p>}

          {locked && range && carryovers.data && (
            <CarriedHours items={carryovers.data.items} range={range} recordsHref={PAYROLL_RECORDS_PATH} />
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          {period && <HandoffSteps period={period} />}
          {capabilities.manage_payroll && (
            <ConnectionCard connection={connection.data} load={blockLoad(connection)} updatedAt={connection.loadedAt} now={now} onRetry={() => void connection.reload()} />
          )}
          {period && <PayStubsStep payDate={period.pay_date} today={todayInGuam(now)} />}
          {range && periods.data && <EarlierPeriods periods={periods.data.periods} before={range.start} />}
        </aside>
      </div>

      {dialog === 'manual' && range && (
        <ManualProcessingDialog
          period={range}
          onClose={() => setDialog(null)}
          onRecorded={async (created) => { setDialog(null); openBatch(created) }}
        />
      )}
      {dialog === 'finalize' && preview.data && (
        <FinalizeDialog payload={preview.data} onClose={() => setDialog(null)} onConfirm={finalize} submitting={finalizing} error={dialogError} />
      )}
      {confirmDialog}
    </div>
  )
}

