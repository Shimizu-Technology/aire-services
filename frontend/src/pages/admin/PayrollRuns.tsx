import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  api,
  type PayrollBatchDetail,
  type PayrollBatchIssues,
  type PayrollBatchListItem,
  type PayrollBatchPayload,
  type PayrollCarryoverItem,
  type PayrollCarryoverQueue,
} from '../../lib/api'
import TimePayrollWorkspaceHeader from '../../components/time-tracking/TimePayrollWorkspaceHeader'
import {
  formatPayrollDate,
  isIsoDate,
  payrollPeriodFromSearchParams,
  withPayrollPeriod,
  type PayrollPeriod,
} from '../../lib/payrollPeriods'

const ISSUE_LABELS: Array<[keyof PayrollBatchIssues, string]> = [
  ['pending_approval_count', 'Pending approval'],
  ['denied_approval_count', 'Denied'],
  ['open_clock_count', 'Still clocked in'],
  ['pending_overtime_count', 'Pending overtime'],
  ['denied_overtime_count', 'Denied overtime'],
  ['missing_category_count', 'Missing category'],
  ['negative_adjustment_count', 'Negative correction'],
]

const EXCLUSION_LABELS: Record<string, string> = {
  pending_approval: 'Pending approval',
  denied_approval: 'Denied',
  open_clock: 'Still clocked in',
  pending_overtime: 'Overtime pending approval',
  denied_overtime: 'Overtime denied',
  created_after_cutoff: 'Created after cutoff',
  approved_after_cutoff: 'Approved after cutoff',
  overtime_approved_after_cutoff: 'Overtime approved after cutoff',
}

const CARRYOVER_STATUS: Record<PayrollCarryoverItem['status'], { label: string; detail: string; className: string }> = {
  awaiting_approval: { label: 'Needs approval', detail: 'Not payable until an authorized reviewer approves it.', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  ready_for_next_batch: { label: 'Ready for next cutoff', detail: 'Approved after the earlier cutoff. AIRE will include it automatically in the next finalized batch.', className: 'border-cyan-200 bg-cyan-50 text-cyan-800' },
  awaiting_cornerstone: { label: 'Finalized in AIRE', detail: 'Included in a finalized batch and waiting to be imported into Cornerstone.', className: 'border-indigo-200 bg-indigo-50 text-indigo-800' },
  imported: { label: 'Imported to Cornerstone', detail: 'Cornerstone has added these hours to a draft payroll.', className: 'border-blue-200 bg-blue-50 text-blue-800' },
  committed: { label: 'Payroll committed', detail: 'Cornerstone has committed the payroll containing these hours.', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  payment_issued: { label: 'Payment issued', detail: 'Cornerstone reported that payment was issued.', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  payment_failed: { label: 'Payment needs attention', detail: 'Cornerstone reported a payment problem that needs review.', className: 'border-red-200 bg-red-50 text-red-800' },
  not_payable: { label: 'Not payable', detail: 'This entry was denied, removed, or otherwise closed without payment.', className: 'border-slate-200 bg-slate-100 text-slate-700' },
}

function formatDate(value: string) {
  return formatPayrollDate(value)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Guam',
  }).format(new Date(value))
}

function formatHours(value: number) {
  return `${Number(value).toFixed(2)} hrs`
}

function localDateTimeToIso(value: string) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function processingLabel(batch: PayrollBatchListItem) {
  if (batch.processing?.status === 'committed' && batch.processing.external_system === 'cornerstone_payroll_manual') {
    return 'Processed manually'
  }
  return batch.processing ? CARRYOVER_STATUS[batch.processing.status].label : 'Finalized in AIRE'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function SummaryCards({ payload }: { payload: PayrollBatchPayload }) {
  const items = [
    ['Employees', payload.summary.employee_count],
    ['Hours included', formatHours(payload.summary.total_hours)],
    ['Regular', formatHours(payload.summary.regular_hours)],
    ['Overtime', formatHours(payload.summary.overtime_hours)],
    ['Carried forward', payload.summary.carryover_count],
    ['Excluded', payload.summary.exclusion_count],
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
        </div>
      ))}
    </div>
  )
}

function CarryoverQueue({ queue, loading, error }: { queue: PayrollCarryoverQueue | null; loading: boolean; error: string | null }) {
  const activeItems = queue?.items.filter((item) => item.status !== 'not_payable') || []
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="carryover-queue-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Unpaid time lifecycle</p>
          <h2 id="carryover-queue-title" className="mt-1 text-xl font-semibold text-slate-950">Carryover queue</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Hours excluded from an earlier cutoff stay here until they are approved, included in a later batch, and acknowledged by Cornerstone.</p>
        </div>
        {queue && <p className="text-xs text-slate-500">{activeItems.length} active item{activeItems.length === 1 ? '' : 's'}</p>}
      </div>

      {loading && <p className="mt-5 rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading carryover status…</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!loading && !error && queue && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Needs approval', queue.summary.awaiting_approval_count],
              ['Ready for cutoff', queue.summary.ready_for_next_batch_count],
              ['In payroll', queue.summary.in_payroll_count],
              ['Closed unpaid', queue.summary.not_payable_count],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
              </div>
            ))}
          </div>
          {queue.truncated && <p className="mt-4 text-xs text-amber-800">Showing the first 250 carryover records. The complete history remains in AIRE.</p>}
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {activeItems.length === 0 && <p className="rounded-xl bg-emerald-50 px-4 py-5 text-sm text-emerald-800">No unpaid carryover items need attention.</p>}
            {activeItems.map((item) => {
              const status = CARRYOVER_STATUS[item.status]
              return (
                <article key={item.source_time_entry_id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-950">{item.display_name}</h3>
                      <p className="mt-1 text-xs text-slate-600">{item.category?.name || 'Category unavailable'} · {formatDate(item.original_work_date)} · entry #{item.source_time_entry_id}</p>
                    </div>
                    <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>{formatHours(item.current_total_hours ?? item.held_total_hours)}</span>
                    <span>Originally excluded: {EXCLUSION_LABELS[item.exclusion_reason] || item.exclusion_reason}</span>
                  </div>
                  <p className="mt-3 text-sm leading-5 text-slate-600">{status.detail}</p>
                  {item.included_batch && <p className="mt-2 text-xs text-slate-500">Later batch: {formatDate(item.included_batch.start_date)}–{formatDate(item.included_batch.end_date)} · {item.included_batch.id}</p>}
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function issueDestination(key: keyof PayrollBatchIssues, period: PayrollPeriod) {
  if (key === 'pending_approval_count' || key === 'pending_overtime_count') {
    return withPayrollPeriod('/admin/time', period, { tab: 'approvals', through_date: period.end })
  }
  if (key === 'denied_approval_count') {
    return withPayrollPeriod('/admin/time', period, { tab: 'reports', approval_status: 'denied' })
  }
  if (key === 'denied_overtime_count') {
    return withPayrollPeriod('/admin/time', period, { tab: 'reports', overtime_status: 'denied' })
  }
  if (key === 'negative_adjustment_count') return '/admin/activity?event_category=payroll'
  if (key === 'missing_category_count') {
    return withPayrollPeriod('/admin/time', period, { tab: 'reports', category_status: 'uncategorized' })
  }
  return withPayrollPeriod('/admin/time', period, { tab: 'reports', approval_status: 'all' })
}

function IssueSummary({ issues, period }: { issues: PayrollBatchIssues; period: PayrollPeriod }) {
  const active = ISSUE_LABELS.filter(([key]) => issues[key] > 0)
  if (active.length === 0) {
    return <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">No unresolved or blocking items were found for this cutoff.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {active.map(([key, label]) => {
        const blocking = key === 'missing_category_count'
        return (
          <Link key={key} to={issueDestination(key, period)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${blocking ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {issues[key]} {label}
          </Link>
        )
      })}
    </div>
  )
}

function BatchContents({ payload }: { payload: PayrollBatchPayload }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Included ledger</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">What this cutoff sends to payroll</h2>
          </div>
          <p className="text-xs text-slate-500">{payload.summary.adjustment_count} adjustments</p>
        </div>
        <div className="mt-5 space-y-4">
          {payload.employees.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No approved hours are included in this period.</p>}
          {payload.employees.map((employee) => (
            <article key={employee.source_user_id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-950">{employee.display_name}</h3>
                  <p className="text-xs text-slate-500">{employee.email || 'Kiosk-only team member'}</p>
                </div>
                <p className="text-sm font-semibold text-slate-800">{formatHours(employee.total_hours)}</p>
              </div>
              <div className="mt-3 space-y-2">
                {employee.adjustments.map((adjustment) => (
                  <div key={`${adjustment.source_time_entry_id}-${adjustment.line_key}`} className="grid gap-2 rounded-xl bg-slate-50 px-3 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <p className="font-medium text-slate-800">{adjustment.category?.name || 'Category missing'} · {formatDate(adjustment.original_work_date)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{adjustment.source_kind === 'current' ? 'Current period' : adjustment.source_kind === 'carryover' ? 'Late approval carried forward' : 'Correction to a prior payroll cutoff'}</p>
                    </div>
                    <div className="text-left text-xs text-slate-600 sm:text-right">
                      <p className="font-semibold text-slate-900">{formatHours(adjustment.total_hours)}</p>
                      <p>{adjustment.regular_hours.toFixed(2)} regular · {adjustment.overtime_hours.toFixed(2)} OT</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Tracked, not paid</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">Excluded at this cutoff</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Pending and open work stays attached to its original date. If later approved, AIRE carries it into the next payroll cutoff automatically.</p>
        <div className="mt-5 space-y-2">
          {payload.exclusions.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">Nothing is excluded.</p>}
          {payload.exclusions.map((item) => (
            <div key={`${item.source_time_entry_id}-${item.reason}`} className="rounded-xl border border-slate-200 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{EXCLUSION_LABELS[item.reason] || item.reason}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.display_name} · {item.category?.name || 'Category missing'}</p>
                  <p className="mt-1 text-xs text-slate-500">Entry #{item.source_time_entry_id} · {formatDate(item.original_work_date)}</p>
                </div>
                <span className="whitespace-nowrap text-xs font-semibold text-slate-700">{formatHours(item.held_total_hours)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function FinalizeDialog({ payload, onClose, onConfirm, submitting, error }: {
  payload: PayrollBatchPayload
  onClose: () => void
  onConfirm: (note?: string) => void
  submitting: boolean
  error: string | null
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [note, setNote] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const submittingRef = useRef(submitting)
  const needsCorrectionNote = Boolean(payload.requires_negative_adjustment_acknowledgement)

  useEffect(() => {
    closeRef.current = onClose
    submittingRef.current = submitting
  }, [onClose, submitting])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) {
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  const canSubmit = confirmed && (!needsCorrectionNote || note.trim().length >= 10) && !submitting
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="finalize-title" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl outline-none">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Final confirmation</p>
        <h2 id="finalize-title" className="mt-2 text-2xl font-semibold text-slate-950">Finalize this payroll cutoff?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">This creates a permanent payroll batch for {formatDate(payload.start_date)}–{formatDate(payload.end_date)}. Time entries remain editable, but later approvals and corrections are recorded in a future batch.</p>

        {needsCorrectionNote && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">This batch contains {payload.issues.negative_adjustment_count} negative correction{payload.issues.negative_adjustment_count === 1 ? '' : 's'}.</p>
            <label className="mt-3 block text-sm font-medium text-amber-950" htmlFor="negative-note">Correction explanation</label>
            <textarea id="negative-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Explain why the prior payroll amount is being corrected…" />
            <p className="mt-1 text-xs text-amber-800">At least 10 characters. This note becomes part of the permanent audit record.</p>
          </div>
        )}

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
          <span className="text-sm leading-6 text-slate-700">I reviewed the included hours and exclusions and understand that this finalized batch cannot be changed.</span>
        </label>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Keep reviewing</button>
          <button type="button" onClick={() => onConfirm(note.trim() || undefined)} disabled={!canSubmit} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Finalizing…' : 'Finalize payroll batch'}</button>
        </div>
      </div>
    </div>
  )
}

function ManualProcessingDialog({ period, onClose, onRecorded }: {
  period: PayrollPeriod
  onClose: () => void
  onRecorded: (batch: PayrollBatchDetail) => Promise<void>
}) {
  const [cutoffLocal, setCutoffLocal] = useState('')
  const [processedLocal, setProcessedLocal] = useState('')
  const [externalPayPeriodId, setExternalPayPeriodId] = useState('')
  const [note, setNote] = useState('')
  const [acknowledgeMissingCategories, setAcknowledgeMissingCategories] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [snapshot, setSnapshot] = useState<PayrollBatchPayload | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const submittingRef = useRef(submitting)

  useEffect(() => {
    closeRef.current = onClose
    submittingRef.current = submitting
  }, [onClose, submitting])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) {
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  const invalidateSnapshot = () => {
    setSnapshot(null)
    setConfirmed(false)
    setError(null)
  }

  const reviewSnapshot = async () => {
    const cutoffAt = localDateTimeToIso(cutoffLocal)
    if (!cutoffAt) {
      setError('Enter the date and time when the included hours were frozen for payroll.')
      return
    }
    setReviewing(true)
    setError(null)
    const response = await api.previewPayrollBatch(period.start, period.end, cutoffAt)
    if (response.data) setSnapshot(response.data)
    else setError(response.error || 'The historical payroll snapshot could not be reviewed.')
    setReviewing(false)
  }

  const processedAt = localDateTimeToIso(processedLocal)
  const cutoffAt = localDateTimeToIso(cutoffLocal)
  const missingCategories = snapshot?.issues.missing_category_count || 0
  const canRecord = Boolean(
    snapshot && cutoffAt && processedAt && externalPayPeriodId.trim() && note.trim().length >= 10 && confirmed &&
    new Date(processedAt || 0).getTime() >= new Date(cutoffAt || 0).getTime() &&
    (!missingCategories || acknowledgeMissingCategories) && !submitting,
  )

  const recordProcessed = async () => {
    if (!snapshot || !cutoffAt || !processedAt) return
    setSubmitting(true)
    setError(null)
    const response = await api.finalizePayrollBatch({
      start_date: period.start,
      end_date: period.end,
      manual_processing: true,
      cutoff_at: cutoffAt,
      processed_at: processedAt,
      external_pay_period_id: externalPayPeriodId.trim(),
      processing_note: note.trim(),
      acknowledge_missing_categories: acknowledgeMissingCategories,
      acknowledge_negative_adjustments: snapshot.issues.negative_adjustment_count > 0,
      negative_adjustment_note: snapshot.issues.negative_adjustment_count > 0 ? note.trim() : undefined,
    })
    if (response.data) await onRecorded(response.data)
    else setError(response.error || 'The manually processed payroll could not be recorded.')
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="manual-processing-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl outline-none sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Historical reconciliation</p>
        <h2 id="manual-processing-title" className="mt-2 text-2xl font-semibold text-slate-950">Record payroll processed outside the integration</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">Use this only when payroll was already calculated manually. First recreate the exact AIRE snapshot used at that time, then record the matching Cornerstone period. This does not mark individual checks as paid.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Hours frozen at
            <input type="datetime-local" step="1" value={cutoffLocal} onChange={(event) => { setCutoffLocal(event.target.value); invalidateSnapshot() }} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" />
            <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Guam time. Hours approved after this moment stay unpaid and carry forward.</span>
          </label>
          <label className="text-sm font-medium text-slate-700">Cornerstone processed at
            <input type="datetime-local" step="1" value={processedLocal} onChange={(event) => setProcessedLocal(event.target.value)} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" />
            <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">Use the committed timestamp from Cornerstone.</span>
          </label>
        </div>

        <button type="button" onClick={() => void reviewSnapshot()} disabled={reviewing || !cutoffLocal} className="mt-4 min-h-11 w-full rounded-xl border border-primary px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50">{reviewing ? 'Recreating snapshot…' : snapshot ? 'Refresh historical snapshot' : 'Review historical snapshot'}</button>

        {snapshot && (
          <div className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">Snapshot to be recorded</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Hours', formatHours(snapshot.summary.total_hours)],
                ['Employees', snapshot.summary.employee_count],
                ['Excluded', snapshot.summary.exclusion_count],
                ['Missing category', snapshot.issues.missing_category_count],
              ].map(([label, value]) => <div key={label} className="rounded-xl bg-white px-3 py-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-950">{value}</p></div>)}
            </div>
            <p className="mt-3 text-xs leading-5 text-cyan-900">Cutoff: {formatDateTime(snapshot.cutoff_at)}. Compare the included totals and exclusions below with the payroll already processed.</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-cyan-100 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Included employee totals</p>
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                  {snapshot.employees.map((employee) => <div key={employee.source_user_id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm"><span className="truncate text-slate-700">{employee.display_name}</span><span className="shrink-0 font-semibold text-slate-950">{formatHours(employee.total_hours)}</span></div>)}
                </div>
              </div>
              <div className="rounded-xl border border-cyan-100 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Excluded at this cutoff</p>
                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                  {snapshot.exclusions.length === 0 && <p className="px-2 py-1.5 text-sm text-slate-500">Nothing excluded.</p>}
                  {snapshot.exclusions.map((item) => <div key={`${item.source_time_entry_id}-${item.reason}`} className="rounded-lg px-2 py-1.5"><div className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-slate-700">{item.display_name}</span><span className="shrink-0 font-semibold text-slate-950">{formatHours(item.held_total_hours)}</span></div><p className="text-xs text-slate-500">{EXCLUSION_LABELS[item.reason] || item.reason} · {formatDate(item.original_work_date)}</p></div>)}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Cornerstone pay period ID
            <input value={externalPayPeriodId} onChange={(event) => setExternalPayPeriodId(event.target.value)} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" placeholder="For example, 61" />
          </label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">Reconciliation note
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" placeholder="Explain how this snapshot was matched to the payroll already processed…" />
            <span className="mt-1 block text-xs font-normal text-slate-500">At least 10 characters. This becomes part of the permanent audit record.</span>
          </label>
        </div>

        {snapshot && missingCategories > 0 && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <input type="checkbox" checked={acknowledgeMissingCategories} onChange={(event) => setAcknowledgeMissingCategories(event.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
            <span className="text-sm leading-6 text-amber-950">I confirm these {missingCategories} legacy uncategorized entries were included in the payroll already processed. New payroll cutoffs remain blocked until categories are fixed.</span>
          </label>
        )}

        {snapshot && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 accent-primary" />
            <span className="text-sm leading-6 text-slate-700">I compared this historical AIRE snapshot with Cornerstone and confirm it represents the hours that were actually processed. I understand the record cannot be changed.</span>
          </label>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void recordProcessed()} disabled={!canRecord} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Recording…' : 'Record as processed manually'}</button>
        </div>
      </div>
    </div>
  )
}

export default function PayrollRuns() {
  const [searchParams, setSearchParams] = useSearchParams()
  const routedPeriod = payrollPeriodFromSearchParams(searchParams)
  const [startDate, setStartDate] = useState(() => routedPeriod.start)
  const [endDate, setEndDate] = useState(() => routedPeriod.end)
  const [preview, setPreview] = useState<PayrollBatchPayload | null>(null)
  const [batches, setBatches] = useState<PayrollBatchListItem[]>([])
  const [carryovers, setCarryovers] = useState<PayrollCarryoverQueue | null>(null)
  const [carryoversLoading, setCarryoversLoading] = useState(true)
  const [carryoversError, setCarryoversError] = useState<string | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showManualProcessing, setShowManualProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyTruncated, setHistoryTruncated] = useState(false)
  const [historyTotalCount, setHistoryTotalCount] = useState(0)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const historyRequestSequence = useRef(0)
  const carryoverRequestSequence = useRef(0)
  const previewRequestSequence = useRef(0)
  const batchRequestSequence = useRef(0)
  const internalPeriodNavigation = useRef<string | null>(null)
  const displayedPeriodKey = useRef(`${routedPeriod.start}|${routedPeriod.end}`)

  useEffect(() => { document.title = 'Payroll Cutoffs | AIRE Ops' }, [])

  const syncPeriodToUrl = useCallback((period: PayrollPeriod) => {
    const periodKey = `${period.start}|${period.end}`
    internalPeriodNavigation.current = periodKey
    displayedPeriodKey.current = periodKey
    const next = new URLSearchParams(searchParams)
    next.set('start_date', period.start)
    next.set('end_date', period.end)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const routeKey = `${routedPeriod.start}|${routedPeriod.end}`
    if (internalPeriodNavigation.current === routeKey) {
      internalPeriodNavigation.current = null
      return
    }
    if (displayedPeriodKey.current === routeKey) return
    displayedPeriodKey.current = routeKey
    batchRequestSequence.current += 1

    const timer = window.setTimeout(() => {
      setStartDate(routedPeriod.start)
      setEndDate(routedPeriod.end)
      previewRequestSequence.current += 1
      setPreviewing(false)
      setPreview(null)
      setSelectedBatch(null)
      setShowConfirm(false)
      setDialogError(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [routedPeriod.end, routedPeriod.start])

  const loadBatches = useCallback(async () => {
    const requestSequence = ++historyRequestSequence.current
    const response = await api.getPayrollBatches()
    if (requestSequence !== historyRequestSequence.current) return

    if (response.data) {
      setBatches(response.data.payroll_batches)
      setHistoryTruncated(response.data.truncated)
      setHistoryTotalCount(response.data.total_count)
      setHistoryError(null)
    } else setHistoryError(response.error || 'Payroll history could not be loaded.')
    setLoading(false)
  }, [])

  const loadCarryovers = useCallback(async () => {
    const requestSequence = ++carryoverRequestSequence.current
    setCarryoversLoading(true)
    const response = await api.getPayrollCarryovers()
    if (requestSequence !== carryoverRequestSequence.current) return
    if (response.data) {
      setCarryovers(response.data)
      setCarryoversError(null)
    } else setCarryoversError(response.error || 'The carryover queue could not be loaded.')
    setCarryoversLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void Promise.all([loadBatches(), loadCarryovers()]) }, 0)
    return () => window.clearTimeout(timer)
  }, [loadBatches, loadCarryovers])

  const runPreview = async () => {
    const requestSequence = ++previewRequestSequence.current
    setPreviewing(true)
    setError(null)
    setSelectedBatch(null)
    setShowConfirm(false)
    setDialogError(null)
    const response = await api.previewPayrollBatch(startDate, endDate)
    if (requestSequence !== previewRequestSequence.current) return

    if (response.data) setPreview(response.data)
    else {
      setPreview(null)
      setShowConfirm(false)
      setError(response.error || 'The payroll cutoff could not be previewed.')
    }
    setPreviewing(false)
  }

  const clearPreviewForDateChange = () => {
    previewRequestSequence.current += 1
    setPreviewing(false)
    setPreview(null)
    setShowConfirm(false)
  }

  const updateStartDate = (value: string) => {
    setStartDate(value)
    if (isIsoDate(value) && isIsoDate(endDate) && value <= endDate) {
      syncPeriodToUrl({ start: value, end: endDate })
    }
    clearPreviewForDateChange()
  }

  const updateEndDate = (value: string) => {
    setEndDate(value)
    if (isIsoDate(startDate) && isIsoDate(value) && startDate <= value) {
      syncPeriodToUrl({ start: startDate, end: value })
    }
    clearPreviewForDateChange()
  }

  const finalize = async (note?: string) => {
    if (!preview) return
    setFinalizing(true)
    setDialogError(null)
    const response = await api.finalizePayrollBatch({
      start_date: startDate,
      end_date: endDate,
      acknowledge_negative_adjustments: Boolean(note),
      negative_adjustment_note: note,
    })
    if (response.data) {
      setShowConfirm(false)
      setPreview(null)
      setSelectedBatch(response.data)
      await Promise.all([loadBatches(), loadCarryovers()])
    } else {
      setDialogError(response.error || 'The payroll batch could not be finalized.')
    }
    setFinalizing(false)
  }

  const openBatch = async (id: string) => {
    const requestSequence = ++batchRequestSequence.current
    setError(null)
    const response = await api.getPayrollBatch(id)
    if (requestSequence !== batchRequestSequence.current) return
    if (response.data) {
      setSelectedBatch(response.data)
      setStartDate(response.data.start_date)
      setEndDate(response.data.end_date)
      syncPeriodToUrl({ start: response.data.start_date, end: response.data.end_date })
      setPreview(null)
      setShowConfirm(false)
    } else setError(response.error || 'The payroll batch could not be loaded.')
  }

  const exportBatch = async (id: string) => {
    const response = await api.downloadPayrollBatch(id)
    if (response.blob) downloadBlob(response.blob, response.filename || `${id}.csv`)
    else setError(response.error || 'The payroll batch could not be exported.')
  }

  const manualProcessingRecorded = async (batch: PayrollBatchDetail) => {
    setShowManualProcessing(false)
    setPreview(null)
    setSelectedBatch(batch)
    await Promise.all([loadBatches(), loadCarryovers()])
  }

  const activePayload = selectedBatch?.payload || preview
  const localPeriodIsValid = isIsoDate(startDate) && isIsoDate(endDate) && startDate <= endDate
  const activePeriod = activePayload
    ? { start: activePayload.start_date, end: activePayload.end_date }
    : localPeriodIsValid
      ? { start: startDate, end: endDate }
      : routedPeriod
  return (
    <div className="space-y-6">
      <TimePayrollWorkspaceHeader activeSection="payroll" isAdmin period={activePeriod} />

      <section className="flex flex-col gap-4 border-l-4 border-primary bg-white/65 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Authoritative payroll record</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Payroll Cutoffs</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Preview exactly which approved hours will be included, then freeze an immutable AIRE batch for Cornerstone Payroll. Pending work stays tracked and carries forward only after approval.</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Link to={withPayrollPeriod('/admin/time', activePeriod, { tab: 'approvals', through_date: activePeriod.end })} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">Review approvals</Link>
          <Link to={withPayrollPeriod('/admin/time', activePeriod, { tab: 'reports' })} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-cyan-300 hover:text-cyan-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">View live hours</Link>
        </div>
      </section>

      <CarryoverQueue queue={carryovers} loading={carryoversLoading} error={carryoversError} />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm font-medium text-slate-700">Period start
            <input type="date" value={startDate} onChange={(event) => updateStartDate(event.target.value)} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" />
          </label>
          <label className="text-sm font-medium text-slate-700">Period end
            <input type="date" value={endDate} onChange={(event) => updateEndDate(event.target.value)} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" />
          </label>
          <button type="button" onClick={runPreview} disabled={previewing || !isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">{previewing ? 'Calculating…' : 'Preview cutoff'}</button>
        </div>
        <div className="mt-4 rounded-xl bg-primary/5 px-4 py-3 text-sm leading-6 text-primary">
          Finalizing locks the payroll snapshot, not the underlying time entries. A later edit creates an auditable correction in the next payroll cutoff.
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {historyError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{historyError}</p>}
      {historyTruncated && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Showing the newest {batches.length} of {historyTotalCount} finalized payroll batches. Older batches remain stored and available through the payroll API.</p>}

      {activePayload && (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{selectedBatch ? 'Finalized batch' : 'Live preview'}</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">{formatDate(activePayload.start_date)}–{formatDate(activePayload.end_date)}</h2>
              {selectedBatch && <p className="mt-1 text-sm text-slate-500">{selectedBatch.id} · finalized {formatDateTime(selectedBatch.finalized_at)}</p>}
              {selectedBatch?.processing && <p className="mt-1 text-sm font-medium text-emerald-700">{processingLabel(selectedBatch)} · Cornerstone period {selectedBatch.processing.external_pay_period_id || 'not provided'} · {formatDateTime(selectedBatch.processing.occurred_at)}</p>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {selectedBatch && <Link to={`/admin/activity?event_category=payroll&search=${encodeURIComponent(`${selectedBatch.start_date} through ${selectedBatch.end_date}`)}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">View activity</Link>}
              {selectedBatch && <button type="button" onClick={() => void exportBatch(selectedBatch.id)} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Download finalized CSV</button>}
              {preview && <button type="button" onClick={() => setShowManualProcessing(true)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-primary/40 hover:text-primary">Record already processed</button>}
              {preview && <button type="button" onClick={() => { setDialogError(null); setShowConfirm(true) }} disabled={!preview.can_finalize} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">Finalize this cutoff</button>}
            </div>
          </div>
          <IssueSummary issues={activePayload.issues} period={{ start: activePayload.start_date, end: activePayload.end_date }} />
          {preview && !preview.can_finalize && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Finalization is blocked until every included entry has a work category.</p>}
          <SummaryCards payload={activePayload} />
          <BatchContents payload={activePayload} />
        </>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Permanent ledger</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Finalized payroll batches</h2>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {loading && <p className="text-sm text-slate-500">Loading payroll history…</p>}
          {!loading && batches.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">No payroll batches have been finalized yet.</p>}
          {batches.map((batch) => (
            <button key={batch.id} type="button" onClick={() => void openBatch(batch.id)} className="rounded-2xl border border-slate-200 p-4 text-left transition hover:border-primary/30 hover:bg-primary/5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">{formatDate(batch.start_date)}–{formatDate(batch.end_date)}</p>
                  <p className="mt-1 text-xs text-slate-500">{batch.id}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${batch.processing?.status === 'committed' || batch.processing?.status === 'payment_issued' ? 'bg-emerald-50 text-emerald-700' : batch.processing?.status === 'imported' ? 'bg-blue-50 text-blue-700' : batch.processing?.status === 'payment_failed' ? 'bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-700'}`}>{processingLabel(batch)}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                <span>{formatHours(batch.summary.total_hours)}</span>
                <span>{batch.summary.employee_count} employees</span>
                <span>{batch.summary.exclusion_count} excluded</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {showConfirm && preview && <FinalizeDialog payload={preview} onClose={() => setShowConfirm(false)} onConfirm={finalize} submitting={finalizing} error={dialogError} />}
      {showManualProcessing && <ManualProcessingDialog period={{ start: startDate, end: endDate }} onClose={() => setShowManualProcessing(false)} onRecorded={manualProcessingRecorded} />}
    </div>
  )
}
