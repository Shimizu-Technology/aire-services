import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type PayrollCutoff, type PayrollCutoffResponse } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import { useDialogFocus } from '../../lib/useDialogFocus'
import './PayrollCutoffNotice.css'

interface Props {
  kiosk?: { accessToken: string; employeeToken: string; sessionKey: string; notice: PayrollCutoffResponse | null }
}

const CACHE_KEY = 'aire:last-payroll-cutoff'
function lastKnownCutoff(): PayrollCutoffResponse | null {
  try {
    const cutoff = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') as PayrollCutoff | null
    if (!cutoff || !['none', '24h', '4h', 'passed', 'finalizing'].includes(cutoff.stage)) return null
    copy(cutoff, true) // Discard incomplete or corrupt cached dates.
    return { cutoff }
  } catch { return null }
}

function identity(cutoff: PayrollCutoff) {
  return `${cutoff.period?.id}:${cutoff.publication_id}:${cutoff.version}:${cutoff.stage}`
}

const format = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', ...options }).format(new Date(value))
function periodLabel(period: NonNullable<PayrollCutoff['period']>) {
  return `${format(`${period.start_date}T12:00:00+10:00`, { month: 'long', day: 'numeric' })}–${format(`${period.end_date}T12:00:00+10:00`, { day: 'numeric' })}`
}

function copy(cutoff: PayrollCutoff, stale: boolean) {
  const dateKey = (value: string) => format(value, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const period = cutoff.period ? periodLabel(cutoff.period) : ''
  let when = ''
  if (!stale && cutoff.cutoff_at) {
    if (dateKey(cutoff.now) === dateKey(cutoff.cutoff_at)) when = ' today'
    else if (dateKey(new Date(new Date(cutoff.now).getTime() + 86400000).toISOString()) === dateKey(cutoff.cutoff_at)) when = ' tomorrow'
  }
  const title = cutoff.stage === 'finalizing' ? 'Cutoff reached; payroll is finalizing.'
    : cutoff.stage === 'passed' ? 'The payroll cutoff has passed.'
    : stale ? `${period} payroll cutoff` : `Your ${period} hours lock${when}`
  const absolute = cutoff.cutoff_at ? `${format(cutoff.cutoff_at, { month: 'long', day: 'numeric', year: 'numeric' })} at ${format(cutoff.cutoff_at, { hour: 'numeric', minute: '2-digit' })} ChST (UTC+10)` : ''
  return { title, period, absolute }
}

/** The server supplies policy and time. Polling never produces a browser-clock countdown. */
export default function PayrollCutoffNotice({ kiosk }: Props) {
  const { userRole, currentUser, isClerkEnabled } = useAuthContext()
  const isAdmin = !kiosk && (!isClerkEnabled || userRole === 'admin')
  const [response, setResponse] = useState<PayrollCutoffResponse | null>(lastKnownCutoff)
  const [stale, setStale] = useState(false)
  const [validated, setValidated] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [ackError, setAckError] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const bannerRef = useRef<HTMLElement>(null)
  const requestSequence = useRef(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const accessToken = kiosk?.accessToken
  const sessionKey = kiosk?.sessionKey ?? String(currentUser?.id ?? 'staff')
  const activeSession = useRef(sessionKey)
  useLayoutEffect(() => { activeSession.current = sessionKey }, [sessionKey])
  const refresh = useCallback(async () => {
    const session = activeSession.current
    const sequence = ++requestSequence.current
    const result = await api.getPayrollCutoff(accessToken)
    if (session !== activeSession.current || sequence !== requestSequence.current) return
    if (result.data) {
      setResponse(result.data); setStale(false); setValidated(true)
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(result.data.cutoff)) } catch { /* Storage may be unavailable on shared devices. */ }
    }
    else setStale(true)
    if (isAdmin) {
      const approvals = await api.getPendingApprovals({ per_page: 1 })
      if (session === activeSession.current && sequence === requestSequence.current) setPending(approvals.data?.summary?.entry_count ?? approvals.data?.count ?? null)
    }
  }, [accessToken, isAdmin])
  useEffect(() => {
    let active = true
    const run = () => { if (active) return refresh() }
    void run()
    const stop = startVisibilityAwarePolling(run, 60_000)
    window.addEventListener('focus', run)
    window.addEventListener('aire:clock-action', run)
    return () => { active = false; requestSequence.current += 1; stop(); window.removeEventListener('focus', run); window.removeEventListener('aire:clock-action', run) }
  }, [refresh, sessionKey])

  // A kiosk dialog may open only from a verified PIN/action response. Background
  // refreshes update the banner without interrupting an action already in progress.
  const notice = kiosk ? kiosk.notice : response
  const cutoff = (!validated || stale) && kiosk?.notice ? kiosk.notice.cutoff : response?.cutoff ?? kiosk?.notice?.cutoff
  const noticeCutoff = notice?.cutoff
  const noticeKey = noticeCutoff ? `${sessionKey}:${identity(noticeCutoff)}` : ''
  const open = !!noticeCutoff && (validated || !!kiosk?.notice) && (!stale || !!kiosk?.notice) && !notice?.acknowledged && !dismissed.has(noticeKey)
    && (noticeCutoff.stage === '24h' || noticeCutoff.stage === '4h')
    && (!kiosk || stale || (!!cutoff && identity(cutoff) === identity(noticeCutoff)))
  const dismiss = () => {
    if (!noticeCutoff?.period || !noticeCutoff.publication_id || noticeCutoff.version === null) return
    setDismissed(previous => new Set(previous).add(noticeKey))
    const session = sessionKey
    void api.acknowledgePayrollCutoff({ period_id: noticeCutoff.period.id, publication_id: noticeCutoff.publication_id, version: noticeCutoff.version, stage: noticeCutoff.stage }, kiosk).then(result => {
      if (activeSession.current !== session) return
      setAckError(!!result.error)
      if (result.status === 409) void refresh()
    })
  }
  useDialogFocus(open, dialogRef, dismiss, '[data-cutoff-ack]')
  useEffect(() => {
    if (!open) return
    const banner = bannerRef.current
    return () => {
      if (document.activeElement === document.body || (document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled)) banner?.focus()
    }
  }, [open])
  const attention = isAdmin && validated ? response?.attention : null
  const attentionNotice = attention ? <section aria-label="Payroll attention" className="cutoff-notice mb-4">
    <h2 className="font-semibold">Payroll needs attention</h2>
    <p className="mt-1">The {periodLabel(attention.period)} {attention.lock_mode === 'manual' ? 'manual payroll lock' : 'scheduled payroll finalization'} did not complete. Review its status with your accountant before retrying.</p>
    <Link to="/admin/payroll" className="mt-2 inline-flex min-h-11 items-center">Review payroll status</Link>
    {stale && <p className="mt-2">Last known payroll status · unable to refresh.</p>}
  </section> : null
  if (!cutoff) return attentionNotice
  if (!cutoff.period) return attentionNotice || (isAdmin ? <section aria-label="Payroll cutoff setup" className="cutoff-notice">No scheduled payroll cutoff is published. <Link to="/admin/payroll">Set up the payroll calendar</Link>.</section> : null)
  if (cutoff.stage === 'none') return attentionNotice
  const banner = copy(cutoff, stale || (!validated && !kiosk?.notice))
  const modal = noticeCutoff ? copy(noticeCutoff, stale) : banner
  const passed = cutoff.stage === 'passed' || cutoff.stage === 'finalizing'
  return <>
    {attentionNotice}
    <section ref={bannerRef} tabIndex={-1} aria-label="Payroll cutoff" className="cutoff-notice">
      <h2 className="font-semibold">{kiosk ? banner.title.replace(/^Your /, '') : banner.title}</h2>
      <p className="mt-1">{banner.period} hours · {banner.absolute}</p>
      {stale && <p className="mt-2 font-semibold">Last known cutoff · unable to refresh. Check with your manager.</p>}
      {passed ? <p className="mt-2">Later approved hours need the late-hours review process.</p>
        : <p className="mt-2">Review your hours and contact your manager about anything missing. You can keep clocking in and out.</p>}
      {!kiosk && <div className="mt-3 flex flex-wrap items-center gap-4">
        <Link to="/admin/time?tab=entries">Review my hours</Link>
        {isAdmin && <Link to="/admin/time?tab=approvals">{pending === null ? 'Review pending approvals' : `${pending} pending approval${pending === 1 ? '' : 's'}`}</Link>}
      </div>}
      {ackError && <p className="mt-2" role="status">Dismissed on this screen. We couldn’t save your acknowledgement; you may see it again on another device.</p>}
    </section>
    {open && <div className="cutoff-overlay">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cutoff-dialog-title" aria-describedby="cutoff-dialog-description" tabIndex={-1} className="cutoff-dialog">
        <button type="button" onClick={dismiss} className="cutoff-close" aria-label="Close payroll cutoff notice">Close</button>
        <p className="text-sm font-semibold text-cyan-800">Payroll reminder</p>
        <h2 id="cutoff-dialog-title" className="mt-2 text-xl font-semibold text-slate-900">{modal.title}</h2>
        <div id="cutoff-dialog-description" className="mt-4 space-y-3 text-slate-700">
          {stale && <p className="font-semibold">Last known cutoff · unable to refresh. Check with your manager.</p>}
          <p>Payroll locks on <strong>{modal.absolute}</strong>.</p>
          <p>Review your hours and contact your manager about anything missing before then. Hours approved after the cutoff may need a separate payroll run.</p>
          <p>You can keep clocking in and out. “Got it” changes no hours.</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={dismiss} data-cutoff-ack className="cutoff-primary">Got it</button>
          {!kiosk && <Link onClick={dismiss} to="/admin/time?tab=entries" className="cutoff-secondary">Review my hours</Link>}
        </div>
      </div>
    </div>}
  </>
}
