import { useEffect, useRef, useState } from 'react'
import { api, type LeaveRequest } from '../../lib/api'
import { approvalsApi } from '../../lib/api/approvals'
import { leaveDateRange, leaveType } from './reviewPresentation'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  ListGroup,
  ListRow,
  Sheet,
  Textarea,
  useToast,
} from '../ui'
const name = (request: LeaveRequest) =>
  request.user.full_name || request.user.display_name || request.user.email
export default function LeaveRequestsList({
  requests,
  viewerId,
  onChanged,
  onSaved,
}: {
  requests: LeaveRequest[]
  viewerId?: number
  onSaved?: (request: LeaveRequest) => void
  onChanged: () => Promise<void>
}) {
  const online = useOnlineStatus()
  const toast = useToast()
  const [overlapError, setOverlapError] = useState(false)
  const [overlapAttempt, setOverlapAttempt] = useState(0)
  const [approved, setApproved] = useState<LeaveRequest[]>([])
  const [declining, setDeclining] = useState<LeaveRequest | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const requestKey = requests
    .map((request) => `${request.id}:${request.start_date}:${request.end_date}`)
    .sort()
    .join('|')
  const rangeStart = requests.map((request) => request.start_date).sort()[0]
  const rangeEnd = requests
    .map((request) => request.end_date)
    .sort()
    .at(-1)
  useEffect(() => {
    let active = true
    const load = async () => {
      if (!rangeStart || !rangeEnd) {
        setApproved([])
        return
      }
      setOverlapError(false)
      setApproved([])
      const rows: LeaveRequest[] = []
      for (let page = 1; ; page++) {
        const response = await approvalsApi
          .approvedLeave(rangeStart, rangeEnd, page)
          .catch(() => ({ data: undefined }))
        if (!active) return
        if (!response.data) {
          setOverlapError(true)
          return
        }
        rows.push(...response.data.leave_requests)
        if (page >= response.data.pagination.total_pages) break
      }
      if (active) setApproved(rows)
    }
    void load()
    return () => {
      active = false
    }
  }, [requestKey, rangeStart, rangeEnd, overlapAttempt])
  const save = async (request: LeaveRequest, decline = false) => {
    if (lock.current || !online || request.user.id === viewerId || (decline && !note.trim())) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const response = decline
        ? await api.declineLeaveRequest(request.id, note.trim(), request.version)
        : await api.approveLeaveRequest(request.id, undefined, request.version)
      if (!response.data) {
        setError(response.error || "Couldn't save this leave decision.")
        return
      }
      onSaved?.(response.data.leave_request)
      if (!onSaved) toast.show({
        message: `${decline ? 'Declined' : 'Approved'} ${name(request)}'s time off, ${leaveDateRange(request.start_date, request.end_date)}`,
      })
      setDeclining(null)
      setNote('')
      await onChanged()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (!requests.length) return <EmptyState title="No leave requests waiting." />
  return (
    <>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      {overlapError && (
        <p className="text-body-sm text-ink-muted">
          Couldn't check overlaps.{' '}
          <button
            type="button"
            className="relative font-semibold text-primary underline pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']"
            onClick={() => setOverlapAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </p>
      )}
      <ListGroup label="Leave requests">
        {requests.map((request) => {
          const own = request.user.id === viewerId
          const alsoOff = approved.filter(
            (other) =>
              other.user.id !== request.user.id &&
              other.start_date <= request.end_date &&
              other.end_date >= request.start_date,
          )
          return (
            <ListRow
              key={request.id}
              title={name(request)}
              leading={
                <span className="hidden sm:inline-flex">
                  <Avatar name={name(request)} size="sm" />
                </span>
              }
              meta={
                <>
                  {leaveType(request.leave_type)} ·{' '}
                  {leaveDateRange(request.start_date, request.end_date)} ·{' '}
                  {request.total_days} {request.total_days === 1 ? 'day' : 'days'}
                  {request.reason && (
                    <span className="block whitespace-normal">{request.reason}</span>
                  )}
                  {alsoOff.length > 0 && (
                    <span className="block whitespace-normal">
                      Also off:{' '}
                      {alsoOff
                        .map(
                          (other) =>
                            `${name(other)} (${leaveDateRange(other.start_date, other.end_date)})`,
                        )
                        .join(', ')}
                    </span>
                  )}
                  {own && (
                    <span className="block whitespace-normal">
                      Another manager or admin approves this
                    </span>
                  )}
                </>
              }
              action={
                own
                  ? undefined
                  : {
                      label: 'Approve',
                      ariaLabel: `Approve leave for ${name(request)}`,
                      disabled: busy || !online,
                      title: !online ? 'Reconnect to approve' : undefined,
                      onClick: () => {
                        void save(request)
                      },
                    }
              }
              trailing={
                own ? undefined : (
                  <Button
                    aria-label={`Decline ${name(request)}'s time off, ${leaveDateRange(request.start_date, request.end_date)}`}
                    variant="ghost"
                    size="sm"
                    disabled={busy || !online}
                    title={!online ? 'Reconnect to decline' : undefined}
                    onClick={() => {
                      setDeclining(request)
                      setNote('')
                    }}
                  >
                    Decline…
                  </Button>
                )
              }
            />
          )
        })}
      </ListGroup>
      <Sheet
        open={Boolean(declining)}
        title={`Decline ${declining ? name(declining) : ''}'s leave?`}
        onClose={() => {
          if (!busy) setDeclining(null)
        }}
        footer={
          <Button
            onClick={() => {
              if (declining) void save(declining, true)
            }}
            loading={busy}
            disabled={!online || !note.trim()}
            title={!online ? 'Reconnect to decline' : undefined}
          >
            Decline leave
          </Button>
        }
      >
        <Field label="Reason (required)">
          <Textarea required value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <p className="text-body-sm text-ink-muted">Write a short reason so the employee knows why their leave was declined.</p>
        {error && <p role="alert">{error}</p>}
      </Sheet>
    </>
  )
}
