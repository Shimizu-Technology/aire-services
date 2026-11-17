import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AdminUser } from '../../lib/api'
import { peopleApi } from '../../lib/api/people'
import { todayInGuam } from '../../lib/payPeriods'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { Button, ChecklistItem, ConfirmDialog, ErrorState, Field, Input, Sheet, Textarea, buttonClasses } from '../ui'
import { personName } from './personFormat'
import { dataOrThrow, useLoadable } from './useLoadable'

export function EndEmploymentFlow({ user, onClose, onEnded }: { user: AdminUser; onClose: () => void; onEnded: (user: AdminUser) => void }) {
  const phone = useMediaQuery('(max-width: 639px)')
  const name = personName(user)
  const [date, setDate] = useState(todayInGuam())
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const loaded = useLoadable(`${user.id}:${date}:${retry}`, async () => dataOrThrow(await peopleApi.terminationPreview(user.id, date), "Couldn't check this person's open work.").preview, "Couldn't check this person's open work.")
  const preview = loaded.status === 'ready' ? loaded.value : null
  const blocked = !preview || preview.open_clock || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T12:00:00+10:00`).getTime()) || date > todayInGuam() || preview.admin_edit_version !== (user.admin_edit_version ?? 0)
  const end = async () => {
    if (blocked || saving || (phone && typed !== name)) return
    setSaving(true); setError('')
    const response = await peopleApi.terminate(user.id, { admin_edit_version: user.admin_edit_version ?? 0, effective_on: date, confirm_name: name, reason: note.trim() || undefined })
    setSaving(false)
    if (!response.data) { setError(response.error || "Couldn't end employment."); return }
    onEnded(response.data.user)
    onClose()
  }
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00+10:00`) : new Date(NaN)
  const validDate = Number.isFinite(parsedDate.getTime())
  const dayLabel = validDate ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Pacific/Guam' }).format(parsedDate) : 'the last day worked'
  const consequences = preview ? [
    { count: preview.open_pay_stub_links, text: `${preview.open_pay_stub_links} open pay stub link${preview.open_pay_stub_links === 1 ? '' : 's'} revoked.` },
    { count: preview.open_pay_stub_requests, text: `${preview.open_pay_stub_requests} open pay stub request${preview.open_pay_stub_requests === 1 ? '' : 's'} closed.` },
    { count: preview.pending_leave_requests, text: `${preview.pending_leave_requests} pending leave request${preview.pending_leave_requests === 1 ? ' is' : 's are'} cancelled, regardless of dates.` },
    { count: preview.approved_leave_requests, text: `${preview.approved_leave_requests} approved leave request${preview.approved_leave_requests === 1 ? '' : 's'} starting after ${dayLabel} cancelled. Earlier approved leave stays unchanged.` },
  ] : []
  const details = <div className="space-y-4">
    <Field label="Last day worked" required><Input type="date" max={todayInGuam()} value={date} disabled={saving} onChange={e => setDate(e.target.value)} /></Field>
    <Field label="Internal note (optional)"><Textarea maxLength={1000} value={note} disabled={saving} onChange={e => setNote(e.target.value)} /></Field>
    <div><h3 className="font-semibold text-ink">Before you confirm</h3>
      {loaded.status === 'loading' && <p role="status" className="py-3 text-body-sm">Checking open work and links…</p>}
      {loaded.status === 'error' && <ErrorState title="Couldn't check open work." description={loaded.message} onRetry={() => setRetry(value => value + 1)} />}
      {preview && <>
        <ul className="mt-2 divide-y divide-line rounded-control border border-line">
          <ChecklistItem status={preview.waiting_shifts || preview.waiting_overtime_hours ? 'todo' : 'done'} action={<Link className={buttonClasses({ variant: 'secondary', size: 'sm' })} to={`/admin/timecards?user_id=${user.id}`}>Review</Link>}>
            {`${preview.waiting_shifts} ${preview.waiting_shifts === 1 ? 'shift' : 'shifts'} (${preview.waiting_hours.toFixed(1)}h) and ${preview.waiting_overtime_hours.toFixed(1)}h overtime still waiting`}
          </ChecklistItem>
          <ChecklistItem status={preview.open_clock ? 'todo' : 'done'}>{preview.open_clock ? 'Clocked in right now: clock them out first.' : 'Not clocked in right now.'}</ChecklistItem>
          <ChecklistItem status="info">Waiting hours still go to payroll once approved.</ChecklistItem>
        </ul>
        <h3 className="mt-4 font-semibold text-ink">What changes</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-ink-muted">
          <li>Personal sign-in, kiosk PIN and My Pay turn off.</li>
          {consequences.filter(item => item.count > 0).map(item => <li key={item.text}>{item.text}</li>)}
          <li>Their website profile is hidden. Their hours and paychecks stay.</li>
        </ul>
        {consequences.some(item => item.count === 0) && <details className="mt-2"><summary>Other details</summary><ul className="list-disc pl-5">{consequences.filter(item => item.count === 0).map(item => <li key={item.text}>{item.text}</li>)}</ul></details>}
        {preview.admin_edit_version !== (user.admin_edit_version ?? 0) && <p role="alert" className="mt-3 text-body-sm text-danger">This person changed. Close this dialog and reload their page before ending employment.</p>}
      </>}
    </div>
    {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
  </div>
  if (!phone) return <ConfirmDialog open title={`End ${name}'s employment`} tone="danger" details={details} requireText={name}
    confirmLabel="End employment" confirmDisabled={blocked} busy={saving} onConfirm={() => void end()} onCancel={onClose} />
  return <Sheet open onClose={() => { if (!saving) onClose() }} title={`End ${name}'s employment`}
    footer={<div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Button variant="secondary" className="flex-1" disabled={saving} onClick={onClose}>Cancel</Button>
      <Button variant="danger" className="flex-1" loading={saving} disabled={blocked || typed !== name} onClick={() => void end()}>End employment</Button></div>}>
    {details}
    <Field className="mt-4" label={`Type ${name} to confirm`}><Input value={typed} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={saving} onChange={e => setTyped(e.target.value)} /></Field>
  </Sheet>
}
