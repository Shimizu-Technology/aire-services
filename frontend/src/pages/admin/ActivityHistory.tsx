import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type AuditLogEntry, type AuditLogFilters } from '../../lib/api'
import { formatDateInTimeZoneISO } from '../../lib/dateUtils'

const CATEGORY_LABELS: Record<string, string> = {
  activity: 'General activity',
  users: 'Users & access',
  security: 'Security',
  time_tracking: 'Time tracking',
  approvals: 'Approvals',
  scheduling: 'Scheduling',
  leave: 'Leave',
  payroll: 'Payroll',
  reports: 'Reports & exports',
  settings: 'Settings',
  content: 'Site content',
  integration: 'Integrations',
}

function formatLabel(value: string) {
  return CATEGORY_LABELS[value] || value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Pacific/Guam',
  }).format(new Date(value))
}

function valueText(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function subjectScope(searchParams: URLSearchParams) {
  const subjectType = searchParams.get('subject_type')?.trim()
  const subjectId = Number.parseInt(searchParams.get('subject_id') || '', 10)
  if (!subjectType || !Number.isFinite(subjectId) || subjectId <= 0) return {}

  return {
    subject_type: subjectType,
    subject_id: subjectId,
  }
}

function boundedExportFilters(filters: AuditLogFilters): AuditLogFilters {
  const to = filters.to || formatDateInTimeZoneISO(new Date(), 'Pacific/Guam')
  const fromDate = new Date(`${to}T00:00:00Z`)
  fromDate.setUTCDate(fromDate.getUTCDate() - 90)
  return { ...filters, from: filters.from || fromDate.toISOString().slice(0, 10), to }
}

function EventDetail({ event, onClose }: { event: AuditLogEntry; onClose: () => void }) {
  const detailRows = Object.entries(event.details).filter(([, value]) => value !== null && value !== undefined && value !== '')
  const changeRows = Object.entries(event.changes)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
    const dismissOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [onClose])

  return (
    <>
      <button type="button" onClick={onClose} className="fixed inset-0 z-40 bg-slate-950/35 xl:hidden" aria-label="Close event details" />
      <aside ref={panelRef} tabIndex={-1} role="dialog" aria-label="Activity event details" className="fixed inset-x-3 bottom-3 top-20 z-50 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl outline-none xl:sticky xl:inset-auto xl:top-6 xl:z-auto xl:max-h-[calc(100vh-7rem)] xl:shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Event details</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{event.summary}</h2>
          <p className="mt-1 text-sm text-slate-500">{formatTimestamp(event.occurred_at)}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close event details">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="space-y-6 px-5 py-5 text-sm">
        <section>
          <h3 className="font-semibold text-slate-900">Actor and source</h3>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-slate-600">
            <dt className="text-slate-400">Actor</dt><dd>{event.actor.name || event.actor.email || formatLabel(event.actor.kind)}</dd>
            {event.actor.email && <><dt className="text-slate-400">Email</dt><dd className="break-all">{event.actor.email}</dd></>}
            <dt className="text-slate-400">Source</dt><dd>{formatLabel(event.source)}</dd>
            <dt className="text-slate-400">Outcome</dt><dd>{formatLabel(event.outcome)}</dd>
          </dl>
        </section>

        <section>
          <h3 className="font-semibold text-slate-900">Subject</h3>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-slate-600">
            <dt className="text-slate-400">Record</dt><dd>{event.subject.name || `${formatLabel(event.subject.type)} #${event.subject.id}`}</dd>
            <dt className="text-slate-400">Type</dt><dd>{formatLabel(event.subject.type)}</dd>
            <dt className="text-slate-400">Event</dt><dd className="font-mono text-xs">{event.action}</dd>
          </dl>
        </section>

        {changeRows.length > 0 && (
          <section>
            <h3 className="font-semibold text-slate-900">Recorded changes</h3>
            <div className="mt-3 space-y-2">
              {changeRows.map(([field, value]) => (
                <div key={field} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatLabel(field)}</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-slate-700">{valueText(value)}</pre>
                </div>
              ))}
            </div>
          </section>
        )}

        {detailRows.length > 0 && (
          <section>
            <h3 className="font-semibold text-slate-900">Context</h3>
            <dl className="mt-3 space-y-3">
              {detailRows.map(([field, value]) => (
                <div key={field}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{formatLabel(field)}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-slate-700">{valueText(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="border-t border-slate-100 pt-4">
          <h3 className="font-semibold text-slate-900">Trace</h3>
          <dl className="mt-3 space-y-2 text-xs text-slate-500">
            <div><dt className="inline text-slate-400">Event ID: </dt><dd className="inline">{event.id}</dd></div>
            {event.request.id && <div><dt className="inline text-slate-400">Request ID: </dt><dd className="inline break-all">{event.request.id}</dd></div>}
            {event.request.ip_address && <div><dt className="inline text-slate-400">IP address: </dt><dd className="inline">{event.request.ip_address}</dd></div>}
          </dl>
        </section>
      </div>
      </aside>
    </>
  )
}

export default function ActivityHistory() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [events, setEvents] = useState<AuditLogEntry[]>([])
  const [selected, setSelected] = useState<AuditLogEntry | null>(null)
  const [availableCategories, setAvailableCategories] = useState<string[]>(Object.keys(CATEGORY_LABELS))
  const [availableSources, setAvailableSources] = useState<string[]>([])
  const [filters, setFilters] = useState<AuditLogFilters>({ page: 1, per_page: 50 })
  const [searchInput, setSearchInput] = useState('')
  const [pagination, setPagination] = useState({ page: 1, total: 0, total_pages: 1 })
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const searchDebounceMounted = useRef(false)

  const routeScope = useMemo(() => subjectScope(searchParams), [searchParams])
  const routeSubjectType = routeScope.subject_type
  const routeSubjectId = routeScope.subject_id
  const effectiveFilters = useMemo(() => ({
    ...filters,
    ...routeScope,
  }), [filters, routeScope])

  useEffect(() => {
    if (!searchDebounceMounted.current) {
      searchDebounceMounted.current = true
      return
    }
    const timer = window.setTimeout(() => {
      const search = searchInput.trim() || undefined
      setFilters((current) => current.search === search ? current : { ...current, page: 1, search })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadEvents = useCallback(async () => {
    const sequence = ++requestSequence.current
    setLoading(true)
    setError(null)
    const response = await api.getAuditLogs(effectiveFilters)
    if (sequence !== requestSequence.current) return

    if (response.data) {
      setEvents(response.data.audit_logs)
      setPagination(response.data.pagination)
      setAvailableCategories(response.data.filters.event_categories)
      setAvailableSources(response.data.filters.sources)
      setSelected((current) => current && response.data!.audit_logs.find((event) => event.id === current.id) || null)
    } else {
      setError(response.error || 'Activity history could not be loaded.')
    }
    setLoading(false)
  }, [effectiveFilters])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadEvents() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadEvents])

  const activeFilterCount = useMemo(() => [filters.event_category, filters.source, filters.from, filters.to, filters.outcome, filters.search, routeSubjectType && routeSubjectId].filter(Boolean).length, [filters, routeSubjectId, routeSubjectType])

  const updateFilter = (key: keyof AuditLogFilters, value: string) => {
    setFilters((current) => ({ ...current, page: 1, [key]: value || undefined }))
  }

  const clearFilters = () => {
    setSearchInput('')
    setFilters({ page: 1, per_page: 50 })
    setSearchParams({}, { replace: true })
  }

  const clearSubjectScope = () => {
    setSearchParams({}, { replace: true })
  }

  const closeSelected = useCallback(() => setSelected(null), [])

  const exportEvents = async () => {
    setExporting(true)
    setError(null)
    const response = await api.downloadAuditLogs(boundedExportFilters(effectiveFilters))
    if (response.blob) {
      const url = URL.createObjectURL(response.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = response.filename || 'AIRE_Activity_History.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      void loadEvents()
    } else {
      setError(response.error || 'Activity history could not be exported.')
    }
    setExporting(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Accountability</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Activity History</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">A permanent record of access, time, approvals, schedules, settings, exports, and other important changes in AIRE.</p>
        </div>
        <button type="button" onClick={exportEvents} disabled={exporting || loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" /></svg>
          {exporting ? 'Preparing CSV…' : 'Export CSV'}
        </button>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {routeSubjectType && routeSubjectId && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary-dark">
            <span>Showing history for {formatLabel(routeSubjectType)} #{routeSubjectId}</span>
            <button type="button" onClick={clearSubjectScope} className="font-semibold text-primary hover:text-primary-dark">Show all</button>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="xl:col-span-2">
            <span className="sr-only">Search activity</span>
            <div className="relative">
              <svg className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="m20 20-3.5-3.5" /></svg>
              <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search people, records, or actions" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/10" />
            </div>
          </label>
          <select aria-label="Event category" value={filters.event_category || ''} onChange={(event) => updateFilter('event_category', event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10">
            <option value="">All activity</option>
            {availableCategories.map((category) => <option key={category} value={category}>{formatLabel(category)}</option>)}
          </select>
          <select aria-label="Event source" value={filters.source || ''} onChange={(event) => updateFilter('source', event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10">
            <option value="">All sources</option>
            {availableSources.map((source) => <option key={source} value={source}>{formatLabel(source)}</option>)}
          </select>
          <label className="relative"><span className="pointer-events-none absolute left-3 top-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">From</span><input aria-label="From date" type="date" value={filters.from || ''} onChange={(event) => updateFilter('from', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 pt-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>
          <label className="relative"><span className="pointer-events-none absolute left-3 top-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">To</span><input aria-label="To date" type="date" value={filters.to || ''} onChange={(event) => updateFilter('to', event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 pt-3 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>
        </div>
        {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="mt-3 text-sm font-semibold text-primary transition hover:text-primary-dark">Clear {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'}</button>}
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className={`grid gap-6 ${selected ? 'xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]' : ''}`}>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><h2 className="font-semibold text-slate-950">Recorded events</h2><p className="mt-0.5 text-xs text-slate-500">{pagination.total.toLocaleString()} total</p></div>
            {loading && <span className="text-xs font-medium text-primary">Refreshing…</span>}
          </div>

          {loading && events.length === 0 ? (
            <div className="space-y-3 p-5" aria-label="Loading activity history">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
          ) : events.length === 0 ? (
            <div className="px-6 py-16 text-center"><p className="font-semibold text-slate-800">No events match these filters</p><p className="mt-1 text-sm text-slate-500">Try clearing a filter or searching for a different record.</p></div>
          ) : (
            <div className="divide-y divide-slate-100">
              {events.map((event) => (
                <button key={event.id} type="button" onClick={() => setSelected(event)} className={`grid w-full gap-3 px-4 py-4 text-left transition hover:bg-slate-50 sm:grid-cols-[8rem_minmax(0,1fr)_8rem] sm:items-center sm:px-5 ${selected?.id === event.id ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : ''}`}>
                  <div><span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{formatLabel(event.event_category)}</span><p className="mt-1 text-xs text-slate-400 sm:hidden">{formatTimestamp(event.occurred_at)}</p></div>
                  <div className="min-w-0"><p className="text-sm font-semibold leading-5 text-slate-900">{event.summary}</p><p className="mt-1 truncate text-xs text-slate-500">{event.actor.email || event.subject.type} · {formatLabel(event.source)}</p></div>
                  <div className="hidden text-right sm:block"><p className="text-xs font-medium text-slate-600">{new Date(event.occurred_at).toLocaleDateString('en-US', { timeZone: 'Pacific/Guam', month: 'short', day: 'numeric' })}</p><p className="mt-1 text-xs text-slate-400">{new Date(event.occurred_at).toLocaleTimeString('en-US', { timeZone: 'Pacific/Guam', hour: 'numeric', minute: '2-digit' })}</p></div>
                </button>
              ))}
            </div>
          )}

          {pagination.total_pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
              <button type="button" disabled={pagination.page <= 1 || loading} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, pagination.page - 1) }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">Previous</button>
              <span className="text-xs font-medium text-slate-500">Page {pagination.page} of {pagination.total_pages}</span>
              <button type="button" disabled={pagination.page >= pagination.total_pages || loading} onClick={() => setFilters((current) => ({ ...current, page: pagination.page + 1 }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">Next</button>
            </div>
          )}
        </section>

        {selected && <EventDetail event={selected} onClose={closeSelected} />}
      </div>
    </div>
  )
}
