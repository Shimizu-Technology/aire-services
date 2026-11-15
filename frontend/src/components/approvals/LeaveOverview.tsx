import { useCallback, useEffect, useRef, useState } from 'react'
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
const dateToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Guam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
function weekRange(next: boolean) {
  const date = new Date(`${dateToday()}T12:00:00Z`)
  date.setUTCDate(
    date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + (next ? 7 : 0),
  )
  const start = date.toISOString().slice(0, 10)
  date.setUTCDate(date.getUTCDate() + 6)
  return [start, date.toISOString().slice(0, 10)]
}
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
}: {
  requests: LeaveRequest[]
  viewerId?: number
  onChanged: () => Promise<void>
  matchesPerson: (id: number) => boolean
  matchesDates: (row: LeaveRequest) => boolean
}) {
  const [view, setView] = useState<'Waiting' | 'Approved' | 'Past decisions'>(
    'Waiting',
  )
  const [nextWeek, setNextWeek] = useState(false)
  const [approved, setApproved] = useState<LeaveRequest[]>([])
  const [history, setHistory] = useState<LeaveRequest[]>([])
  const [recent, setRecent] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<LeaveRequest | null>(null)
  const [reason, setReason] = useState('')
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
    const collect = async (decisions: boolean) => {
      const rows: LeaveRequest[] = []
      for (let page = 1; ; page++) {
        const result = await api.getLeaveRequests(
          decisions ? undefined : 'approved',
          page,
          100,
          decisions ? 'decisions' : undefined,
        )
        if (!result.data)
          throw new Error(result.error || "Couldn't load leave overview.")
        rows.push(...result.data.leave_requests)
        if (page >= result.data.pagination.total_pages) return rows
      }
    }
    try {
      const [off, decisions] = await Promise.all([
        collect(false),
        collect(true),
      ])
      if (id !== generation.current) return
      setApproved(off)
      setHistory(decisions)
      setRecent(
        decisions.filter(
          (row) =>
            row.reviewed_by?.id === viewerId &&
            row.undo_expires_at &&
            Date.parse(row.undo_expires_at) > Date.now(),
        ),
      )
      setError('')
    } catch (cause) {
      if (id === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't load leave overview.",
        )
    } finally {
      if (id === generation.current) setLoading(false)
    }
  }, [viewerId])
  useEffect(() => {
    void reload()
    // Invalidate pending network responses after unmount.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
    }
  }, [reload])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
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
          )
      if (!result.data) {
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
  const [start, end] = weekRange(nextWeek)
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
        ? approved.filter((row) => row.end_date >= dateToday())
        : history
  ).filter((row) => matchesPerson(row.user.id) && matchesDates(row))
  const renderDecision = (row: LeaveRequest) => (
    <article
      key={row.id}
      className="space-y-2 rounded-xl border border-line p-4"
    >
      <h3 className="font-semibold text-ink">
        {person(row)} ·{' '}
        {row.status === 'pending' ? 'Waiting again' : row.status}
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
              disabled={busy || !online}
              onClick={() => {
                setEditing(row)
                setReason('')
                setStatus('pending')
                setError('')
              }}
            >
              Change decision
            </Button>
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
                ? `${event.from} → ${event.to}`
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
            onClick={() => setNextWeek(!nextWeek)}
          >
            {nextWeek ? 'This week' : 'Next week'}
          </Button>
        </div>
        <p className="text-body-sm text-ink-muted">
          {leaveDateRange(start!, end!)} · Whole days · Selected department
        </p>
        {loading ? (
          <p>Loading approved absences…</p>
        ) : error ? (
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
            No approved absences this week in this department.
          </p>
        )}
      </section>
      <div
        role="tablist"
        aria-label="Leave views"
        className="flex flex-wrap gap-2"
      >
        {(['Waiting', 'Approved', 'Past decisions'] as const).map((label) => (
          <Button
            key={label}
            role="tab"
            aria-selected={view === label}
            variant={view === label ? 'primary' : 'ghost'}
            onClick={() => setView(label)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && (
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
            disabled={!online || !reason.trim()}
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
          <Field label="Reason (required)">
            <Textarea
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <p className="text-body-sm text-ink-muted">
            The change and your reason will stay in Past decisions.
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
