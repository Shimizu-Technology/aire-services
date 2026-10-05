import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import type { AdminUser } from '../../lib/api'
import { employeeEvidenceApi, type EmployeeEvidence, type EvidencePeriod, type EvidenceTotals } from '../../lib/employeeEvidenceApi'
import { employeeWorkspaceHref, safeAdminReturn, type EmployeeTab } from '../../lib/employeeWorkspace'
import EmployeeRelatedRecords from '../../components/time-tracking/EmployeeRelatedRecords'
import { formatDateTime } from '../../lib/dateUtils'

const tabs: { key: EmployeeTab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'hours', label: 'Hours & payroll' },
  { key: 'schedule', label: 'Schedule' }, { key: 'activity', label: 'Activity' }, { key: 'setup', label: 'Access & profile' },
]
const h = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}h`
const panel = 'rounded-2xl border border-slate-200 bg-white p-4 sm:p-6'
const action = 'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600'

function Totals({ totals }: { totals: EvidenceTotals }) {
  return <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {[
      ['Worked', totals.worked_hours], ['Currently eligible', totals.eligible_hours], ['Awaiting approval', totals.pending_hours],
      ['Issued source coverage', totals.issued_hours], ['Committed, unissued', totals.committed_hours],
      ['Exported, uncommitted', totals.exported_hours], ['Evidence hold', totals.held_hours], ['Needs reconciliation', totals.needs_reconciliation_hours],
    ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-xl font-semibold text-slate-950">{h(Number(value))}</dd></div>)}
  </dl>
}

export default function EmployeeWorkspace() {
  const { id = '' } = useParams()
  const [query, setQuery] = useSearchParams()
  const location = useLocation()
  const [user, setUser] = useState<AdminUser | null>(null)
  const [evidence, setEvidence] = useState<EmployeeEvidence | null>(null)
  const [detail, setDetail] = useState<EvidencePeriod | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [retry, setRetry] = useState(0)
  const tab = tabs.find((item) => item.key === query.get('tab'))?.key || 'overview'
  const startDate = query.get('start_date') || ''
  const endDate = query.get('end_date') || ''
  const cursor = query.get('cursor') || ''
  const selectedPeriod = query.get('period') || ''
  const selectedEntry = query.get('entry') || ''
  const detailCursor = query.get('detail_cursor') || ''
  const sourceUserUuid = query.get('source_user_uuid') || ''
  const sourceInstanceId = query.get('source_instance_id') || ''
  const returnTo = safeAdminReturn(query.get('return_to'))
  const currentPath = `${location.pathname}${location.search}`

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
    setLoading(true); setError(''); setUser(null); setEvidence(null)
    if (!/^[1-9]\d*$/.test(id)) { setError('This employee link is invalid. Return to Team and choose a person.'); setLoading(false); return }
    const filter = new URLSearchParams({ per_page: '20' })
    if (startDate) filter.set('start_date', startDate)
    if (endDate) filter.set('end_date', endDate)
    if (cursor) filter.set('cursor', cursor)
    await Promise.all([employeeEvidenceApi.user(id, controller.signal), employeeEvidenceApi.periods(id, filter, controller.signal)])
      .then(([profile, result]) => {
        if (controller.signal.aborted) return
        if (result.employee.id !== id || String(profile.user.id) !== id) throw new Error('Employee evidence identity does not match this record.')
        if ((sourceUserUuid && result.employee.payroll_integration_id !== sourceUserUuid) || (sourceInstanceId && result.integration.source_instance_id !== sourceInstanceId)) throw new Error('This saved employee link no longer matches the source installation or employee. Return to payroll and refresh the connection evidence.')
        setUser(profile.user); setEvidence(result); document.title = `${profile.user.full_name || profile.user.display_name} | AIRE Team`
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load employee.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }
    void load()
    return () => controller.abort()
  }, [id, startDate, endDate, cursor, sourceUserUuid, sourceInstanceId, retry])

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
    setDetail(null); setDetailError('')
    if (!selectedPeriod || !evidence) return
    const filter = new URLSearchParams()
    if (startDate) filter.set('start_date', startDate)
    if (endDate) filter.set('end_date', endDate)
    if (detailCursor) filter.set('detail_cursor', detailCursor)
    await employeeEvidenceApi.period(id, selectedPeriod, filter, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.employee.id !== id || result.employee.payroll_integration_id !== evidence.employee.payroll_integration_id || result.integration.source_instance_id !== evidence.integration.source_instance_id) throw new Error('Period evidence identity changed. Reload the employee record before continuing.')
      setDetail(result.period)
    }).catch((reason) => { if (!controller.signal.aborted) setDetailError(reason instanceof Error ? reason.message : 'Unable to load this period.') })
    }
    void load()
    return () => controller.abort()
  }, [id, selectedPeriod, evidence, startDate, endDate, detailCursor, retry])

  const update = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(query)
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    setQuery(next)
  }
  const related = (path: string, extras: Record<string, string> = {}) => {
    const params = new URLSearchParams({ user_id: id, return_to: currentPath, ...extras })
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    return `${path}?${params}`
  }

  return <div className="space-y-5">
    <Link to={returnTo} className="text-sm font-semibold text-cyan-800 hover:underline">Back to {returnTo.startsWith('/admin/users') ? 'Team' : 'previous view'}</Link>
    {loading ? <p role="status" className={panel}>Loading employee evidence…</p> : error ? <div role="alert" className={panel}><p>{error}</p><button className={`${action} mt-3`} onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : user && evidence && <>
      <header className={panel}>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Team member</p>
        <h1 className="mt-1 break-words text-2xl font-bold text-slate-950">{user.full_name || user.display_name}</h1>
        <p className="mt-2 text-sm text-slate-600">{user.staff_title || 'Staff'} · {user.employment_status} · {user.personal_access_enabled ? 'Personal sign-in' : user.kiosk_enabled ? 'Kiosk access' : 'No sign-in'}</p>
        <nav aria-label="Employee sections" className="mt-5 flex flex-wrap gap-2">{tabs.map((item) => <Link key={item.key} aria-current={tab === item.key ? 'page' : undefined} to={employeeWorkspaceHref(id, { tab: item.key, returnTo, startDate, endDate, period: selectedPeriod, entry: selectedEntry, cursor, detailCursor, sourceUserUuid, sourceInstanceId })} className={`${action} ${tab === item.key ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800' : ''}`}>{item.label}</Link>)}</nav>
      </header>
      {(tab === 'overview' || tab === 'hours') && <>
        <section className={`${panel} space-y-4`} aria-label="Employee hour totals">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">From<input aria-label="From work date" type="date" value={startDate} onChange={(event) => update({ start_date: event.target.value, cursor: null, period: null, entry: null, detail_cursor: null })} className="mt-1 block rounded-lg border border-slate-300 p-2" /></label>
            <label className="text-sm">Through<input aria-label="Through work date" type="date" value={endDate} onChange={(event) => update({ end_date: event.target.value, cursor: null, period: null, entry: null, detail_cursor: null })} className="mt-1 block rounded-lg border border-slate-300 p-2" /></label>
            {(startDate || endDate) && <button className={action} onClick={() => update({ start_date: null, end_date: null, cursor: null, period: null, entry: null, detail_cursor: null })}>All history</button>}
          </div>
          <p className="text-xs text-slate-500">Whole-filter totals · refreshed {formatDateTime(evidence.as_of)}</p>
          <Totals totals={evidence.totals} />
          <p className="text-sm leading-6 text-slate-600">{evidence.evidence_note}</p>
          {!!evidence.totals.unissued_correction_count && <p className="text-sm text-amber-800">{evidence.totals.unissued_correction_count} signed correction lines await issuance, including classification changes with zero net hours.</p>}
          {!!evidence.totals.identity_review_count && <p className="text-sm text-amber-800">{evidence.totals.identity_review_count} retained evidence lines need employee identity review. Frozen identities have been preserved.</p>}
          {!!evidence.totals.uncategorized_entry_count && <p className="text-sm text-amber-800">{evidence.totals.uncategorized_entry_count} entries need a work category.</p>}
          {!user.time_tracking_enabled && <p className="text-sm text-slate-600">Time tracking is disabled for this person. No recorded hours is not a missing-pay warning.</p>}
        </section>
        {tab === 'overview' && <div className={`${panel} flex flex-wrap gap-3`}><Link className={action} to={employeeWorkspaceHref(id, { tab: 'hours', returnTo, startDate, endDate })}>Review hours & payroll</Link><Link className={action} to={related('/admin/time')}>View time entries</Link><Link className={action} to={related('/admin/time', { view: 'reports' })}>Open hours report</Link></div>}
        {tab === 'hours' && <section className="space-y-3" aria-label="Work periods">
          <h2 className="text-lg font-semibold">Work periods <span className="text-sm font-normal text-slate-500">({evidence.pagination.total_count})</span></h2>
          {!evidence.periods.length && <p className={panel}>No recorded work or retained payroll evidence in this date range.</p>}
          {evidence.periods.map((period) => <article key={period.id} className={panel}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{period.start_date} – {period.end_date}</h3><p className="mt-1 text-xs text-slate-600">Original work dates · {period.review_required ? 'Needs reconciliation' : 'Review recorded evidence'}</p></div><button aria-expanded={selectedPeriod === period.id} className={action} onClick={() => update({ period: selectedPeriod === period.id ? null : period.id, entry: null, detail_cursor: null })}>{selectedPeriod === period.id ? 'Close details' : 'Review period'}</button></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Current REG / OT', `${h(period.summary.current_regular_hours)} / ${h(period.summary.current_overtime_hours)}`], ['Issued source coverage', h(period.summary.issued_hours)], ['Committed, unissued', h(period.summary.committed_hours)], ['Needs reconciliation', h(period.summary.needs_reconciliation_hours)]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>)}</dl>
            {selectedPeriod === period.id && <div className="mt-5 border-t border-slate-200 pt-4">
              {detailError ? <div role="alert"><p>{detailError}</p><button className={`${action} mt-2`} onClick={() => setRetry((value) => value + 1)}>Retry period</button></div> : !detail ? <p role="status">Loading exact evidence…</p> : <>
                {detail.detail_pagination && <p className="mb-3 text-xs text-slate-500">Detail page {Math.floor(detail.detail_pagination.offset / detail.detail_pagination.per_page) + 1} · {detail.detail_pagination.counts.entries} entries, {detail.detail_pagination.counts.coverage_lines} coverage lines. Period totals include every page.</p>}
                <h4 className="font-semibold">Daily entries</h4>
                {!detail.entries?.length && <p className="mt-2 text-sm text-slate-600">Current entries are absent; retained payroll evidence remains below.</p>}
                <div className="mt-3 space-y-3">{detail.entries?.map((entry) => <div key={entry.id} className={`rounded-xl border p-3 ${selectedEntry === entry.id ? 'border-cyan-600 bg-cyan-50' : 'border-slate-200'}`}>
                  <button className="text-left font-semibold text-cyan-800 hover:underline" onClick={() => update({ entry: entry.id })}>{entry.work_date} · {entry.start_time || '—'} – {entry.end_time || '—'} · {h(entry.worked_hours)}</button>
                  <p className="mt-1 text-sm text-slate-600">{entry.category || 'Uncategorized'} · {entry.approval_status || (entry.status === 'completed' ? 'Standard clock entry' : entry.status)} · REG {h(entry.regular_hours)} / OT {h(entry.overtime_hours)}</p>
                  <p className="mt-1 text-xs text-slate-600">Issued coverage {h(entry.issued_hours)} · committed {h(entry.committed_hours)} · needs reconciliation {h(entry.needs_reconciliation_hours)}</p>
                  {selectedEntry === entry.id && <div className="mt-3 space-y-2"><p className="break-words text-sm">{entry.description || 'No description recorded.'}</p>{entry.payment_attestation && <p className="text-sm">Evidence hold: {entry.payment_attestation}</p>}<Link className={action} to={related('/admin/time', { entry_id: entry.id })}>Open time entry</Link></div>}
                </div>)}</div>
                <h4 className="mt-5 font-semibold">Saved source coverage</h4>
                <p className="mt-1 text-xs leading-5 text-slate-600">Signed correction lines are retained. Source REG/OT describes covered time; actual paycheck components and money are available in payroll.</p>
                {!detail.coverage_lines?.length && <p className="mt-3 text-sm text-slate-600">No linked payroll coverage. Reconcile payment evidence before deciding whether payment is owed.</p>}
                <div className="mt-3 space-y-3">{detail.coverage_lines?.filter((line) => !selectedEntry || line.source_time_entry_id === selectedEntry).map((line) => <div key={line.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-semibold">{line.source_kind} · {line.coverage_state} · REG {line.regular_hours === null ? 'Unknown' : h(line.regular_hours)} / OT {line.overtime_hours === null ? 'Unknown' : h(line.overtime_hours)}</p><p className="mt-1 break-words text-slate-600">Work {line.work_date} · payroll period {line.external_pay_period_id || 'Not linked'} · item {line.external_payroll_item_id || 'Not linked'} · check {line.payment_reference || 'Not recorded'}</p>{line.identity_state && line.identity_state !== 'verified' && <p className="mt-2 text-amber-800">Employee identity needs reconciliation ({line.identity_state.replaceAll('_', ' ')}).</p>}{line.reason && <p className="mt-2 break-words">{line.reason}</p>}{line.batch_id && <Link className="mt-2 inline-block font-semibold text-cyan-800 hover:underline" to={related('/admin/payroll', { batch_id: line.batch_id, entry_id: line.source_time_entry_id })}>Open frozen batch</Link>}</div>)}</div>
                {!!detail.settlement_cases?.length && <div className="mt-5"><h4 className="font-semibold">Reconciliation notes</h4>{detail.settlement_cases.map((item) => <p key={item.public_id} className="mt-2 break-words text-sm text-slate-600">{item.origin_reason.replaceAll('_', ' ')} · {item.status} · destination {item.target_external_pay_period_id || item.destination_kind} · due {item.action_due_on}</p>)}</div>}
                {detail.detail_pagination && <div className="mt-4 flex gap-3">{detailCursor && <button className={action} onClick={() => update({ detail_cursor: null, entry: null })}>First detail page</button>}{detail.detail_pagination.next_cursor && <button className={action} onClick={() => update({ detail_cursor: detail.detail_pagination?.next_cursor || null, entry: null })}>Next detail page</button>}</div>}
              </>}
            </div>}
          </article>)}
          <div className="flex gap-3">{cursor && <button className={action} onClick={() => update({ cursor: null, period: null, entry: null, detail_cursor: null })}>First page</button>}{evidence.pagination.next_cursor && <button className={action} onClick={() => update({ cursor: evidence.pagination.next_cursor, period: null, entry: null, detail_cursor: null })}>Older periods</button>}</div>
        </section>}
      </>}
      {tab === 'schedule' && <EmployeeRelatedRecords employeeId={id} kind="schedule" returnTo={currentPath} />}
      {tab === 'activity' && <EmployeeRelatedRecords employeeId={id} kind="activity" returnTo={currentPath} />}
      {tab === 'setup' && <section className={`${panel} space-y-4`}><h2 className="text-lg font-semibold">Access & profile</h2><dl className="grid gap-4 sm:grid-cols-2">{[['Email', user.email || 'No email (kiosk only)'], ['Personal sign-in', user.personal_access_enabled ? 'Enabled' : 'Disabled'], ['Time tracking', user.time_tracking_enabled ? 'Enabled' : 'Disabled'], ['Department', user.approval_group_labels?.join(', ') || user.approval_group_label || 'Unassigned'], ['Public website', user.public_team_enabled ? 'Visible' : 'Hidden']].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold">{value}</dd></div>)}</dl><Link className={action} to={`/admin/users?${new URLSearchParams({ edit_user_id: id, return_to: currentPath })}`}>Manage access & profile</Link><p className="text-xs leading-5 text-slate-500">Intern status is a current profile setting. It does not establish historical compensation or payment.</p></section>}
    </>}
  </div>
}
