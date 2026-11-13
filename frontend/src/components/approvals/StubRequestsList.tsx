import { useRef, useState } from 'react'
import { payStubsApi, type PayStubRequest } from '../../lib/payStubsApi'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { Avatar, Button, EmptyState, Field, ListGroup, ListRow, Sheet, Textarea, useToast } from '../ui'
import SendPayStubDialog from '../pay-stubs/SendPayStubDialog'
import { describeRequest } from '../pay-stubs/payStubCopy'
export default function StubRequestsList({ requests, canChooseRecipient, onChanged }: { requests: PayStubRequest[]; canChooseRecipient: boolean; onChanged: () => Promise<void> }) {
  const online = useOnlineStatus()
  const toast = useToast()
  const [sending, setSending] = useState<PayStubRequest | null>(null)
  const [dismissing, setDismissing] = useState<PayStubRequest | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const dismiss = async () => {
    if (!dismissing || lock.current || !online) return
    lock.current = true; setBusy(true); setError('')
    try { await payStubsApi.dismiss(dismissing.id, note.trim()); setDismissing(null); toast.show({ message: 'Dismissed pay stub request.' }); await onChanged() }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn't dismiss this request.") }
    finally { lock.current = false; setBusy(false) }
  }
  if (!requests.length) return <EmptyState title="No pay stub requests waiting." />
  return <>
    <ListGroup label="Pay stub requests">{requests.map(request => <ListRow key={request.id} title={request.worker.name}
      leading={<span className="hidden sm:inline-flex"><Avatar name={request.worker.name} size="sm" /></span>}
      meta={<>{describeRequest(request)}<span className="block whitespace-normal">{request.recipient_email || 'No email on file.'}</span>{!request.can_send && <span className="block whitespace-normal">An owner or admin needs to send this one</span>}</>}
      action={request.can_send ? { label: 'Send', ariaLabel: `Send pay stub to ${request.worker.name}`, disabled: !online, title: !online ? 'Reconnect to send' : undefined, onClick: () => setSending(request) } : undefined}
      trailing={<Button variant="ghost" size="sm" disabled={!online || busy} title={!online ? 'Reconnect to dismiss' : undefined} onClick={() => { setDismissing(request); setNote('') }}>Dismiss</Button>} />)}</ListGroup>
    {sending && online && <SendPayStubDialog request={sending} canChooseRecipient={canChooseRecipient} onClose={() => setSending(null)} onSent={() => { setSending(null); toast.show({ message: 'Sent pay stub link.' }); void onChanged() }} />}
    <Sheet open={Boolean(dismissing)} title="Dismiss pay stub request" onClose={() => { if (!busy) setDismissing(null) }} footer={<Button onClick={() => { void dismiss() }} loading={busy} disabled={!online} title={!online ? 'Reconnect to dismiss' : undefined}>Dismiss request</Button>}><Field label="Note (optional)"><Textarea value={note} onChange={event => setNote(event.target.value)} /></Field>{error && <p role="alert">{error}</p>}</Sheet>
  </>
}
