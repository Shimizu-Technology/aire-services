import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { formatPayDate, formatPeriod, runPurposeLabel } from '../../lib/myPayApi'
import { PayStubError, payStubsApi, type PayStubDate, type PayStubLink, type PayStubRequest, type PayStubWorker } from '../../lib/payStubsApi'
import { describeRequest } from './payStubCopy'

// Send a secure link to some of one person's pay stubs. Senders pick from pay
// dates and periods only; the API never returns amounts to this dialog.
//
// Managers send only to the person's email on file, which they see masked.
// Owners and admins can also type another address, and only they can send a
// request made to an address that isn't on file. The API enforces both.

interface Props {
  /** Fulfil this request: person, stubs and recipient start from what they asked for. */
  request?: PayStubRequest | null
  /** Start with this person chosen (from a person's page). */
  workerId?: number | null
  /** Owners and admins (preview_pay): may send to an address that isn't on file. */
  canChooseRecipient: boolean
  onClose: () => void
  onSent: (link: PayStubLink) => void
}

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T }

function initialSelection(statements: PayStubDate[], request?: PayStubRequest | null): Set<string> {
  const sendable = statements.filter((statement) => !statement.voided)
  if (!request) return new Set(sendable.slice(0, 1).map((statement) => statement.id))
  if (request.scope === 'pay_date') return new Set(sendable.filter((statement) => statement.id === request.statement_id).map((statement) => statement.id))
  if (request.scope === 'year') return new Set(sendable.filter((statement) => statement.pay_date?.startsWith(String(request.year))).map((statement) => statement.id))
  return new Set(sendable.slice(0, 1).map((statement) => statement.id))
}

function groupByYear(statements: PayStubDate[]) {
  const groups = new Map<string, PayStubDate[]>()
  for (const statement of statements) {
    const year = statement.pay_date?.slice(0, 4) || 'Undated'
    groups.set(year, [...(groups.get(year) ?? []), statement])
  }
  return [...groups.entries()]
}

const field = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/30 sm:text-sm'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:opacity-60'
const primary = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-100 hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'

export default function SendPayStubDialog({ request, workerId, canChooseRecipient, onClose, onSent }: Props) {
  const ids = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(true, dialogRef, onClose)

  const fixedWorker = request?.worker ?? null
  const [workers, setWorkers] = useState<Loadable<PayStubWorker[]>>(fixedWorker ? { status: 'ready', value: [fixedWorker] } : { status: 'loading' })
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(fixedWorker?.id ?? workerId ?? null)
  const [statements, setStatements] = useState<Loadable<PayStubDate[]> | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // A request to a typed address goes only to that address, which the API
  // takes from the saved request.
  const typedRequest = request?.recipient_kind === 'typed' ? request.recipient_email ?? '' : null
  const blocked = typedRequest !== null && !canChooseRecipient
  const [destination, setDestination] = useState<'on_file' | 'typed'>('on_file')
  const [email, setEmail] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ link: PayStubLink; captured: boolean } | null>(null)

  useEffect(() => {
    if (fixedWorker) return
    const controller = new AbortController()
    payStubsApi.workers(controller.signal)
      .then((data) => setWorkers({ status: 'ready', value: data.workers }))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setWorkers({ status: 'error', message: caught instanceof PayStubError ? caught.message : "People couldn't be loaded." })
      })
    return () => controller.abort()
  }, [fixedWorker])

  useEffect(() => {
    if (!selectedWorkerId) return
    const controller = new AbortController()
    payStubsApi.statements(selectedWorkerId, controller.signal)
      .then((data) => {
        setStatements({ status: 'ready', value: data.statements })
        setSelected(initialSelection(data.statements, request))
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setStatements({ status: 'error', message: caught instanceof PayStubError ? caught.message : "Pay dates couldn't be loaded." })
      })
    return () => controller.abort()
  }, [selectedWorkerId, request])

  const worker = workers.status === 'ready' ? workers.value.find((candidate) => candidate.id === selectedWorkerId) ?? null : null
  const onFile = worker?.on_file_email ?? null
  const effectiveDestination = typedRequest !== null || (canChooseRecipient && (!onFile || destination === 'typed')) ? 'typed' : 'on_file'
  const typing = effectiveDestination === 'typed' && typedRequest === null
  const typedMismatch = typing && confirmation.length > 0 && email.trim().toLowerCase() !== confirmation.trim().toLowerCase()
  const recipient = typedRequest ?? (effectiveDestination === 'on_file' ? onFile : email.trim().toLowerCase())
  const canSend = Boolean(worker) && selected.size > 0 && !sending && !blocked
    && (typedRequest !== null || (effectiveDestination === 'on_file' ? Boolean(onFile) : email.trim().includes('@') && email.trim().toLowerCase() === confirmation.trim().toLowerCase()))

  const notOnFileBadge = (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Not the email on file</span>
  )

  let recipientSection: React.ReactNode = null
  if (worker && typedRequest !== null) {
    recipientSection = (
      <div>
        <p className="text-sm font-semibold text-slate-800">Send to</p>
        <p className="mt-1 break-all text-sm text-slate-900">{typedRequest}{notOnFileBadge}</p>
        <p className="mt-1 text-sm text-slate-600">
          {blocked
            ? 'They typed this address at the kiosk. An owner or admin needs to send this one.'
            : 'They typed this address at the kiosk. If it looks unfamiliar, check with them before sending.'}
        </p>
      </div>
    )
  } else if (worker && !canChooseRecipient) {
    recipientSection = (
      <div>
        <p className="text-sm font-semibold text-slate-800">Send to</p>
        <p className="mt-1 break-all text-sm text-slate-900">
          {onFile ? `${onFile} (email on file)` : `There's no email on file for ${worker.first_name}. An owner or admin can send to another address.`}
        </p>
      </div>
    )
  } else if (worker) {
    recipientSection = (
      <fieldset>
        <legend className="text-sm font-semibold text-slate-800">Send to</legend>
        <div className="mt-2 space-y-2">
          <label className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 ${onFile ? 'cursor-pointer border-slate-200' : 'cursor-not-allowed border-slate-100 bg-slate-50'}`}>
            <input type="radio" name={`${ids}-destination`} checked={effectiveDestination === 'on_file'} disabled={!onFile} onChange={() => setDestination('on_file')} className="h-5 w-5 accent-[#1e3a5f]" />
            <span className="min-w-0 text-sm">
              <span className="block font-medium text-slate-900">Email on file</span>
              <span className="block break-all text-slate-600">{onFile ?? 'No email on file'}</span>
            </span>
          </label>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
            <input type="radio" name={`${ids}-destination`} checked={effectiveDestination === 'typed'} onChange={() => setDestination('typed')} className="h-5 w-5 accent-[#1e3a5f]" />
            <span className="text-sm font-medium text-slate-900">Another email</span>
          </label>
          {typing && (
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <label className="text-sm text-slate-700" htmlFor={`${ids}-email`}>
                Email
                <input id={`${ids}-email`} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => { setError(null); setEmail(event.target.value) }} className={field} />
              </label>
              <label className="text-sm text-slate-700" htmlFor={`${ids}-confirm`}>
                Type it again
                <input id={`${ids}-confirm`} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={confirmation} onChange={(event) => { setError(null); setConfirmation(event.target.value) }}
                  aria-invalid={typedMismatch} aria-describedby={typedMismatch ? `${ids}-mismatch` : undefined} className={field} />
              </label>
              {typedMismatch && <p id={`${ids}-mismatch`} className="text-sm text-amber-800 sm:col-span-2">The two emails don&apos;t match yet.</p>}
            </div>
          )}
        </div>
      </fieldset>
    )
  }

  const groups = useMemo(() => (statements?.status === 'ready' ? groupByYear(statements.value) : []), [statements])

  const chooseWorker = (value: string) => {
    setError(null)
    setStatements(value ? { status: 'loading' } : null)
    setSelected(new Set())
    setSelectedWorkerId(value ? Number(value) : null)
  }

  const toggle = (id: string) => {
    setError(null)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleYear = (rows: PayStubDate[]) => {
    const sendable = rows.filter((row) => !row.voided).map((row) => row.id)
    const all = sendable.every((id) => selected.has(id))
    setSelected((current) => {
      const next = new Set(current)
      sendable.forEach((id) => (all ? next.delete(id) : next.add(id)))
      return next
    })
  }

  const send = async () => {
    if (!worker || !canSend) return
    setSending(true)
    setError(null)
    try {
      const result = await payStubsApi.send({
        userId: worker.id,
        statementIds: [...selected],
        requestId: request?.id ?? null,
        ...(typing ? { email: email.trim(), emailConfirmation: confirmation.trim() } : {}),
      })
      setSent({ link: result.link, captured: result.email_status === 'captured' })
      onSent(result.link)
    } catch (caught) {
      setError(caught instanceof PayStubError ? caught.message : 'The link could not be sent. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-6" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`}
        className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={`${ids}-title`} className="text-lg font-semibold text-slate-950">{sent ? 'Link sent' : 'Send a pay stub'}</h2>
            {request && !sent && <p className="mt-0.5 text-sm text-slate-600">{request.worker.name} asked for: {describeRequest(request)}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-600">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {sent ? (
          <div className="space-y-4 px-5 py-6 sm:px-6">
            <CheckCircle2 className="h-9 w-9 text-emerald-600" aria-hidden="true" />
            <p role="status" className="text-base text-slate-800">
              {sent.captured
                ? `Staging captured this email for ${sent.link.recipient_email}; nothing was delivered.`
                : `We emailed a secure link to ${sent.link.recipient_email}.`}
            </p>
            <p className="text-sm text-slate-600">
              It works until {new Date(sent.link.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, and each stub can be downloaded {sent.link.max_downloads_per_document} times. You can revoke it from Sent links.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={primary}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
              {!fixedWorker && (
                <div>
                  <label htmlFor={`${ids}-worker`} className="text-sm font-semibold text-slate-800">Person</label>
                  {workers.status === 'loading' && <p role="status" className="mt-1 text-sm text-slate-500">Loading people…</p>}
                  {workers.status === 'error' && <p role="alert" className="mt-1 text-sm text-red-700">{workers.message}</p>}
                  {workers.status === 'ready' && (
                    <select id={`${ids}-worker`} value={selectedWorkerId ?? ''} onChange={(event) => chooseWorker(event.target.value)} className={field}>
                      <option value="">Choose a person</option>
                      {workers.value.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                  )}
                </div>
              )}

              {selectedWorkerId && (
                <fieldset>
                  <legend className="text-sm font-semibold text-slate-800">Pay stubs</legend>
                  <p className="mt-0.5 text-xs text-slate-500">Pay dates only. Amounts aren&apos;t shown here or in the email.</p>
                  {(!statements || statements.status === 'loading') && <p role="status" className="mt-3 text-sm text-slate-500">Loading pay dates…</p>}
                  {statements?.status === 'error' && <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{statements.message}</p>}
                  {statements?.status === 'ready' && statements.value.length === 0 && <p className="mt-3 text-sm text-slate-600">No pay stubs yet for this person.</p>}
                  {groups.map(([year, rows]) => {
                    const sendable = rows.filter((row) => !row.voided)
                    const all = sendable.length > 0 && sendable.every((row) => selected.has(row.id))
                    return (
                      <div key={year} className="mt-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{year}</p>
                          {sendable.length > 1 && (
                            <button type="button" onClick={() => toggleYear(rows)} className="min-h-11 rounded-lg px-2 text-sm font-semibold text-cyan-700 hover:text-cyan-900 focus-visible:outline-2 focus-visible:outline-cyan-600">
                              {all ? `Clear ${year}` : `Select all ${year}`}
                            </button>
                          )}
                        </div>
                        <ul className="mt-1 divide-y divide-slate-100 rounded-xl border border-slate-200">
                          {rows.map((row) => {
                            const purpose = runPurposeLabel(row.run_purpose ?? null)
                            return (
                              <li key={row.id}>
                                <label className={`flex min-h-12 items-center gap-3 px-3 py-2.5 ${row.voided ? 'cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                                  <input type="checkbox" checked={selected.has(row.id)} disabled={row.voided} onChange={() => toggle(row.id)} className="h-5 w-5 rounded border-slate-300 accent-[#1e3a5f]" />
                                  <span className="min-w-0 flex-1">
                                    <span className={`block text-sm font-medium ${row.voided ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{formatPayDate(row.pay_date)}</span>
                                    <span className="block text-xs text-slate-500">
                                      {row.voided ? "Voided, can't be sent" : `Period ${formatPeriod(row.period_start, row.period_end)}${purpose ? ` · ${purpose}` : ''}`}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })}
                </fieldset>
              )}

              {worker && recipientSection}

              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            </div>

            <div className="border-t border-slate-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
              {worker && selected.size > 0 && recipient && !blocked && (
                <p className="mb-3 text-sm text-slate-600">
                  Sends {selected.size === 1 ? '1 pay stub' : `${selected.size} pay stubs`} to <span className="break-all font-medium text-slate-900">{recipient}</span>. The link works for 7 days; each stub can be downloaded 5 times.
                </p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={onClose} disabled={sending} className={secondary}>Cancel</button>
                <button type="button" onClick={send} disabled={!canSend} aria-busy={sending} className={primary}>{sending ? 'Sending…' : 'Send secure link'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
