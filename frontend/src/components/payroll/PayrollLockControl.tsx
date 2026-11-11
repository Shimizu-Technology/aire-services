import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Clock, Lock, RotateCcw } from 'lucide-react'
import { api, type PayrollLockAction, type PayrollLockControl as LockControlState, type PayrollLockPendingChange } from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { earliestLockChange, formatLockTime, fromGuamInput, lockDistance, toGuamInput } from '../../lib/lockTime'
import { Button, Field, HelpTip, Input, Textarea } from '../ui'

interface Props {
  /** Compact fits inside the dashboard payroll readiness card. */
  variant?: 'full' | 'compact'
}

const shortDate = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00+10:00`))
const LATE_HOURS = 'Hours clocked or approved after the lock go to the next pay period as late hours. Nothing is lost.'
const POLL_MS = 3_000
const POLL_LIMIT = 10

function periodLabel(control: LockControlState) {
  return `${shortDate(control.period.start_date)}–${shortDate(control.period.end_date)}`
}

/** Self-contained: fetches its own state so it can move to a future pay-period page. */
export default function PayrollLockControl({ variant = 'full' }: Props) {
  const capabilities = useCapabilities()
  const [control, setControl] = useState<LockControlState | null | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [dialog, setDialog] = useState<PayrollLockAction | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const helpId = useId()
  const pollTimer = useRef<number | null>(null)
  // Count down from the server's clock, as the cutoff notice does, not the device's.
  const serverOffset = useRef(0)

  const load = useCallback(async () => {
    const result = await api.getPayrollCutoff()
    if (result.data) {
      const serverNow = Date.parse(result.data.cutoff?.now ?? '')
      if (Number.isFinite(serverNow)) serverOffset.current = serverNow - Date.now()
      setNow(new Date(Date.now() + serverOffset.current))
      setControl(result.data.lock_control ?? null)
      setLoadError(false)
      return result.data.lock_control ?? null
    }
    setLoadError(true)
    return undefined
  }, [])

  useEffect(() => {
    if (!capabilities.manage_payroll) return
    const run = () => load()
    void run()
    const tick = window.setInterval(() => setNow(new Date(Date.now() + serverOffset.current)), 60_000)
    return () => { window.clearInterval(tick); if (pollTimer.current) window.clearTimeout(pollTimer.current) }
  }, [capabilities.manage_payroll, load])

  // Cornerstone republishes the period a few seconds after accepting a change.
  const waitForPublication = useCallback(async (previous: LockControlState) => {
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      await new Promise(resolve => { pollTimer.current = window.setTimeout(resolve, POLL_MS) })
      const next = await load()
      if (next === undefined || (next && next.period.id === previous.period.id && next.publication_id === previous.publication_id)) continue
      setWaiting(false)
      if (!next || next.period.id !== previous.period.id) setNotice(`AIRE locked the ${periodLabel(previous)} hours.`)
      else if (next.cutoff_state === 'due' || Date.parse(next.cutoff_at) <= Date.now() + serverOffset.current) setNotice('AIRE is locking these hours now.')
      else setNotice(`AIRE now locks at ${formatLockTime(next.cutoff_at)}.`)
      return
    }
    setWaiting(false)
    setNotice('Cornerstone Payroll accepted the change. AIRE will show it as soon as the update arrives; refresh in a minute.')
  }, [load])

  if (!capabilities.manage_payroll || control === undefined && !loadError) return null
  if (loadError && !control) {
    return variant === 'full'
      ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">The next lock time could not be loaded. <button type="button" onClick={() => void load()} className="min-h-11 font-semibold underline">Try again</button></p>
      : null
  }
  if (!control) {
    return variant === 'full'
      ? <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">No scheduled AIRE lock is published yet. Cornerstone Payroll publishes each pay period.</p>
      : null
  }

  const compact = variant === 'compact'
  const changed = control.cutoff_source === 'override' && control.override
  const busy = waiting
  // Lock now leaves a past cutoff until the finalizer runs; never count down to it.
  const locking = control.cutoff_state === 'due' || Date.parse(control.cutoff_at) <= now.getTime()

  return (
    <section aria-labelledby={`${helpId}-title`} className={compact ? 'mt-4 rounded-xl border border-primary/15 bg-primary/5 p-4' : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Next AIRE lock · {periodLabel(control)} hours</p>
          <h2 id={`${helpId}-title`} className={`mt-1 font-semibold text-slate-950 ${compact ? 'text-base' : 'text-xl'}`}>
            {locking ? 'Locking now' : <>Locks {formatLockTime(control.cutoff_at)} <span className="font-normal text-slate-600">({lockDistance(control.cutoff_at, now)})</span></>}
          </h2>
          {changed && control.override && (
            <p className="mt-1 break-words text-sm text-slate-700">
              Changed by {control.override.set_by_name || 'an admin'}: {control.override.reason}
            </p>
          )}
          {changed && !compact && <p className="mt-1 text-sm text-slate-500">Default was {formatLockTime(control.default_cutoff_at)}.</p>}
        </div>
        <HelpTip
          label="the lock time"
          className="mt-0.5 shrink-0"
          what={<>At the lock time AIRE freezes this pay period’s hours and sends them to Cornerstone Payroll. {LATE_HOURS}</>}
          defaultValue="5:00 PM Guam time, 7 days after the last regular payday."
          who="AIRE owners and admins, and Cornerstone Payroll organization admins. Every change needs a reason and is recorded in both apps."
        />
      </div>

      {control.pending_change && <PendingChangeNote change={control.pending_change} />}

      {control.can_change ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {control.can_lock_now && (
            <Button disabled={busy} onClick={() => setDialog('lock_now')} icon={<Lock className="size-4" />}>Lock now</Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => setDialog('change')} icon={<Clock className="size-4" />}>Change lock time</Button>
          {control.can_reset && (
            <Button variant="ghost" disabled={busy} onClick={() => setDialog('reset')} icon={<RotateCcw className="size-4" />}>Reset to default</Button>
          )}
        </div>
      ) : control.unavailable_reason && !locking && (
        <p className="mt-3 text-sm text-slate-600">{control.unavailable_reason}.</p>
      )}

      {notice && <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{notice}</p>}

      {dialog && (
        <LockTimeDialog
          action={dialog}
          control={control}
          now={now}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null)
            setNotice(message)
            setWaiting(true)
            void waitForPublication(control)
          }}
        />
      )}
    </section>
  )
}

/** A change requested from AIRE that Cornerstone accepted but AIRE hasn't applied. */
function PendingChangeNote({ change }: { change: PayrollLockPendingChange }) {
  const target = change.action === 'lock_now' ? 'Lock now'
    : change.action === 'reset' ? 'the reset to the default time'
      : change.cutoff_at ? `the change to ${formatLockTime(change.cutoff_at)}` : 'the change'
  if (change.state === 'rejected') {
    return (
      <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <p className="font-semibold">AIRE couldn’t apply {target}{change.error ? `: ${change.error}` : '.'}</p>
        <p className="mt-1">The lock time above is still in effect. Lock now or choose a new time to replace it.</p>
      </div>
    )
  }
  return (
    <p role="status" className="mt-3 rounded-xl border border-primary/15 bg-white px-3 py-2 text-sm text-slate-700">
      <span className="font-semibold text-slate-900">Waiting for {target} to arrive from Cornerstone Payroll.</span> Until it does, AIRE keeps the lock time above.
    </p>
  )
}

const TITLES: Record<PayrollLockAction, string> = { lock_now: 'Lock hours now?', change: 'Change lock time', reset: 'Reset to the default lock time?' }
const CONFIRM: Record<PayrollLockAction, string> = { lock_now: 'Lock now', change: 'Save lock time', reset: 'Reset to default' }

function LockTimeDialog({ action, control, now, onClose, onDone }: {
  action: PayrollLockAction
  control: LockControlState
  now: Date
  onClose: () => void
  onDone: (message: string) => void
}) {
  // The server's earliest time ages while the page is open; never offer less than 15 minutes ahead.
  const serverMin = toGuamInput(control.earliest_cutoff_at)
  const leadMin = toGuamInput(earliestLockChange(now).toISOString())
  const min = leadMin > serverMin ? leadMin : serverMin
  const max = toGuamInput(control.latest_cutoff_at)
  const current = toGuamInput(control.cutoff_at)
  const [cutoffInput, setCutoffInput] = useState(() => (current < min ? min : current > max ? max : current))
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestId] = useState(() => crypto.randomUUID())
  const dialogRef = useRef<HTMLDivElement>(null)
  const ids = useId()
  useDialogFocus(true, dialogRef, () => { if (!submitting) onClose() })

  const period = periodLabel(control)
  const chosen = action === 'change' ? fromGuamInput(cutoffInput) : null
  const outOfRange = action === 'change' && (!chosen || cutoffInput < min || cutoffInput > max)
  const minLabel = formatLockTime(fromGuamInput(min)!)
  // Saving the time AIRE already has would be refused.
  const unchanged = action === 'change' && cutoffInput === current

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim()) { setError('Enter a reason for the change.'); return }
    if (outOfRange) { setError(`Choose a time between ${minLabel} and ${formatLockTime(control.latest_cutoff_at)}.`); return }
    setSubmitting(true)
    setError(null)
    const result = await api.changePayrollLockTime({
      external_pay_period_id: control.period.external_pay_period_id,
      publication_id: control.publication_id,
      lock_action: action,
      reason: reason.trim(),
      request_id: requestId,
      ...(chosen ? { cutoff_at: chosen } : {}),
    })
    setSubmitting(false)
    if (result.error || !result.data) { setError(result.error || 'The lock time could not be changed. Nothing changed.'); return }
    const at = result.data.cutoff_change.cutoff_at
    onDone(action === 'lock_now'
      ? 'Cornerstone Payroll accepted Lock now. Updating AIRE…'
      : `Cornerstone Payroll accepted ${formatLockTime(at)}. Updating AIRE…`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 sm:items-center">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} aria-describedby={`${ids}-effect`} tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        <form onSubmit={submit} noValidate>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{period} hours</p>
          <h2 id={`${ids}-title`} className="mt-1 text-xl font-semibold text-slate-950">{TITLES[action]}</h2>
          <div id={`${ids}-effect`} className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {action === 'lock_now' && <p>AIRE locks the {period} hours right away instead of {formatLockTime(control.cutoff_at)}.</p>}
            {action === 'reset' && <p>The lock goes back to {formatLockTime(control.default_cutoff_at)}.</p>}
            {action === 'change' && <p>Now: {formatLockTime(control.cutoff_at)}. Default: {formatLockTime(control.default_cutoff_at)}.</p>}
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-950">{LATE_HOURS}</p>
          </div>

          {action === 'change' && (
            <Field className="mt-4" label="New lock time (Guam)" required
              help={<>{unchanged ? 'Choose a new time to save. ' : ''}Between {minLabel} (at least 15 minutes from now) and {formatLockTime(control.latest_cutoff_at)} (two days before payday).</>}>
              <Input type="datetime-local" value={cutoffInput} min={min} max={max} step={60}
                onChange={event => setCutoffInput(event.target.value)} />
            </Field>
          )}

          <Field className="mt-4" label="Reason" required help="Recorded in both apps with your name.">
            <Textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3}
              placeholder="For example: payday moved for the holiday" />
          </Field>

          {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" loading={submitting} loadingLabel="Sending…" disabled={unchanged}>{CONFIRM[action]}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
