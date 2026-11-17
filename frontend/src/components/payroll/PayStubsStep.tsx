import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { PayStubError, payStubsApi, saveBlob, type PayStubLink, type PeriodPayStubWorker } from '../../lib/payStubsApi'
import { useCapabilities } from '../../lib/useCapabilities'
import SendPayStubDialog from '../pay-stubs/SendPayStubDialog'
import { formatWhen, LINK_STATE } from '../pay-stubs/payStubCopy'
import { Button } from '../ui'
import { dayLabel } from '../today/format'

export interface PayStubsStepProps {
  start: string
  end: string
  paid: boolean
  payDate: string | null
  /** Today in Guam (YYYY-MM-DD). */
  today: string
}

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; workers: PeriodPayStubWorker[] }

function PeriodStubs({ start, end }: { start: string; end: string }) {
  const capabilities = useCapabilities()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const download = async (workerId: number, statementId: string) => {
    setDownloadError(null)
    setDownloading(`${workerId}:${statementId}`)
    try {
      const result = await payStubsApi.download(workerId, statementId)
      saveBlob(result.blob, result.filename)
    } catch (error) {
      setDownloadError(error instanceof PayStubError ? error.message : "The PDF couldn't be downloaded. Please try again.")
    } finally { setDownloading(null) }
  }
  const [sending, setSending] = useState<PeriodPayStubWorker | null>(null)
  const period = useMemo(() => {
    const request = sending?.open_requests?.find(request => request.recipient_kind === 'on_file' &&
      ['latest', 'pay_date'].includes(request.scope) && sending.statements.some(row => row.id === request.statement_id))
    return { start, end, worker: sending?.worker, inactive: sending?.inactive, statementIds: sending?.statements.map(row => row.id) ?? [], requestId: request?.id, requestStatementId: request?.statement_id }
  }, [start, end, sending])

  useEffect(() => {
    const controller = new AbortController()
    payStubsApi.period(start, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ status: 'ready', workers: data.workers })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof PayStubError ? error.message : "Pay stubs couldn't be loaded. Please try again." })
    })
    return () => controller.abort()
  }, [start, attempt])

  const sent = (link: PayStubLink) => setState(current => current.status !== 'ready' ? current : {
    ...current, workers: current.workers.map(row => row.worker.id === link.worker.id ? { ...row, links: [link, ...row.links], open_requests: row.open_requests?.filter(request => request.id !== link.request_id) } : row),
  })

  if (state.status === 'loading') return <p role="status" className="mt-3 text-body-sm text-ink-muted">Loading pay stubs…</p>
  if (state.status === 'error') return <div className="mt-3 space-y-2"><p role="alert" className="text-body-sm text-danger">{state.message}</p><Button variant="secondary" size="sm" onClick={() => { setState({ status: 'loading' }); setAttempt(value => value + 1) }}>Try again</Button></div>
  if (state.workers.length === 0) return <p className="mt-3 text-body-sm text-ink-muted">No issued pay stubs are available for this period yet.</p>

  return <>
    <p className="mt-1 text-body-sm text-ink-muted">Send one person a secure link at a time. Check the recipient before sending. Sending again creates a new link. The earlier link still works until it expires.</p>
    <Link to="/admin/pay-stubs" className="text-body-sm text-primary underline underline-offset-2">Sent links and requests</Link>
    {downloadError && <p role="alert" className="mt-3 text-body-sm text-danger">{downloadError}</p>}
    <ul className="mt-3 divide-y divide-line">
      {state.workers.map(row => {
        const { worker, links } = row
        const previouslySent = links.some(link => !['failed', 'pending'].includes(link.state))
        const latest = links[0]
        return <li key={worker.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <Link to={`${ADMIN_PATHS.team}/${worker.id}`} className="break-words text-body font-semibold text-primary underline underline-offset-2">{worker.name}</Link>
            {row.inactive ? <p className="text-body-sm text-ink-muted">{LINK_STATE.inactive.label}{!capabilities.manage_payroll && " — stubs can't be emailed from here"}</p> : !worker.on_file_email && <p className="text-body-sm text-ink-muted">No email on file — <Link to={`${ADMIN_PATHS.team}/${worker.id}`} className="text-primary underline underline-offset-2">add one on their page</Link></p>}
            {row.open_requests?.length > 0 && <p className="text-body-sm text-ink-muted">Asked for their stub{row.open_requests.some(request => request.recipient_kind === 'typed') && <> — asked for a different email; handle that request in <Link to="/admin/pay-stubs" className="text-primary underline underline-offset-2">Sent links and requests</Link></>}</p>}
            {row.lookup_failed ? <p className="text-body-sm text-ink-muted">Couldn't check this person's stubs — <button className="text-primary underline underline-offset-2 whitespace-nowrap min-h-11 min-w-11" onClick={() => setAttempt(value => value + 1)}>Try again</button></p> : latest && <p className={`text-body-sm ${latest.state === 'failed' ? 'text-danger' : 'text-ink-muted'}`}>
              {latest.state === 'failed' ? 'The email failed. That link was cancelled; you can try again.' : latest.state === 'pending' ? (now - Date.parse(latest.sent_at) > 5 * 60_000 ? "Didn't finish — you can send again" : 'A send is still being confirmed. Refresh before sending again.') : `Link sent ${formatWhen(latest.sent_at)} · ${LINK_STATE[latest.state].label}`}
            </p>}

          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
          {(!row.inactive || capabilities.manage_payroll) && !row.lookup_failed && (worker.on_file_email || (row.inactive && capabilities.manage_payroll)) && capabilities.send_pay_statements && <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setSending(row)}>{previouslySent ? 'Send again' : 'Send pay stub'}<span className="sr-only"> to {worker.name}</span></Button>}
          {capabilities.manage_payroll && !row.lookup_failed && row.statements.map(statement => <Button key={statement.id} variant="secondary" size="sm" disabled={downloading !== null} aria-busy={downloading === `${worker.id}:${statement.id}`} onClick={() => void download(worker.id, statement.id)}>
            {downloading === `${worker.id}:${statement.id}` ? 'Downloading…' : 'Download PDF'}{row.statements.length > 1 && ` (${statement.pay_date})`}<span className="sr-only"> for {worker.name}</span>
          </Button>)}
          </div>
        </li>
      })}
    </ul>
    {sending !== null && <SendPayStubDialog workerId={sending.worker.id} resend={sending.links.some(link => link.state === 'active')} period={period} canChooseRecipient={capabilities.preview_pay} onClose={() => setSending(null)} onSent={sent} />}
  </>
}

export function PayStubsStep({ start, end, paid, payDate, today }: PayStubsStepProps) {
  const available = paid || (payDate !== null && payDate <= today)
  return (
    <section aria-labelledby="pay-stubs-step" className="rounded-card border border-line bg-surface p-4">
      <h2 id="pay-stubs-step" className="text-body font-semibold text-ink">Pay stubs</h2>
      {available ? <PeriodStubs key={start} start={start} end={end} /> : (
        <p className="mt-1 text-body-sm text-ink-muted">
          {payDate ? <>Available after payday ({dayLabel(payDate)}).</> : 'Available after payday.'}
        </p>
      )}
    </section>
  )
}
