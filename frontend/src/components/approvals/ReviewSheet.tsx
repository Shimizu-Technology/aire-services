import { useEffect, useRef, useState } from 'react'
import { api, type TimeCategory, type TimeEntry } from '../../lib/api'
import { approvalsApi, type HistoryChange, type ReviewEntry, type ReviewItem } from '../../lib/api/approvals'
import { addDateDays, businessWeekStart, formatWorkDate } from '../../lib/dateUtils'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Button, ErrorState, Field, Sheet, StatusPill, Textarea } from '../ui'
import EditTimeEntryModal from '../time-tracking/EditTimeEntryModal'

const when = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
export default function ReviewSheet({ entry, onClose, onApprove, onReload, busy, categories, onDirty }: {
  entry: ReviewEntry; onClose: (saved?: boolean) => void; onApprove: (items: ReviewItem[], label: string) => Promise<boolean>
  onReload: () => Promise<void>; busy: boolean; categories: TimeCategory[]; onDirty: (dirty: boolean) => void
}) {
  const online = useOnlineStatus()
  const [history, setHistory] = useState<HistoryChange[] | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [week, setWeek] = useState<TimeEntry[] | null>(null)
  const [weekError, setWeekError] = useState('')
  const [denying, setDenying] = useState<'time' | 'overtime' | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const lock = useRef(false)
  const overtime = entry.overtime_status === 'pending'
  useEffect(() => { onDirty(Boolean(note.trim())); return () => onDirty(false) }, [note, onDirty])
  useEffect(() => {
    let active = true
    approvalsApi.history(entry.id).then(response => { if (active) { setHistory(response.data?.changes ?? null); setHistoryError(!response.data) } })
    return () => { active = false }
  }, [entry.id, historyAttempt])
  useEffect(() => {
    let active = true
    const start = businessWeekStart(entry.work_date)
    api.getTimeEntries({ user_id: entry.user.id, start_date: start, end_date: addDateDays(start, 6), per_page: 500 }).then(response => {
      if (!active) return
      if (response.data) setWeek(response.data.time_entries)
      else setWeekError(response.error || "Couldn't load this week's shifts.")
    })
    return () => { active = false }
  }, [entry.user.id, entry.work_date])
  const approve = async (includeOvertime: boolean) => {
    if (lock.current || busy || !online) return
    lock.current = true
    try {
      const ok = await onApprove([{ id: entry.id, version: entry.version, approve_time: entry.approval_status === 'pending', approve_overtime: includeOvertime,
        ...(includeOvertime ? { overtime_hours: entry.pending_overtime_hours ?? 0 } : {}) }], includeOvertime ? `Approved ${(entry.pending_overtime_hours ?? 0).toFixed(1)}h overtime for ${entry.user.full_name}` : `Approved time for ${entry.user.full_name}`)
      if (ok) { onDirty(false); onClose(true) }
      else setError('This decision could not be saved. The list has been refreshed; close this review and check the shift again.')
    } finally { lock.current = false }
  }
  const deny = async () => {
    if (lock.current || !online || !note.trim() || !denying) return
    lock.current = true; setSaving(true); setError('')
    try {
      const response = denying === 'overtime' ? await api.denyOvertime(entry.id, note.trim()) : await api.denyTimeEntry(entry.id, note.trim())
      if (!response.data) { setError(response.error || "Couldn't save the denial."); return }
      onDirty(false); await onReload(); onClose(true)
    } finally { lock.current = false; setSaving(false) }
  }
  const blocked = busy || saving || !online || entry.needs_another_approver
  return <>
    <Sheet open title={`Review ${entry.user.full_name}`} description={formatWorkDate(entry.work_date)} onClose={() => { if (!busy && !saving) onClose() }}
      footer={<div className="flex flex-wrap gap-2">
        {denying ? <><Button variant="secondary" onClick={() => setDenying(null)} disabled={saving}>Back</Button><Button variant="danger" onClick={() => { void deny() }} loading={saving} disabled={blocked || !note.trim()} title={!online ? 'Reconnect to deny' : undefined}>Deny {denying === 'overtime' ? 'overtime' : 'shift'}</Button></>
          : <>
            {entry.approval_status === 'pending' && <Button onClick={() => { void approve(false) }} disabled={blocked} title={!online ? 'Reconnect to approve' : undefined}>Approve time</Button>}
            {overtime && <Button onClick={() => { void approve(true) }} disabled={blocked || entry.pending_overtime_hours === undefined} title={!online ? 'Reconnect to approve' : undefined}>Approve {(entry.pending_overtime_hours ?? 0).toFixed(1)}h overtime</Button>}
            <Button variant="secondary" onClick={() => setDenying(overtime ? 'overtime' : 'time')} disabled={blocked} title={!online ? 'Reconnect to deny' : undefined}>Deny{overtime ? ' overtime' : ''}…</Button>
            {entry.approval_status === 'pending' && overtime && <Button variant="ghost" onClick={() => setDenying('time')} disabled={blocked}>Deny shift…</Button>}
          </>}
      </div>}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1">{entry.exceptions.map(reason => <StatusPill key={reason.key} tone="waiting">{reason.label}</StatusPill>)}</div>
        <dl className="space-y-1 text-body-sm"><div><dt className="inline font-semibold">Time: </dt><dd className="inline">{entry.formatted_start_time || entry.start_time || '—'}–{entry.formatted_end_time || entry.end_time || '—'} · {entry.hours.toFixed(1)}h</dd></div><div><dt className="inline font-semibold">Category: </dt><dd className="inline">{entry.time_category?.name || 'No work category'}</dd></div><div><dt className="inline font-semibold">Break: </dt><dd className="inline">{entry.break_minutes ?? 0} minutes</dd></div><div><dt className="inline font-semibold">Time approval: </dt><dd className="inline">{entry.approval_status || 'Standard'}</dd></div></dl>
        {entry.description && <p className="text-body-sm">{entry.description}</p>}
        {entry.approval_note && <p className="text-body-sm text-ink-muted">{entry.approval_note}</p>}
        <Button variant="ghost" onClick={() => setEditing(true)} disabled={blocked} title={!online ? 'Reconnect to edit' : undefined}>Edit…</Button>
        {overtime && <section className="space-y-2"><h3 className="font-semibold">This week's shifts</h3>{weekError ? <ErrorState title="Couldn't load this week's shifts." description={weekError} /> : week ? <>
          <p className="text-body-sm">{week.reduce((sum, row) => sum + row.hours, 0).toFixed(1)}h this week · {(entry.pending_overtime_hours ?? 0).toFixed(1)}h overtime waiting on this shift</p>
          <ul className="divide-y divide-line text-body-sm">{week.map(row => <li key={row.id} className="py-2">{formatWorkDate(row.work_date)} · {row.hours.toFixed(1)}h · {row.approval_status || 'standard'}{row.id === entry.id ? ' · Shift being reviewed' : ''}</li>)}</ul>
        </> : <p className="text-body-sm">Loading week's shifts…</p>}</section>}
        <section className="space-y-3"><h3 className="font-semibold">Change history</h3>
          {historyError ? <ErrorState title="Couldn't load the change history." onRetry={() => setHistoryAttempt(value => value + 1)} /> : history === null ? <p className="text-body-sm">Loading change history…</p> : history.length === 0 ? <p className="text-body-sm text-ink-muted">No change history recorded.</p> : <ol className="space-y-4">{history.map((change, index) => <li key={`${change.at}-${index}`} className="space-y-1 border-l-2 border-line pl-3 text-body-sm">
            <p className="font-medium">{change.sentence}</p><p className="text-ink-muted">{change.actor?.full_name || 'System'} · {when(change.at)}</p>
            {change.fields.map(field => <p key={field.field} className="break-words">{field.label}: {field.before === null ? 'Not recorded' : String(field.before)} → {field.after === null ? 'Not recorded' : String(field.after)}</p>)}
            {change.reason && <p>Reason: {change.reason}</p>}
          </li>)}</ol>}
        </section>
        {denying && <Field label={`Why is this denied? ${entry.user.full_name.split(' ')[0]} will see this.`} required><Textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} /></Field>}
        {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
      </div>
    </Sheet>
    <EditTimeEntryModal isOpen={editing} entry={entry} canManageTeamTime canDelete={false} onDeleted={() => {}} categories={categories} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void onReload(); onClose() }} onError={message => setError(message || '')} />
  </>
}
