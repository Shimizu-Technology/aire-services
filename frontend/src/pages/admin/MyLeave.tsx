import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuthContext } from '../../contexts/AuthContext'
import type { LeaveRequest } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { outcomeUnknown } from '../../lib/api/timecards'
import { formatDateOnly } from '../../lib/dateUtils'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Sheet,
  StatusPill,
  Textarea,
} from '../../components/ui'

const TYPES: Record<LeaveRequest['leave_type'], string> = {
  paid_time_off: 'Paid time off',
  sick: 'Sick leave',
  unpaid: 'Unpaid leave',
  bereavement: 'Bereavement',
  other: 'Other',
}

export default function MyLeave() {
  const { currentUser } = useAuthContext()
  const viewerId = currentUser?.id
  const online = useOnlineStatus()
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!viewerId) return
    const result = await myTimeApi.leave(viewerId)
    if (result.data) {
      setRequests(result.data)
      setError(null)
      setUncertain(false)
    } else setError(result.error || "Couldn't load your requests.")
  }, [viewerId])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])
  useEffect(
    () =>
      startVisibilityAwarePolling(() => {
        if (!open && busy === null) return load()
      }, 60_000),
    [load, open, busy],
  )

  const cancel = async (request: LeaveRequest) => {
    if (!online || busy !== null || request.user.id !== viewerId) return
    setBusy(request.id)
    const result = await myTimeApi.cancelLeave(request.id)
    if (result.data) setMessage('Your request was cancelled.')
    else
      setMessage(
        outcomeUnknown(result)
          ? 'The reply was lost. Check the latest request status below.'
          : result.error || "Couldn't cancel your request.",
      )
    await load()
    setBusy(null)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Leave" />
      {message && <p role="status">{message}</p>}
      {!online && (
        <p role="status">No connection. Reconnect to request or cancel time off.</p>
      )}
      {error ? (
        <ErrorState
          title="Couldn't load your requests."
          description={error}
          onRetry={load}
        />
      ) : requests === null ? (
        <p role="status">Loading your requests…</p>
      ) : !requests.length ? (
        <EmptyState title="No time off requested yet." />
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {requests.map((request) => (
            <li key={request.id} className="space-y-3 p-4">
              <p className="text-body font-semibold text-ink">
                {TYPES[request.leave_type]}
              </p>
              <p className="text-body-sm text-ink-muted">
                {formatDateOnly(request.start_date, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {request.end_date !== request.start_date &&
                  `–${formatDateOnly(request.end_date, { month: 'short', day: 'numeric', year: 'numeric' })}`}
              </p>
              <StatusPill
                tone={
                  request.status === 'approved'
                    ? 'approved'
                    : request.status === 'declined'
                      ? 'needs-fix'
                      : request.status === 'pending'
                        ? 'waiting'
                        : 'off'
                }
              >
                {request.status === 'pending'
                  ? 'Waiting for approval'
                  : request.status === 'approved'
                    ? 'Approved'
                    : request.status === 'declined'
                      ? 'Declined'
                      : 'Cancelled'}
              </StatusPill>
              {request.reason && (
                <p className="whitespace-pre-wrap break-words text-body-sm text-ink">
                  {request.reason}
                </p>
              )}
              {request.review_note && (
                <p className="text-body-sm text-ink">
                  Manager's note: {request.review_note}
                </p>
              )}
              {request.status === 'pending' && (
                <Button
                  variant="ghost"
                  disabled={!online || busy !== null}
                  loading={busy === request.id}
                  onClick={() => void cancel(request)}
                >
                  Cancel request
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button
        disabled={!online || uncertain || !!error || requests === null}
        onClick={() => setOpen(true)}
      >
        Request time off
      </Button>
      {open && (
        <LeaveForm
          onClose={() => {
            setOpen(false)
            void load()
          }}
          onSaved={() => {
            setOpen(false)
            setMessage('Your request was sent for approval.')
            void load()
          }}
          onUncertain={() => setUncertain(true)}
        />
      )}
    </div>
  )
}

function LeaveForm({
  onClose,
  onSaved,
  onUncertain,
}: {
  onClose: () => void
  onSaved: () => void
  onUncertain: () => void
}) {
  const online = useOnlineStatus()
  const [type, setType] = useState<LeaveRequest['leave_type']>('paid_time_off')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [halfDay, setHalfDay] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!online || saving || uncertain) return
    setSaving(true)
    const response = await myTimeApi.requestLeave({
      leave_type: type,
      start_date: start,
      end_date: halfDay ? start : end,
      // The existing API stores whole date ranges. Preserve a half-day
      // request as an explicit instruction for its human reviewer.
      reason:
        [halfDay ? 'Half day requested.' : '', note.trim()]
          .filter(Boolean)
          .join('\n') || undefined,
    })
    setSaving(false)
    if (!response.data) {
      const unknown = outcomeUnknown(response)
      setUncertain(unknown)
      if (unknown) onUncertain()
      setError(
        unknown
          ? 'The reply was lost. Close this sheet and check your requests before trying again.'
          : response.error || "Couldn't send your request.",
      )
      return
    }
    onSaved()
  }
  return (
    <Sheet
      open
      onClose={() => {
        if (!saving) onClose()
      }}
      title="Request time off"
      footer={
        <Button
          fullWidth
          type="submit"
          form="request-leave"
          loading={saving}
          disabled={!online || uncertain}
        >
          Send request
        </Button>
      }
    >
      <form id="request-leave" onSubmit={submit} className="space-y-4">
        <Field label="Type">
          <Select
            value={type}
            onChange={(event) =>
              setType(event.target.value as LeaveRequest['leave_type'])
            }
          >
            {Object.entries(TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date" required>
          <Input
            type="date"
            value={start}
            onChange={(event) => {
              setStart(event.target.value)
              if (!end || end < event.target.value) setEnd(event.target.value)
            }}
          />
        </Field>
        <Field label="End date" required>
          <Input
            type="date"
            min={start}
            value={halfDay ? start : end}
            disabled={halfDay}
            onChange={(event) => setEnd(event.target.value)}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-body">
          <input
            type="checkbox"
            checked={halfDay}
            onChange={(event) => setHalfDay(event.target.checked)}
            className="size-5 accent-primary"
          />
          Half day
        </label>
        {halfDay && (
          <p className="text-body-sm text-ink-muted">
            We'll include “Half day requested” in your note for your manager. Say which
            hours you need off.
          </p>
        )}
        <Field label="Note">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  )
}
