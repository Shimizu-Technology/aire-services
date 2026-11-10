import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Inbox, Link2, Send } from 'lucide-react'
import { StatusBadge } from '../../components/my-pay/MyPayParts'
import SendPayStubDialog from '../../components/pay-stubs/SendPayStubDialog'
import { LINK_STATE, describeRequest, formatWhen, linkDates } from '../../components/pay-stubs/payStubCopy'
import { PayStubError, payStubsApi, type PayStubLink, type PayStubRequest } from '../../lib/payStubsApi'
import { useCapabilities } from '../../lib/useCapabilities'

// Pay stubs for senders: owners, admins and managers. Workers' kiosk requests
// wait here to be sent or dismissed, and every sent link can be revoked.
// Only pay dates appear; amounts are never part of this page. Managers send
// only to a person's email on file; requests that name another address are
// marked and left for an owner or admin.

type Tab = 'requests' | 'links'
type DialogTarget = { request?: PayStubRequest; workerId?: number }
type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T }

const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:opacity-60'
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-100 hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none'

function message(error: unknown, fallback: string) {
  return error instanceof PayStubError ? error.message : fallback
}

function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: unknown): [Loadable<T>, (value: T) => void] {
  const [state, setState] = useState<{ key: unknown; value: Loadable<T> }>({ key, value: { status: 'loading' } })
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((value) => setState({ key, value: { status: 'ready', value } }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, value: { status: 'error', message: message(error, 'This list could not be loaded. Please try again.') } })
      })
    return () => controller.abort()
  }, [load, key])
  const current = state.key === key ? state.value : { status: 'loading' as const }
  return [current, (value: T) => setState({ key, value: { status: 'ready', value } })]
}

function RequestCard({ request, onSend, onDismissed }: { request: PayStubRequest; onSend: () => void; onDismissed: () => void }) {
  const ids = useId()
  const [dismissing, setDismissing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dismiss = async () => {
    setBusy(true)
    setError(null)
    try {
      await payStubsApi.dismiss(request.id, note.trim())
      onDismissed()
    } catch (caught) {
      setError(message(caught, 'The request could not be dismissed.'))
      setBusy(false)
    }
  }

  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-semibold text-slate-950">{request.worker.name}</p>
          <p className="mt-0.5 text-sm font-medium text-slate-800">{describeRequest(request)}</p>
        </div>
        <p className="text-sm text-slate-500">{request.source === 'kiosk' ? 'At the kiosk' : 'In AIRE'} · {formatWhen(request.requested_at)}</p>
      </div>
      <p className="mt-2 break-words text-sm text-slate-600">
        {request.recipient_email
          ? <>Send to <span className="font-medium text-slate-900">{request.recipient_email}</span> ({request.recipient_kind === 'typed' ? 'typed at the kiosk' : 'email on file'})</>
          : request.can_send ? 'No email on file yet.' : 'No email on file.'}
        {request.recipient_kind === 'typed' && (
          <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Not the email on file</span>
        )}
      </p>

      {dismissing ? (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label htmlFor={`${ids}-note`} className="block text-sm font-medium text-slate-800">
            Note <span className="font-normal text-slate-500">(optional, for example &ldquo;Handed over a printed copy&rdquo;)</span>
          </label>
          <textarea id={`${ids}-note`} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)}
            className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/30 sm:text-sm" />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={secondary} onClick={() => setDismissing(false)} disabled={busy}>Keep request</button>
            <button type="button" className={secondary} onClick={dismiss} disabled={busy}>{busy ? 'Dismissing…' : 'Dismiss request'}</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          {request.can_send
            ? <button type="button" className={primary} onClick={onSend}><Send className="h-4 w-4" aria-hidden="true" />Send</button>
            : <p className="text-sm font-medium text-slate-800 sm:mr-auto">An owner or admin needs to send this one.</p>}
          <button type="button" className={secondary} onClick={() => setDismissing(true)}>Dismiss</button>
        </div>
      )}
    </li>
  )
}

function ClosedRequests() {
  const load = useCallback((signal: AbortSignal) => payStubsApi.requests('closed', signal), [])
  const [state] = useLoad(load, 'closed')
  if (state.status === 'loading') return <p role="status" className="text-sm text-slate-500">Loading handled requests…</p>
  if (state.status === 'error') return <p role="alert" className="text-sm text-red-700">{state.message}</p>
  if (state.value.requests.length === 0) return <p className="text-sm text-slate-600">No requests were handled in the last 30 days.</p>
  return (
    <ul className="space-y-2">
      {state.value.requests.map((request) => (
        <li key={request.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <p className="font-medium text-slate-900">{request.worker.name} · {describeRequest(request)}</p>
          <p className="mt-0.5 text-slate-600">
            {request.status === 'fulfilled' ? 'Sent' : 'Dismissed'}{request.resolved_by ? ` by ${request.resolved_by}` : ''}{request.resolved_at ? ` · ${formatWhen(request.resolved_at)}` : ''}
            {request.resolution_note ? ` · “${request.resolution_note}”` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

// Read-only here; owners and admins change the list in Settings.
function NotificationRecipients() {
  const ids = useId()
  const load = useCallback((signal: AbortSignal) => payStubsApi.notificationEmails(signal), [])
  const [state] = useLoad(load, 'notification')

  if (state.status !== 'ready') return null
  const { emails, editable } = state.value

  return (
    <section aria-labelledby={`${ids}-title`} className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 sm:p-5">
      <h2 id={`${ids}-title`} className="text-sm font-semibold text-slate-900">Email a heads-up about new kiosk requests</h2>
      <p className="mt-1 text-sm text-slate-600">
        {emails.length > 0 ? `New requests are also emailed to ${emails.join(', ')}.` : 'Nobody is emailed now; new requests appear only in this list.'}
        {' '}The heads-up names the person and what they asked for, never pay details.
      </p>
      {editable
        ? <Link to="/admin/settings#pay-stubs" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-700 hover:text-cyan-900 focus-visible:outline-2 focus-visible:outline-cyan-600">Change recipients in Settings</Link>
        : <p className="mt-2 text-sm text-slate-500">An owner or admin can change this in Settings.</p>}
    </section>
  )
}

function RequestsPanel({ refreshKey, onSend, onChanged }: { refreshKey: number; onSend: (request: PayStubRequest) => void; onChanged: () => void }) {
  const load = useCallback((signal: AbortSignal) => payStubsApi.requests('open', signal), [])
  const [state] = useLoad(load, refreshKey)
  const [showClosed, setShowClosed] = useState(false)

  return (
    <div className="space-y-6">
      {state.status === 'loading' && <p role="status" className="text-sm text-slate-500">Loading requests…</p>}
      {state.status === 'error' && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{state.message}</p>}
      {state.status === 'ready' && state.value.requests.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
          <Inbox className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-slate-900">No open requests</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">When someone asks for a pay stub at the kiosk, it shows up here for you to send.</p>
        </div>
      )}
      {state.status === 'ready' && state.value.requests.length > 0 && (
        <ul className="space-y-3">
          {state.value.requests.map((request) => <RequestCard key={request.id} request={request} onSend={() => onSend(request)} onDismissed={onChanged} />)}
        </ul>
      )}

      <div>
        <button type="button" aria-expanded={showClosed} onClick={() => setShowClosed((value) => !value)} className="min-h-11 rounded-lg px-1 text-sm font-semibold text-cyan-700 hover:text-cyan-900 focus-visible:outline-2 focus-visible:outline-cyan-600">
          {showClosed ? 'Hide handled requests' : 'Show handled requests (last 30 days)'}
        </button>
        {showClosed && <div className="mt-2"><ClosedRequests key={refreshKey} /></div>}
      </div>

      <NotificationRecipients />
    </div>
  )
}

function LinkCard({ link, onRevoked }: { link: PayStubLink; onRevoked: (link: PayStubLink) => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = LINK_STATE[link.state]
  const used = link.documents.reduce((sum, document) => sum + document.downloads_used, 0)

  const revoke = async () => {
    setBusy(true)
    setError(null)
    try {
      onRevoked((await payStubsApi.revoke(link.id)).link)
    } catch (caught) {
      setError(message(caught, 'The link could not be revoked.'))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <li className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-semibold text-slate-950">{link.worker.name}</p>
          <p className="mt-0.5 break-all text-sm text-slate-600">To {link.recipient_email}</p>
        </div>
        <StatusBadge label={state.label} tone={state.tone} />
      </div>
      <p className="mt-2 text-sm text-slate-800">{link.documents.length === 1 ? '1 pay stub' : `${link.documents.length} pay stubs`}: {linkDates(link)}</p>
      <p className="mt-1 text-sm text-slate-500">
        {link.origin === 'self' ? 'Emailed from My Pay' : `Sent by ${link.sent_by}`} · {formatWhen(link.sent_at)}
        {link.state === 'revoked' && link.revoked_by ? ` · Revoked by ${link.revoked_by}` : ` · Expires ${formatWhen(link.expires_at)}`}
        {` · Downloaded ${used} ${used === 1 ? 'time' : 'times'}`}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {link.state === 'active' && (confirming ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-red-900">Turn this link off now? Nobody will be able to download from it.</p>
          <div className="flex gap-2">
            <button type="button" className={secondary} onClick={() => setConfirming(false)} disabled={busy}>Keep</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-60" onClick={revoke} disabled={busy}>
              {busy ? 'Revoking…' : 'Revoke link'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={`${secondary} mt-3`} onClick={() => setConfirming(true)}>Revoke</button>
      ))}
    </li>
  )
}

function LinksPanel({ refreshKey }: { refreshKey: number }) {
  const load = useCallback((signal: AbortSignal) => payStubsApi.links(null, signal), [])
  const [state, setLoaded] = useLoad(load, refreshKey)
  if (state.status === 'loading') return <p role="status" className="text-sm text-slate-500">Loading sent links…</p>
  if (state.status === 'error') return <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{state.message}</p>
  if (state.value.links.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
        <Link2 className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold text-slate-900">No links sent yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">Links you and others send appear here, newest first, so you can check downloads or revoke one.</p>
      </div>
    )
  }
  const replace = (updated: PayStubLink) => setLoaded({ links: state.value.links.map((link) => (link.id === updated.id ? updated : link)) })
  return <ul className="space-y-3">{state.value.links.map((link) => <LinkCard key={link.id} link={link} onRevoked={replace} />)}</ul>
}

export default function PayStubs() {
  const canChooseRecipient = useCapabilities().preview_pay
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'links' ? 'links' : 'requests'
  const sendTo = params.get('send')
  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [openCount, setOpenCount] = useState<number | null>(null)

  // A person's page links here with ?send=<user id> to start a send for them.
  const target: DialogTarget | null = dialog ?? (sendTo && /^[1-9]\d*$/.test(sendTo) ? { workerId: Number(sendTo) } : null)

  useEffect(() => {
    const controller = new AbortController()
    payStubsApi.requests('open', controller.signal).then((data) => setOpenCount(data.open_count)).catch(() => undefined)
    return () => controller.abort()
  }, [refreshKey])

  const setTab = (next: Tab) => {
    const query = new URLSearchParams(params)
    if (next === 'requests') query.delete('tab')
    else query.set('tab', next)
    setParams(query, { replace: true })
  }

  const closeDialog = () => {
    setDialog(null)
    if (sendTo) {
      const query = new URLSearchParams(params)
      query.delete('send')
      setParams(query, { replace: true })
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'requests', label: openCount ? `Requests (${openCount})` : 'Requests' },
    { key: 'links', label: 'Sent links' },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">AIRE Ops</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Pay stubs</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Email people a secure link to their pay stubs. You pick pay dates only; amounts never appear here or in the email.
          </p>
        </div>
        <button type="button" className={`${primary} shrink-0`} onClick={() => setDialog({})}>
          <Send className="h-4 w-4" aria-hidden="true" />
          Send a pay stub
        </button>
      </div>

      <div role="tablist" aria-label="Pay stub lists" className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-cyan-600 ${tab === item.key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'requests'
          ? <RequestsPanel refreshKey={refreshKey} onSend={(request) => setDialog({ request })} onChanged={() => setRefreshKey((value) => value + 1)} />
          : <LinksPanel refreshKey={refreshKey} />}
      </div>

      {target && (
        <SendPayStubDialog
          request={target.request}
          workerId={target.workerId}
          canChooseRecipient={canChooseRecipient}
          onClose={closeDialog}
          onSent={() => setRefreshKey((value) => value + 1)}
        />
      )}
    </div>
  )
}
