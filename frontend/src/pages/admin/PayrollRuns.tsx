import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type PayrollBatchDetail,
  type PayrollBatchIssues,
  type PayrollBatchListItem,
  type PayrollBatchPayload,
} from '../../lib/api'

const ISSUE_LABELS: Array<[keyof PayrollBatchIssues, string]> = [
  ['pending_approval_count', 'Pending approval'],
  ['denied_approval_count', 'Denied'],
  ['open_clock_count', 'Still clocked in'],
  ['pending_overtime_count', 'Pending overtime'],
  ['denied_overtime_count', 'Denied overtime'],
  ['missing_category_count', 'Missing category'],
  ['missing_rate_count', 'Missing pay rate'],
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

function guamDateParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Guam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>
}

function defaultPeriod() {
  const { year, month, day } = guamDateParts()
  const dayNumber = Number(day)
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  return dayNumber <= 15
    ? { start: `${year}-${month}-01`, end: `${year}-${month}-15` }
    : { start: `${year}-${month}-16`, end: `${year}-${month}-${String(lastDay).padStart(2, '0')}` }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`))
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

function IssueSummary({ issues }: { issues: PayrollBatchIssues }) {
  const active = ISSUE_LABELS.filter(([key]) => issues[key] > 0)
  if (active.length === 0) {
    return <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">No unresolved or blocking items were found for this cutoff.</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {active.map(([key, label]) => {
        const blocking = key === 'missing_category_count' || key === 'missing_rate_count'
        return (
          <span key={key} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${blocking ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
            {issues[key]} {label}
          </span>
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
            <h2 className="mt-1 text-xl font-semibold text-slate-950">What this payroll run will pay</h2>
          </div>
          <p className="text-xs text-slate-500">{payload.summary.adjustment_count} adjustments</p>
        </div>
        <div className="mt-5 space-y-4">
          {payload.employees.length === 0 && <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No payable hours are included in this period.</p>}
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
                      <p className="mt-0.5 text-xs text-slate-500">{adjustment.source_kind === 'current' ? 'Current period' : adjustment.source_kind === 'carryover' ? 'Late approval carried forward' : 'Correction to a prior payroll run'}</p>
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
        <p className="mt-2 text-sm leading-6 text-slate-600">Pending and open work stays attached to its original date. If later approved, AIRE carries it into the next payroll run automatically.</p>
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

export default function PayrollRuns() {
  const initialPeriod = useMemo(() => defaultPeriod(), [])
  const [startDate, setStartDate] = useState(initialPeriod.start)
  const [endDate, setEndDate] = useState(initialPeriod.end)
  const [preview, setPreview] = useState<PayrollBatchPayload | null>(null)
  const [batches, setBatches] = useState<PayrollBatchListItem[]>([])
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyTruncated, setHistoryTruncated] = useState(false)
  const [historyTotalCount, setHistoryTotalCount] = useState(0)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const historyRequestSequence = useRef(0)

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

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadBatches() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadBatches])

  const runPreview = async () => {
    setPreviewing(true)
    setError(null)
    setSelectedBatch(null)
    setShowConfirm(false)
    setDialogError(null)
    const response = await api.previewPayrollBatch(startDate, endDate)
    if (response.data) setPreview(response.data)
    else {
      setPreview(null)
      setShowConfirm(false)
      setError(response.error || 'The payroll cutoff could not be previewed.')
    }
    setPreviewing(false)
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
      await loadBatches()
    } else {
      setDialogError(response.error || 'The payroll batch could not be finalized.')
    }
    setFinalizing(false)
  }

  const openBatch = async (id: string) => {
    setError(null)
    const response = await api.getPayrollBatch(id)
    if (response.data) {
      setSelectedBatch(response.data)
      setPreview(null)
      setShowConfirm(false)
    } else setError(response.error || 'The payroll batch could not be loaded.')
  }

  const exportBatch = async (id: string) => {
    const response = await api.downloadPayrollBatch(id)
    if (response.blob) downloadBlob(response.blob, response.filename || `${id}.csv`)
    else setError(response.error || 'The payroll batch could not be exported.')
  }

  const activePayload = selectedBatch?.payload || preview
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Payroll control</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Payroll Runs</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Choose a period, preview exactly what is payable at this moment, then create an immutable batch for payroll. Pending work is never lost—it stays tracked and carries forward only after approval.</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm font-medium text-slate-700">Period start
            <input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setPreview(null); setShowConfirm(false) }} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" />
          </label>
          <label className="text-sm font-medium text-slate-700">Period end
            <input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setPreview(null); setShowConfirm(false) }} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-primary" />
          </label>
          <button type="button" onClick={runPreview} disabled={previewing || !startDate || !endDate} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">{previewing ? 'Calculating…' : 'Preview cutoff'}</button>
        </div>
        <div className="mt-4 rounded-xl bg-primary/5 px-4 py-3 text-sm leading-6 text-primary">
          Finalizing locks the payroll snapshot, not the underlying time entries. A later edit creates an auditable correction in the next payroll run.
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
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {selectedBatch && <button type="button" onClick={() => void exportBatch(selectedBatch.id)} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Download CSV</button>}
              {preview && <button type="button" onClick={() => { setDialogError(null); setShowConfirm(true) }} disabled={!preview.can_finalize} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">Finalize this cutoff</button>}
            </div>
          </div>
          <IssueSummary issues={activePayload.issues} />
          {preview && !preview.can_finalize && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Finalization is blocked until every included entry has a work category and effective pay rate.</p>}
          <SummaryCards payload={activePayload} />
          <BatchContents payload={activePayload} />
        </>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Permanent ledger</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Finalized payroll history</h2>
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
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Finalized</span>
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
    </div>
  )
}
