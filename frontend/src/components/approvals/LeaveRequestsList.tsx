import { useEffect, useRef, useState } from 'react'
import { api, type LeaveRequest } from '../../lib/api'
import { formatWorkDate } from '../../lib/dateUtils'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Avatar, Button, EmptyState, Field, ListGroup, ListRow, Sheet, Textarea, useToast } from '../ui'
const name = (request: LeaveRequest) => request.user.full_name || request.user.display_name || request.user.email
export default function LeaveRequestsList({ requests, viewerId, onChanged }: { requests: LeaveRequest[]; viewerId?: number; onChanged: () => Promise<void> }) {
  const online = useOnlineStatus()
  const toast = useToast()
  const [approved, setApproved] = useState<LeaveRequest[]>([])
  const [declining, setDeclining] = useState<LeaveRequest | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    const load = async () => {
      const rows: LeaveRequest[] = []
      for (let page = 1; ; page++) {
        const response = await api.getLeaveRequests('approved', page, 100)
        if (!response.data || !active) return
        rows.push(...response.data.leave_requests)
        if (page >= response.data.pagination.total_pages) break
      }
      if (active) setApproved(rows)
    }
    void load(); return () => { active = false }
  }, [requests])
  const save = async (request: LeaveRequest, decline = false) => {
    if (lock.current || !online || request.user.id === viewerId) return
    lock.current = true; setBusy(true); setError('')
    try {
      const response = decline ? await api.declineLeaveRequest(request.id, note.trim()) : await api.approveLeaveRequest(request.id)
      if (!response.data) { setError(response.error || "Couldn't save this leave decision."); return }
      toast.show({ message: `${decline ? 'Declined' : 'Approved'} ${name(request)}'s time off, ${formatWorkDate(request.start_date)}–${formatWorkDate(request.end_date)}` })
      setDeclining(null); setNote(''); await onChanged()
    } finally { lock.current = false; setBusy(false) }
  }
  if (!requests.length) return <EmptyState title="No leave requests waiting." />
  return <>
    {error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
    <ListGroup label="Leave requests">{requests.map(request => {
      const own = request.user.id === viewerId
      const alsoOff = approved.filter(other => other.user.id !== request.user.id && other.start_date <= request.end_date && other.end_date >= request.start_date)
      return <ListRow key={request.id} title={name(request)} leading={<span className="hidden sm:inline-flex"><Avatar name={name(request)} size="sm" /></span>}
        meta={<>{request.leave_type.replaceAll('_', ' ')} · {formatWorkDate(request.start_date)}–{formatWorkDate(request.end_date)} · {request.total_days} days
          {request.reason && <span className="block whitespace-normal">{request.reason}</span>}
          {alsoOff.length > 0 && <span className="block whitespace-normal">Also off: {alsoOff.map(other => `${name(other)} (${other.start_date}–${other.end_date})`).join(', ')}</span>}
          {own && <span className="block whitespace-normal">Another manager or admin approves this</span>}
        </>}
        action={own ? undefined : { label: 'Approve', ariaLabel: `Approve leave for ${name(request)}`, disabled: busy || !online, title: !online ? 'Reconnect to approve' : undefined, onClick: () => { void save(request) } }}
        trailing={own ? undefined : <Button variant="ghost" size="sm" disabled={busy || !online} title={!online ? 'Reconnect to decline' : undefined} onClick={() => { setDeclining(request); setNote('') }}>Decline…</Button>} />
    })}</ListGroup>
    <Sheet open={Boolean(declining)} title={`Decline ${declining ? name(declining) : ''}'s leave?`} onClose={() => { if (!busy) setDeclining(null) }}
      footer={<Button onClick={() => { if (declining) void save(declining, true) }} loading={busy} disabled={!online} title={!online ? 'Reconnect to decline' : undefined}>Decline leave</Button>}>
      <Field label="Note (optional)"><Textarea value={note} onChange={event => setNote(event.target.value)} /></Field>{error && <p role="alert">{error}</p>}
    </Sheet>
  </>
}
