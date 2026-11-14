import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import type { TimeCategory, TimeEntry } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { addDateDays, formatDateOnly } from '../../lib/dateUtils'
import { currentPayPeriod, payPeriodContaining, todayInGuam } from '../../lib/payPeriods'
import { timecardDays } from '../../lib/timecards'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import { HoursSummary } from '../../components/myhours/HoursSummary'
import { ShiftSheet } from '../../components/myhours/ShiftSheet'
import { ShiftForm } from '../../components/myhours/ShiftForm'
import { Button, EmptyState, ErrorState, PageHeader, PeriodStepper, StatusPill } from '../../components/ui'

export default function MyHours() {
  const { currentUser } = useAuthContext()
  const [params, setParams] = useSearchParams()
  const date = params.get('period')
  const period = date && /^\d{4}-\d{2}-(01|16)$/.test(date)
    ? payPeriodContaining(date) : currentPayPeriod()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<TimeEntry | null>(null)
  const [form, setForm] = useState<TimeEntry | 'new' | null>(null)
  const [week, setWeek] = useState<TimeEntry[]>([])
  const [weekError, setWeekError] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const viewerId = currentUser?.id
  const key = `${viewerId}:${period.start}`
  const load = useCallback(async () => {
    if (!viewerId) return
    const result = await myTimeApi.entries(viewerId, { start: period.start, end: period.end })
    if (result.data) { setEntries(result.data); setError(null) }
    else setError(result.error || "Couldn't load your hours.")
    setLoadedKey(key)
  }, [viewerId, period.start, period.end, key])
  useEffect(() => { void load() }, [load])
  useEffect(() => { void myTimeApi.categories().then(result => {
    if (result.data) setCategories(result.data.time_categories)
  }) }, [])
  useEffect(() => startVisibilityAwarePolling(() => {
    if (!detail && !form) return load()
  }, 60_000), [load, detail, form])
  useEffect(() => {
    if (!detail || !viewerId) return
    let cancelled = false
    const weekday = new Date(`${detail.work_date}T12:00:00Z`).getUTCDay()
    const start = addDateDays(detail.work_date, -weekday)
    void myTimeApi.entries(viewerId, { start, end: addDateDays(start, 6) }).then(result => {
      if (cancelled) return
      setWeekError(!result.data)
      setWeek(result.data?.filter(row => row.work_date >= start && row.work_date <= addDateDays(start, 6)) ?? [])
    })
    return () => { cancelled = true }
  }, [detail, viewerId])
  const days = timecardDays(entries, period)
  const visibleEntries = [...days.values()].flat().map(item => item.entry)

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="My Hours" />
      <PeriodStepper
        period={period}
        max={todayInGuam()}
        onChange={next => { const query = new URLSearchParams(params); query.set('period', next.start); setParams(query); setDetail(null); setForm(null) }}
      />
      {message && <p role="status" className="text-body text-ink">{message}</p>}
      {loadedKey !== key ? <p role="status">Loading your hours…</p>
        : error ? <ErrorState title="Couldn't load your hours." description={error} onRetry={load} />
          : (
            <>
              <HoursSummary entries={visibleEntries} period={period} />
              {days.size === 0 ? <EmptyState title="No time recorded this pay period." /> : (
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                  {[...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, items]) => (
                    <li key={day}>
                      <h2 className="bg-surface-muted px-4 py-2 text-body-sm font-semibold text-ink">
                        {formatDateOnly(day, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </h2>
                      {items.map(({ entry, hours, partial, continuesFrom }) => (
                        <button
                          type="button"
                          key={entry.id}
                          onClick={() => { setWeek([]); setWeekError(false); setDetail(entry) }}
                          className="block min-h-16 w-full space-y-2 px-4 py-4 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                        >
                          <div className="flex items-start justify-between gap-3 text-body font-medium text-ink">
                            <span>{entry.formatted_start_time ?? entry.start_time ?? '—'}–{entry.status === 'completed' ? entry.formatted_end_time ?? entry.end_time ?? '—' : 'Now'}</span>
                            <span className="shrink-0 tabular-nums">{hours.toFixed(1)}h</span>
                          </div>
                          <p className="text-body-sm text-ink-muted">{entry.time_category?.name ?? 'No work type'}{partial ? ' · hours in this period' : ''}{continuesFrom ? ` · from ${formatDateOnly(continuesFrom, { month: 'short', day: 'numeric' })}` : ''}</p>
                          <StatusPill tone={entry.approval_status === 'denied' ? 'needs-fix' : entry.approval_status === 'approved' ? 'approved' : 'waiting'}>
                            {entry.payroll_status?.label ?? (entry.status !== 'completed' ? 'Shift in progress' : entry.approval_status === 'approved' ? 'Approved — not paid yet' : entry.approval_status === 'denied' ? 'Declined' : 'Waiting for approval')}
                          </StatusPill>
                          {entry.overtime_status === 'pending' && <p className="text-body-sm text-amber-900">{(entry.pending_overtime_hours ?? 0).toFixed(1)}h overtime waiting</p>}
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="ghost" onClick={() => setForm('new')}>Add time I forgot to clock</Button>
            </>
          )}
      {detail && (
        <ShiftSheet
          entry={detail}
          weekEntries={week}
          weekUnavailable={weekError || !week.length}
          onClose={() => setDetail(null)}
          onFix={() => { setForm(detail); setDetail(null) }}
        />
      )}
      {form && (
        <ShiftForm
          entry={form === 'new' ? undefined : form}
          categories={categories}
          onClose={() => { setForm(null); void load() }}
          onSaved={() => { setForm(null); setMessage('Your time was saved and sent for approval.'); void load() }}
        />
      )}
    </div>
  )
}
