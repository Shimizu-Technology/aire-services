import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type PayrollCutoff, type PayrollCutoffResponse } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import { useDialogFocus } from '../../lib/useDialogFocus'
import './PayrollCutoffNotice.css'
import { withPayrollPeriod } from '../../lib/payrollPeriods'
import { LATE_HOURS_NOTICE } from '../../lib/payrollCutoffCopy'
import { PAUSED_PAYROLL_MESSAGE } from '../../lib/connectedPayroll'

interface Props {
  kiosk?: { accessToken: string; employeeToken: string; sessionKey: string; notice: PayrollCutoffResponse | null }
}

const CACHE_KEY = 'aire:last-payroll-cutoff'
function lastKnownCutoff(): PayrollCutoffResponse | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') as PayrollCutoffResponse | PayrollCutoff | null
    const cutoff = cached && ('cutoff' in cached ? cached.cutoff : cached)
    if (!cutoff || !['none', '24h', '4h', 'passed', 'finalizing'].includes(cutoff.stage)) return null
    copy(cutoff, true) // Discard incomplete or corrupt cached dates.
    return { cutoff, connected_payroll: cached && 'cutoff' in cached ? cached.connected_payroll : undefined }
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
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ cutoff: result.data.cutoff, connected_payroll: result.data.connected_payroll })) } catch { /* Storage may be unavailable on shared devices. */ }
    }
    else setStale(true)
    const period = result.data?.cutoff.period
    setPending(null)
    if (isAdmin && period && result.data?.cutoff.stage !== 'none' && result.data?.connected_payroll?.enabled !== false) {
      const approvals = await api.getPendingApprovals({ per_page: 1, start_date: period.start_date, end_date: period.end_date })
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
    window.addEventListener('aire:approvals-updated', run)
    return () => { active = false; requestSequence.current += 1; stop(); window.removeEventListener('focus', run); window.removeEventListener('aire:clock-action', run); window.removeEventListener('aire:approvals-updated', run) }
  }, [refresh, sessionKey])

  // A kiosk dialog may open only from a verified PIN/action response. Background
  // refreshes update the banner without interrupting an action already in progress.
  const notice = kiosk ? kiosk.notice : response
  const cutoff = (!validated || stale) && kiosk?.notice ? kiosk.notice.cutoff : response?.cutoff ?? kiosk?.notice?.cutoff
  // A verified PIN/action notice outranks shared cache. A newer live server
  // response may supersede it when the deployment mode changes afterwards.
  const liveConnection = validated && !stale && response?.connected_payroll ? response : null
  const pinConnection = kiosk?.notice?.connected_payroll ? kiosk.notice : null
  const connection = pinConnection && (!liveConnection || Date.parse(pinConnection.cutoff.now) >= Date.parse(liveConnection.cutoff.now))
    ? pinConnection.connected_payroll : liveConnection?.connected_payroll ?? response?.connected_payroll
  const paused = connection?.enabled === false
  const noticeCutoff = notice?.cutoff
  const noticeKey = noticeCutoff ? `${sessionKey}:${identity(noticeCutoff)}` : ''
  const open = !paused && !!noticeCutoff && (validated || !!kiosk?.notice) && (!stale || !!kiosk?.notice) && !notice?.acknowledged && !dismissed.has(noticeKey)
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
  if (paused) return <>{attentionNotice}<section aria-label="Payroll connection paused" className="cutoff-notice">{PAUSED_PAYROLL_MESSAGE}</section></>
  if (!cutoff) return attentionNotice
  if (!cutoff.period) return attentionNotice || (isAdmin && connection?.enabled === true ? <section aria-label="Payroll cutoff setup" className="cutoff-notice">No scheduled payroll cutoff is published. <Link to="/admin/payroll">Set up the payroll calendar</Link>.</section> : null)
  if (cutoff.stage === 'none') return attentionNotice
  const banner = copy(cutoff, stale || (!validated && !kiosk?.notice))
  const modal = noticeCutoff ? copy(noticeCutoff, stale) : banner
  const modalPeriod = noticeCutoff?.period || cutoff.period
  const passed = cutoff.stage === 'passed' || cutoff.stage === 'finalizing'
  return <>
    {attentionNotice}
    <section ref={bannerRef} tabIndex={-1} aria-label="Payroll cutoff" className="cutoff-notice">
      <h2 className="font-semibold">{kiosk || isAdmin ? banner.title.replace(/^Your /, '') : banner.title}</h2>
      <p className="mt-1">{banner.period} hours · {banner.absolute}</p>
      {stale && <p className="mt-2 font-semibold">Last known cutoff · unable to refresh. {isAdmin ? 'Check the payroll status with your accountant.' : 'Check with your manager.'}</p>}
      {passed ? <p className="mt-2">{LATE_HOURS_NOTICE}</p>
        : <p className="mt-2">{isAdmin ? "Review this period’s hours and pending approvals before the cutoff." : "Review your hours and contact your manager about anything missing."} You can keep clocking in and out.</p>}
      {!kiosk && <div className="mt-3 flex flex-wrap items-center gap-4">
        <Link to={withPayrollPeriod('/admin/time', { start: cutoff.period.start_date, end: cutoff.period.end_date }, { tab: 'entries', view: 'period' })}>{isAdmin ? 'Review period hours' : 'Review my hours'}</Link>
        {isAdmin && <Link to={withPayrollPeriod('/admin/time', { start: cutoff.period.start_date, end: cutoff.period.end_date }, { tab: 'approvals' })}>{pending === null ? 'Review pending approvals' : `${pending} pending approval${pending === 1 ? '' : 's'}`}</Link>}
      </div>}
      {ackError && <p className="mt-2" role="status">Dismissed on this screen. We couldn’t save your acknowledgement; you may see it again on another device.</p>}
    </section>
    {open && <div className="cutoff-overlay">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cutoff-dialog-title" aria-describedby="cutoff-dialog-description" tabIndex={-1} className="cutoff-dialog">
        <button type="button" onClick={dismiss} className="cutoff-close" aria-label="Close payroll cutoff notice">Close</button>
        <p className="text-sm font-semibold text-cyan-800">Payroll reminder</p>
        <h2 id="cutoff-dialog-title" className="mt-2 text-xl font-semibold text-slate-900">{isAdmin ? modal.title.replace(/^Your /, '') : modal.title}</h2>
        <div id="cutoff-dialog-description" className="mt-4 space-y-3 text-slate-700">
          {stale && <p className="font-semibold">Last known cutoff · unable to refresh. {isAdmin ? 'Check the payroll status with your accountant.' : 'Check with your manager.'}</p>}
          <p>Payroll locks on <strong>{modal.absolute}</strong>.</p>
          <p>{isAdmin ? "Review this period’s hours and pending approvals before then." : "Review your hours and contact your manager about anything missing before then."}</p>
          <p>{LATE_HOURS_NOTICE}</p>
          <p>You can keep clocking in and out. “Got it” changes no hours.</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={dismiss} data-cutoff-ack className="cutoff-primary">Got it</button>
          {!kiosk && <Link onClick={dismiss} to={withPayrollPeriod('/admin/time', { start: modalPeriod.start_date, end: modalPeriod.end_date }, { tab: 'entries', view: 'period' })} className="cutoff-secondary">{isAdmin ? 'Review period hours' : 'Review my hours'}</Link>}
          {isAdmin && <Link onClick={dismiss} to={withPayrollPeriod('/admin/time', { start: modalPeriod.start_date, end: modalPeriod.end_date }, { tab: 'approvals' })} className="cutoff-secondary">Review pending approvals</Link>}
        </div>
      </div>
    </div>}
  </>
}
