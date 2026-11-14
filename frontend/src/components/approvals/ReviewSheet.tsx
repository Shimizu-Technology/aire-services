import { useEffect, useRef, useState } from 'react'
import { api, type TimeCategory, type TimeEntry } from '../../lib/api'
import {
  approvalsApi,
  type HistoryChange,
  type ReviewEntry,
  type ReviewItem,
} from '../../lib/api/approvals'
import { addDateDays, businessWeekStart, formatWorkDate } from '../../lib/dateUtils'
import { isTinyShift, personNote, reasonChips, reviewStatus } from './reviewPresentation'
import { formatApprovalDate } from '../../lib/approvalsDates'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Button, ErrorState, Field, Sheet, StatusPill, Textarea } from '../ui'
import type { ApprovalResult } from './useReviewBatch'
import EditTimeEntryModal from '../time-tracking/EditTimeEntryModal'

const when = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Guam',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
export default function ReviewSheet({
  entry,
  onClose,
  onApprove,
  onReload,
  busy,
  categories,
  onDirty,
  weekEntries = [],
  onSelectEntry,
}: {
  entry: ReviewEntry
  weekEntries?: ReviewEntry[]
  onSelectEntry?: (entry: ReviewEntry) => void
  onClose: (saved?: boolean, message?: string) => void
  onApprove: (items: ReviewItem[], label: string) => Promise<ApprovalResult>
  onReload: () => Promise<void>
  busy: boolean
  categories: TimeCategory[]
  onDirty: (dirty: boolean) => void
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
  const [unknown, setUnknown] = useState(false)
  const [editing, setEditing] = useState(false)
  const attemptedDecision = useRef<ReviewItem | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const lock = useRef(false)
  const overtime = entry.overtime_status === 'pending'
  useEffect(() => {
    if (!denying) return
    noteRef.current?.focus({ preventScroll: true })
    noteRef.current?.scrollIntoView?.({ block: 'center' })
  }, [denying])
  useEffect(() => {
    onDirty(Boolean(note.trim()))
    return () => onDirty(false)
  }, [note, onDirty])
  useEffect(() => {
    let active = true
    approvalsApi.history(entry.id).then((response) => {
      if (active) {
        setHistory(response.data?.changes ?? null)
        setHistoryError(!response.data)
      }
    })
    return () => {
      active = false
    }
  }, [entry.id, entry.version, historyAttempt])
  useEffect(() => {
    let active = true
    const start = businessWeekStart(entry.work_date)
    api
      .getTimeEntries({
        user_id: entry.user.id,
        start_date: start,
        end_date: addDateDays(start, 6),
        per_page: 500,
      })
      .then((response) => {
        if (!active) return
        if (response.data) setWeek(response.data.time_entries)
        else setWeekError(response.error || "Couldn't load this week's shifts.")
      })
    return () => {
      active = false
    }
  }, [entry.user.id, entry.work_date, entry.version])
  const approve = async (includeOvertime: boolean) => {
    if (lock.current || busy || !online) return
    lock.current = true
    try {
      const decision: ReviewItem = {
        id: entry.id,
        version: entry.version,
        approve_time: entry.approval_status === 'pending',
        approve_overtime: includeOvertime,
        ...(includeOvertime ? { overtime_hours: entry.pending_overtime_hours ?? 0 } : {}),
      }
      attemptedDecision.current = decision
      const result = await onApprove(
        [decision],
        includeOvertime
          ? `Approved ${(entry.pending_overtime_hours ?? 0).toFixed(1)}h overtime for ${entry.user.full_name}`
          : `Approved time for ${entry.user.full_name}`,
      )
      if (result === 'ok') {
        onDirty(false)
        onClose(true)
      } else if (result === 'conflict') {
        await closeChanged('approved')
      } else if (result === 'unknown') {
        setUnknown(true)
        setError("We couldn't confirm whether this saved. Reload before deciding again.")
      } else
        setError(
          'This decision could not be saved. The list has been refreshed; close this review and check the shift again.',
        )
    } finally {
      lock.current = false
    }
  }
  const deny = async () => {
    if (lock.current || !online || !note.trim() || !denying) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      const fresh = await api.getTimeEntry(entry.id)
      if (!fresh.data) {
        setError(fresh.error || "Couldn't check the current shift. Nothing was denied.")
        return
      }
      if (fresh.data.time_entry.version !== entry.version) {
        await closeChanged('denied')
        return
      }
      const response =
        denying === 'overtime'
          ? await api.denyOvertime(entry.id, note.trim())
          : await api.denyTimeEntry(entry.id, note.trim())
      if (!response.data) {
        setError(response.error || "Couldn't save the denial.")
        return
      }
      onDirty(false)
      await onReload()
      const subject = denying === 'time' ? 'shift' : 'overtime'
      const pronoun = "They'll"
      onClose(
        true,
        `Denied ${entry.user.full_name}'s ${formatApprovalDate(entry.work_date)} ${subject}. ${pronoun} see your note.`,
      )
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  const closeChanged = async (decision: 'approved' | 'denied') => {
    await onReload()
    onDirty(false)
    onClose(true, `This shift changed since you opened it. Nothing was ${decision}.`)
  }
  const reloadDecision = async () => {
    setSaving(true)
    try {
      await onReload()
      const fresh = await api.getTimeEntry(entry.id)
      if (!fresh.data) {
        setError(fresh.error || "Couldn't reload this shift. Try again.")
        return
      }
      const row = fresh.data.time_entry
      const decision = attemptedDecision.current
      if (
        unknown &&
        decision &&
        (!decision.approve_time || row.approval_status === 'approved') &&
        (!decision.approve_overtime || row.overtime_status === 'approved')
      ) {
        onDirty(false)
        onClose(true, 'Saved')
        return
      }
      if (row.version !== entry.version) {
        onDirty(false)
        onClose(true, 'This shift changed since you opened it. Nothing was approved.')
        return
      }
      setUnknown(false)
      setError('Not saved. The list is up to date; you can approve again.')
    } finally {
      setSaving(false)
    }
  }

  const blocked = busy || saving || !online || unknown || entry.needs_another_approver
  return (
    <>
      <Sheet
        open={!editing}
        title={`Review ${entry.user.full_name}`}
        description={
          weekEntries.length > 1
            ? `Week of ${formatApprovalDate(businessWeekStart(entry.work_date))}`
            : formatApprovalDate(entry.work_date)
        }
        onClose={() => {
          if (!busy && !saving) onClose()
        }}
        footer={
          <div className="flex flex-wrap gap-2">
            {denying ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setDenying(null)}
                  disabled={saving}
                >
                  Back
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    void deny()
                  }}
                  loading={saving}
                  disabled={blocked || !note.trim()}
                  title={!online ? 'Reconnect to deny' : undefined}
                >
                  Deny {denying === 'overtime' ? 'overtime' : 'shift'}
                </Button>
                {!note.trim() && (
                  <p className="w-full text-body-sm text-ink-muted">
                    Write a short note for {entry.user.full_name.split(' ')[0]} to deny.
                  </p>
                )}
              </>
            ) : (
              <>
                {entry.approval_status === 'pending' && (
                  <Button
                    onClick={() => {
                      void approve(false)
                    }}
                    disabled={blocked}
                    title={!online ? 'Reconnect to approve' : undefined}
                  >
                    Approve time
                  </Button>
                )}
                {overtime && (
                  <Button
                    onClick={() => {
                      void approve(true)
                    }}
                    disabled={blocked || entry.pending_overtime_hours === undefined}
                    title={!online ? 'Reconnect to approve' : undefined}
                  >
                    Approve {entry.approval_status === 'pending' ? 'time + ' : ''}
                    {(entry.pending_overtime_hours ?? 0) > 0
                      ? `${entry.pending_overtime_hours!.toFixed(1)}h overtime`
                      : 'overtime'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => setDenying(overtime ? 'overtime' : 'time')}
                  disabled={blocked}
                  title={!online ? 'Reconnect to deny' : undefined}
                >
                  Deny{overtime ? ' overtime' : ''}…
                </Button>
                {entry.approval_status === 'pending' && overtime && (
                  <Button
                    variant="ghost"
                    onClick={() => setDenying('time')}
                    disabled={blocked}
                  >
                    Deny shift…
                  </Button>
                )}
              </>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {weekEntries.length > 1 && (
            <section className="space-y-2" aria-label="Shifts to review this week">
              <p className="text-body-sm text-ink-muted">
                Choose a shift below. Each decision applies to that shift only.
              </p>
              <div className="flex flex-wrap gap-2">
                {weekEntries.map((row) => (
                  <Button
                    key={row.id}
                    variant={entry.id === row.id ? 'primary' : 'secondary'}
                    aria-pressed={entry.id === row.id}
                    disabled={busy || saving || unknown}
                    onClick={() => onSelectEntry?.(row)}
                  >
                    {formatApprovalDate(row.work_date)} · {row.hours.toFixed(1)}h
                  </Button>
                ))}
              </div>
            </section>
          )}
          {isTinyShift(entry) && (
            <p className="font-medium text-amber-800">Under 1 minute, probably a mis-tap</p>
          )}
          <p className="text-body-sm font-semibold">{formatApprovalDate(entry.work_date)}</p>
          <div className="flex flex-wrap gap-1">
            {reasonChips([entry]).map((reason) => (
              <StatusPill key={reason.key} tone="waiting">
                {reason.label}
              </StatusPill>
            ))}
          </div>
          <dl className="space-y-1 text-body-sm">
            <div>
              <dt className="inline font-semibold">Time: </dt>
              <dd className="inline">
                {entry.formatted_start_time || entry.start_time || '—'}–
                {entry.formatted_end_time || entry.end_time || '—'} · {entry.hours.toFixed(1)}
                h
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Work: </dt>
              <dd className="inline">{entry.time_category?.name || 'No work category'}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Break: </dt>
              <dd className="inline">{entry.break_minutes ?? 0} minutes</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Time approval: </dt>
              <dd className="inline">{reviewStatus(entry.approval_status)}</dd>
            </div>
          </dl>
          {entry.description && <p className="text-body-sm">{entry.description}</p>}
          {personNote(entry.approval_note) && (
            <p className="text-body-sm text-ink-muted">{personNote(entry.approval_note)}</p>
          )}
          <Button
            variant="ghost"
            onClick={() => setEditing(true)}
            disabled={blocked}
            title={!online ? 'Reconnect to edit' : undefined}
          >
            Edit…
          </Button>
          {overtime && (
            <section className="space-y-2">
              <h3 className="font-semibold">This week's shifts</h3>
              {weekError ? (
                <ErrorState
                  title="Couldn't load this week's shifts."
                  description={weekError}
                />
              ) : week ? (
                <>
                  <p className="text-body-sm">
                    {week.reduce((sum, row) => sum + row.hours, 0).toFixed(1)}h this week ·{' '}
                    {(entry.pending_overtime_hours ?? 0) > 0
                      ? `${entry.pending_overtime_hours!.toFixed(1)}h overtime waiting on this shift`
                      : 'Overtime to review'}
                  </p>
                  <ul className="divide-y divide-line text-body-sm">
                    {week.map((row) => (
                      <li key={row.id} className="py-2">
                        {formatWorkDate(row.work_date)} · {row.hours.toFixed(1)}h ·{' '}
                        {reviewStatus(row.approval_status).toLowerCase()}
                        {row.id === entry.id ? ' · Shift being reviewed' : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-body-sm">Loading week's shifts…</p>
              )}
            </section>
          )}
          <section className="space-y-3">
            <h3 className="font-semibold">Change history</h3>
            {historyError ? (
              <ErrorState
                title="Couldn't load the change history."
                onRetry={() => setHistoryAttempt((value) => value + 1)}
              />
            ) : history === null ? (
              <p className="text-body-sm">Loading change history…</p>
            ) : history.length === 0 ? (
              <p className="text-body-sm text-ink-muted">No change history recorded.</p>
            ) : (
              <ol className="space-y-4">
                {history.map((change, index) => (
                  <li
                    key={`${change.at}-${index}`}
                    className="space-y-1 border-l-2 border-line pl-3 text-body-sm"
                  >
                    <p className="font-medium">{change.sentence}</p>
                    <p className="text-ink-muted">
                      {change.actor?.full_name || 'System'} · {when(change.at)}
                    </p>
                    {change.fields.map((field) => (
                      <p key={field.field} className="break-words">
                        {field.label}:{' '}
                        {field.before === null ? 'Not recorded' : String(field.before)} →{' '}
                        {field.after === null ? 'Not recorded' : String(field.after)}
                      </p>
                    ))}
                    {change.reason && <p>Reason: {change.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
          {denying && (
            <Field
              label={`Why is this denied? ${entry.user.full_name.split(' ')[0]} will see this.`}
              required
            >
              <Textarea
                ref={noteRef}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
              />
            </Field>
          )}
          {unknown && (
            <Button
              variant="secondary"
              onClick={() => {
                void reloadDecision()
              }}
              disabled={busy || saving || !online}
            >
              Reload
            </Button>
          )}
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </Sheet>
      <EditTimeEntryModal
        isOpen={editing}
        entry={entry}
        canManageTeamTime
        canDelete={false}
        onDeleted={() => {}}
        categories={categories}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          void onReload()
          onClose()
        }}
        onError={(message) => setError(message || '')}
      />
    </>
  )
}
