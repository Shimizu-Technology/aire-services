import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { employeeEvidenceApi } from '../../lib/employeeEvidenceApi'
import { formatDateInTimeZoneISO, formatDateTime } from '../../lib/dateUtils'
import type { AuditLogEntry, Schedule } from '../../lib/api'

export default function EmployeeRelatedRecords({ employeeId, kind, returnTo }: { employeeId: string; kind: 'schedule' | 'activity'; returnTo: string }) {
  const [query, setQuery] = useSearchParams()
  const [records, setRecords] = useState<Schedule[] | AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const today = formatDateInTimeZoneISO(new Date(), 'Pacific/Guam')
  const todayDate = new Date(`${today}T00:00:00Z`)
  todayDate.setUTCDate(todayDate.getUTCDate() - todayDate.getUTCDay())
  const week = query.get('schedule_week') || todayDate.toISOString().slice(0, 10)
  const page = Math.max(1, Number(query.get('activity_page')) || 1)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
    setLoading(true); setError(''); setRecords([])
    const load = kind === 'schedule'
      ? employeeEvidenceApi.schedule(employeeId, week, controller.signal).then((result) => { if (!controller.signal.aborted) setRecords(result.schedules) })
      : employeeEvidenceApi.activity(employeeId, page, controller.signal).then((result) => { if (!controller.signal.aborted) { setRecords(result.audit_logs); setTotalPages(result.pagination.total_pages) } })
    await load.catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load records') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }
    void refresh()
    return () => controller.abort()
  }, [employeeId, kind, week, page, retry])
  const change = (key: string, value: string) => { const next = new URLSearchParams(query); next.set(key, value); setQuery(next) }
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <h2 className="text-lg font-semibold">{kind === 'schedule' ? 'Employee schedule' : 'Employee activity'}</h2>
    {kind === 'schedule' && <label className="mt-3 block text-sm">Week starting<input aria-label="Employee schedule week" type="date" value={week} onChange={(event) => change('schedule_week', event.target.value)} className="ml-3 rounded-lg border border-slate-300 p-2" /></label>}
    {loading ? <p role="status" className="mt-4 text-sm">Loading records…</p> : error ? <div role="alert" className="mt-4"><p className="text-sm">{error}</p><button onClick={() => setRetry((value) => value + 1)} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold">Retry</button></div> : <>
      {!records.length && <p className="mt-4 text-sm text-slate-600">{kind === 'schedule' ? 'No shifts recorded for this week.' : 'No changes recorded for this employee profile.'}</p>}
      <div className="mt-4 space-y-3">{kind === 'schedule' ? (records as Schedule[]).map((record) => <article key={record.id} className="rounded-xl border border-slate-200 p-3"><h3 className="text-sm font-semibold">{record.work_date} · {record.formatted_time_range}</h3><p className="mt-1 break-words text-sm text-slate-600">{record.notes || 'No shift notes.'}</p><Link className="mt-2 inline-block text-sm font-semibold text-cyan-800 hover:underline" to={`/admin/time?${new URLSearchParams({ prefill: 'true', schedule_id: String(record.id), user_id: employeeId, return_to: returnTo })}`}>Log time for this shift</Link></article>) : (records as AuditLogEntry[]).map((record) => <article key={record.id} className="rounded-xl border border-slate-200 p-3"><h3 className="text-sm font-semibold">{record.summary}</h3><p className="mt-1 text-xs text-slate-500">{formatDateTime(record.occurred_at)} · {record.actor.name || 'System'} · {record.outcome}</p><Link className="mt-2 inline-block text-sm font-semibold text-cyan-800 hover:underline" to={`/admin/activity?${new URLSearchParams({ subject_type: 'User', subject_id: employeeId, event_id: String(record.id), return_to: returnTo })}`}>View event evidence</Link></article>)}</div>
      {kind === 'activity' && totalPages > 1 && <div className="mt-4 flex items-center gap-3"><button disabled={page <= 1} onClick={() => change('activity_page', String(page - 1))} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Newer</button><span className="text-xs">Page {page} of {totalPages}</span><button disabled={page >= totalPages} onClick={() => change('activity_page', String(page + 1))} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Older</button></div>}
    </>}
  </section>
}
