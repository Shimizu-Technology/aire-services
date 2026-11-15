import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { PayStubError, payStubsApi, type PayStubLink, type PeriodPayStubWorker } from '../../lib/payStubsApi'
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
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [sending, setSending] = useState<PeriodPayStubWorker | null>(null)
  const period = useMemo(() => ({ start, end, statementIds: sending?.statements.map(row => row.id) ?? [] }), [start, end, sending])

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
    ...current, workers: current.workers.map(row => row.worker.id === link.worker.id ? { ...row, links: [link, ...row.links] } : row),
  })

  if (state.status === 'loading') return <p role="status" className="mt-3 text-body-sm text-ink-muted">Loading pay stubs…</p>
  if (state.status === 'error') return <div className="mt-3 space-y-2"><p role="alert" className="text-body-sm text-danger">{state.message}</p><Button variant="secondary" size="sm" onClick={() => { setState({ status: 'loading' }); setAttempt(value => value + 1) }}>Try again</Button></div>
  if (state.workers.length === 0) return <p className="mt-3 text-body-sm text-ink-muted">No issued pay stubs are available for this period yet.</p>

  return <>
    <p className="mt-1 text-body-sm text-ink-muted">Send one person a secure link at a time. Check the recipient before sending.</p>
    <ul className="mt-3 divide-y divide-line">
      {state.workers.map(row => {
        const { worker, links } = row
        const delivered = links.find(link => !['failed', 'pending'].includes(link.state))
        const latest = links[0]
        return <li key={worker.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <Link to={`${ADMIN_PATHS.team}/${worker.id}`} className="break-words text-body font-semibold text-primary underline underline-offset-2">{worker.name}</Link>
            {!worker.on_file_email && <p className="text-body-sm text-ink-muted">No email on file — add one on their page</p>}
            {delivered && <p className="text-body-sm text-ink-muted">Link sent {formatWhen(delivered.sent_at)} · {LINK_STATE[delivered.state].label}</p>}
            {latest?.state === 'failed' && <p className="text-body-sm text-danger">The email failed. That link was cancelled; you can try again.</p>}
            {latest?.state === 'pending' && <p className="text-body-sm text-ink-muted">A send is still being confirmed. Refresh before sending again.</p>}
          </div>
          {worker.on_file_email && capabilities.send_pay_statements && <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setSending(row)}>Send pay stub<span className="sr-only"> to {worker.name}</span></Button>}
        </li>
      })}
    </ul>
    {sending !== null && <SendPayStubDialog workerId={sending.worker.id} period={period} canChooseRecipient={capabilities.preview_pay} onClose={() => setSending(null)} onSent={sent} />}
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
