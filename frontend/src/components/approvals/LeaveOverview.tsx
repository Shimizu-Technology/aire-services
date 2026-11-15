import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDateDays, businessDateISO, businessWeekStart } from '../../lib/dateUtils'
import { formatApprovalDate } from '../../lib/approvalsDates'
import { api, type LeaveRequest } from '../../lib/api'
import { leaveDateRange, leaveType } from './reviewPresentation'
import LeaveRequestsList from './LeaveRequestsList'
import {
  Button,
  EmptyState,
  Field,
  Sheet,
  Textarea,
  Select,
  useToast,
} from '../ui'
import { useOnlineStatus } from '../../lib/useOnlineStatus'

const person = (row: LeaveRequest) =>
  row.user.full_name || row.user.display_name || row.user.email
const stamp = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    timeZone: 'Pacific/Guam',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export default function LeaveOverview({
  requests,
  viewerId,
  onChanged,
  matchesPerson,
  matchesDates,
  departmentLabel = 'All departments',
  startDate,
}: {
  departmentLabel?: string
  startDate?: string
  requests: LeaveRequest[]
  viewerId?: number
  onChanged: () => Promise<void>
  matchesPerson: (id: number) => boolean
  matchesDates: (row: LeaveRequest) => boolean
}) {
  const [query, setQuery] = useSearchParams()
  const view = query.get('leave_view') === 'approved'
    ? 'Approved'
    : query.get('leave_view') === 'past' ? 'Past decisions' : 'Waiting'
  const thisWeek = businessWeekStart()
  const requestedWeek = query.get('week') || ''
  const validWeek = /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) &&
    Number.isFinite(Date.parse(`${requestedWeek}T12:00:00Z`)) &&
    new Date(`${requestedWeek}T12:00:00Z`).toISOString().slice(0, 10) === requestedWeek
  const start = validWeek ? businessWeekStart(requestedWeek) : thisWeek
  const end = addDateDays(start, 6)
  const nextWeek = start > thisWeek
  const updateView = (key: string, value: string) => {
    const next = new URLSearchParams(query)
    next.set('kind', 'leave')
    next.set('week', start)
    next.set('leave_view', view === 'Approved' ? 'approved' : view === 'Past decisions' ? 'past' : 'waiting')
    next.set(key, value)
    setQuery(next)
  }
  const [approved, setApproved] = useState<LeaveRequest[]>([])
  const [history, setHistory] = useState<LeaveRequest[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPages, setHistoryPages] = useState(1)
  const [recent, setRecent] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState<LeaveRequest | null>(null)
  const [reason, setReason] = useState('')
  const [employeeNote, setEmployeeNote] = useState('')
  const [status, setStatus] = useState<LeaveRequest['status']>('pending')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0)
  const lock = useRef(false)
  const online = useOnlineStatus()
  const toast = useToast()
  const reload = useCallback(async () => {
    const id = ++generation.current
    setLoading(true)
    try {
      const [offResult, decisionsResult] = await Promise.all([
        api.getLeaveRequests('approved', 1, 100, undefined, startDate || thisWeek),
        api.getLeaveRequests(undefined, 1, 25, 'decisions'),
      ])
      if (!offResult.data || !decisionsResult.data)
        throw new Error(offResult.error || decisionsResult.error || "Couldn't load leave overview.")
      const off = [...offResult.data.leave_requests]
      for (let page = 2; page <= offResult.data.pagination.total_pages; page++) {
        const result = await api.getLeaveRequests('approved', page, 100, undefined, startDate || thisWeek)
        if (!result.data) throw new Error(result.error || "Couldn't load approved leave.")
        off.push(...result.data.leave_requests)
      }
      const decisions = decisionsResult.data.leave_requests
      if (id !== generation.current) return
      setLoadError(false)
      setNow(Date.now())
      setApproved(off)
      setHistory(decisions)
      setHistoryPage(1)
      setHistoryPages(decisionsResult.data.pagination.total_pages)
      setRecent(
        decisions.filter(
          (row) =>
            row.reviewed_by?.id === viewerId &&
            row.undo_expires_at,
        ),
      )
      setError('')
    } catch (cause) {
      if (id === generation.current) {
        setLoadError(true)
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't load leave overview.",
        )
      }
    } finally {
      if (id === generation.current) setLoading(false)
    }
  }, [viewerId, startDate, thisWeek])
  useEffect(() => {
    void reload()
    // Invalidate pending network responses after unmount.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
    }
  }, [reload])
  useEffect(() => {
    const expiries = [...recent, ...approved, ...history]
      .map((row) => Date.parse(row.undo_expires_at || ''))
      .filter((expiry) => expiry > Date.now())
    if (!expiries.length) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(...expiries) - Date.now() + 1)
    return () => window.clearTimeout(timer)
  }, [recent, approved, history, now])
  const changed = async () => {
    await Promise.all([onChanged(), reload()])
  }
  const saved = (row: LeaveRequest) => {
    setRecent((current) => [
      row,
      ...current.filter((item) => item.id !== row.id),
    ])
    toast.show({
      message: `${row.status === 'approved' ? 'Approved' : 'Declined'} ${person(row)}'s time off, ${leaveDateRange(row.start_date, row.end_date)}`,
      action: {
        label: 'Undo',
        onAction: () => {
          void decide(row, true)
        },
      },
      duration: 10_000,
    })
  }
  const undoable = (row: LeaveRequest) =>
    row.reviewed_by?.id === viewerId &&
    Boolean(row.undo_expires_at && now < Date.parse(row.undo_expires_at))
  const decide = async (row: LeaveRequest, undo: boolean) => {
    if (lock.current || !online || row.version === undefined) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = undo
        ? await api.undoLeaveDecision(row.id, row.version)
        : await api.changeLeaveDecision(
            row.id,
            row.version,
            status,
            reason.trim(),
            employeeNote.trim(),
          )
      if (!result.data) {
        if (result.status === 409) {
          await changed()
          setEditing(null)
          setError('This leave request changed. The latest decision is now shown.')
          return
        }
        setError(
          result.error ||
            "Couldn't change this decision. Refresh and try again.",
        )
        return
      }
      toast.show({
        message: `${person(row)}'s leave ${undo ? 'is waiting again' : 'decision was changed'}.`,
      })
      setEditing(null)
      setRecent((current) => current.filter((item) => item.id !== row.id))
      await changed()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const off = approved
    .filter(
      (row) =>
        matchesPerson(row.user.id) &&
        row.start_date <= end &&
        row.end_date >= start,
    )
    .sort(
      (a, b) =>
        a.start_date.localeCompare(b.start_date) ||
        person(a).localeCompare(person(b)),
    )
  const decisionRows = (
    view === 'Waiting'
      ? recent
      : view === 'Approved'
        ? approved.filter((row) => row.end_date >= businessDateISO()).sort((a, b) => a.start_date.localeCompare(b.start_date))
        : history
  ).filter((row) => matchesPerson(row.user.id) && matchesDates(row))
  const renderDecision = (row: LeaveRequest) => (
    <article
      key={row.id}
      className="space-y-2 rounded-xl border border-line p-4"
    >
      <h3 className="font-semibold text-ink">
        {person(row)} ·{' '}
        {row.status === 'pending' ? 'Waiting again' : row.status === 'approved' ? 'Approved' : 'Declined'}
      </h3>
      <p className="text-body-sm text-ink-muted">
        {leaveDateRange(row.start_date, row.end_date)} ·{' '}
        {leaveType(row.leave_type)} · {row.user.department || 'Unassigned'}
      </p>
      {row.reviewed_at && (
        <p className="text-body-sm text-ink-muted">
          {row.reviewed_by?.full_name || 'Reviewer'} decided{' '}
          {stamp(row.reviewed_at)} (Guam)
        </p>
      )}
      {row.user.id !== viewerId &&
        (row.status === 'approved' || row.status === 'declined') && (
          <div className="flex flex-wrap gap-2">
            {undoable(row) && (
              <Button
                size="sm"
                aria-label={`Undo ${row.status === 'approved' ? 'approval' : 'decline'} for ${person(row)}, ${leaveDateRange(row.start_date, row.end_date)}`}
                disabled={busy || !online}
                onClick={() => {
                  void decide(row, true)
                }}
              >
                Undo
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Change decision for ${person(row)}, ${leaveDateRange(row.start_date, row.end_date)}`}
              disabled={busy || !online}
              onClick={() => {
                setEditing(row)
                setReason('')
                setEmployeeNote('')
                setStatus('pending')
                setError('')
              }}
            >
              Change decision
            </Button>
            {row.reviewed_by?.id === viewerId && row.undo_expires_at && !undoable(row) && (
              <p className="self-center text-body-sm text-ink-muted">Undo time is over — use Change decision.</p>
            )}
            {undoable(row) && (
              <p className="self-center text-body-sm text-ink-muted">
                Undo available until {stamp(row.undo_expires_at!)} (Guam)
              </p>
            )}
          </div>
        )}
      {view === 'Past decisions' && (
        <ul className="space-y-1 text-body-sm text-ink-muted">
          {row.decision_history?.map((event, index) => (
            <li key={index}>
              {stamp(event.at)} · {event.actor || 'Reviewer'} ·{' '}
              {event.from
                ? `${event.from === 'pending' ? 'Waiting' : event.from === 'approved' ? 'Approved' : 'Declined'} changed to ${event.to === 'pending' ? 'Waiting' : event.to === 'approved' ? 'Approved' : 'Declined'}`
                : event.action.endsWith('.approved')
                  ? 'Approved'
                  : 'Declined'}
              {event.reason ? ` · ${event.reason}` : ''}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
  return (
    <div className="space-y-5">
      <section
        aria-label="Who is off this week"
        className="space-y-3 rounded-xl border border-line p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-heading-sm font-semibold">
            Who is off {nextWeek ? 'next' : 'this'} week
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateView('week', nextWeek ? thisWeek : addDateDays(thisWeek, 7))}
          >
            {nextWeek ? 'This week' : 'Next week'}
          </Button>
        </div>
        <p className="text-body-sm text-ink-muted">
          {formatApprovalDate(start)} – {formatApprovalDate(end)} · Whole days · {departmentLabel}
        </p>
        {loading ? (
          <p>Loading approved absences…</p>
        ) : loadError ? (
          <p>Approved absences could not be refreshed.</p>
        ) : off.length ? (
          <ul className="space-y-3">
            {off.map((row) => (
              <li key={row.id} className="text-body-sm">
                <strong>{person(row)}</strong>
                <span className="block text-ink-muted">
                  {leaveDateRange(row.start_date, row.end_date)} ·{' '}
                  {row.user.department || 'Unassigned'} ·{' '}
                  {leaveType(row.leave_type)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-ink-muted">
            No approved absences {nextWeek ? 'next' : 'this'} week · {departmentLabel}.
          </p>
        )}
      </section>
      <div
        role="group"
        aria-label="Leave views"
        className="flex flex-wrap gap-2"
      >
        {(['Waiting', 'Approved', 'Past decisions'] as const).map((label) => (
          <Button
            key={label}
            aria-pressed={view === label}
            variant={view === label ? 'primary' : 'ghost'}
            onClick={() => updateView('leave_view', label === 'Approved' ? 'approved' : label === 'Past decisions' ? 'past' : 'waiting')}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && !editing && (
        <div role="alert" className="space-y-2 text-body-sm text-danger">
          <p>{error}</p>
          <Button
            variant="ghost"
            onClick={() => {
              void changed()
            }}
          >
            Refresh leave
          </Button>
        </div>
      )}
      {view === 'Waiting' && (
        <LeaveRequestsList
          requests={requests}
          viewerId={viewerId}
          onSaved={saved}
          onChanged={changed}
        />
      )}
      {view === 'Waiting' && decisionRows.length > 0 && (
        <h2 className="font-semibold">Just decided</h2>
      )}
      {view !== 'Waiting' && loading ? (
        <p>Loading leave…</p>
      ) : (
        <div className="space-y-3">
          {decisionRows.map(renderDecision)}
          {view === 'Past decisions' && historyPage < historyPages && (
            <Button disabled={busy || !online} onClick={async () => {
              setBusy(true)
              try {
                const result = await api.getLeaveRequests(undefined, historyPage + 1, 25, 'decisions')
                if (!result.data) { setError(result.error || "Couldn't load more decisions."); return }
                setHistory((rows) => [...rows, ...result.data!.leave_requests])
                setHistoryPage(historyPage + 1)
              } finally { setBusy(false) }
            }}>Show more</Button>
          )}
          {view !== 'Waiting' && !decisionRows.length && !error && (
            <EmptyState
              title={
                view === 'Approved'
                  ? 'No current or upcoming approved leave.'
                  : 'No past decisions.'
              }
            />
          )}
        </div>
      )}
      <Sheet
        open={Boolean(editing)}
        title={`Change ${editing ? person(editing) : ''}'s leave decision`}
        onClose={() => {
          if (!busy) setEditing(null)
        }}
        footer={
          <Button
            loading={busy}
            disabled={!online || !reason.trim() || (editing?.status === 'approved' && !employeeNote.trim())}
            onClick={() => {
              if (editing) void decide(editing, false)
            }}
          >
            Save decision
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="New decision">
            <Select
              className="min-h-11 w-full rounded-lg border border-line p-2"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as LeaveRequest['status'])
              }
            >
              {(['pending', 'approved', 'declined'] as const)
                .filter((value) => value !== editing?.status)
                .map((value) => (
                  <option key={value} value={value}>
                    {value === 'pending'
                      ? 'Waiting for approval'
                      : value === 'approved'
                        ? 'Approved'
                        : 'Declined'}
                  </option>
                ))}
            </Select>
          </Field>
          {editing?.status === 'approved' && <Field label="Note for the employee (required)">
            <Textarea maxLength={500} value={employeeNote} onChange={event => setEmployeeNote(event.target.value)} />
          </Field>}
          <Field label="Reason (required)">
            <Textarea
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <p className="text-body-sm text-ink-muted">
            Only managers and admins see this reason. The change and your reason will stay in Past decisions.
          </p>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  )
}
