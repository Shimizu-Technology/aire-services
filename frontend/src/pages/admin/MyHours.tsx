import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import type { TimeCategory, TimeEntry, UserSummary } from '../../lib/api'
import { myTimeApi } from '../../lib/api/myTime'
import { addDateDays } from '../../lib/dateUtils'
import {
  currentPayPeriod,
  payPeriodContaining,
  todayInGuam,
} from '../../lib/payPeriods'
import {
  employeeDate,
  employeeShiftStatus,
} from '../../lib/employeePresentation'
import { timecardDays } from '../../lib/timecards'
import { isIsoDate } from '../../lib/payrollPeriods'
import { weeksAround, withOvertimeHours } from '../../lib/myTime'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import { HoursSummary } from '../../components/myhours/HoursSummary'
import { ShiftSheet } from '../../components/myhours/ShiftSheet'
import { ShiftForm } from '../../components/myhours/ShiftForm'
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  PeriodStepper,
  StatusPill,
} from '../../components/ui'

export default function MyHours() {
  const { currentUser } = useAuthContext()
  const [params, setParams] = useSearchParams()
  const date =
    params.get('period') ?? params.get('date') ?? params.get('start_date')
  const period = isIsoDate(date)
    ? payPeriodContaining(date)
    : currentPayPeriod()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [categories, setCategories] = useState<TimeCategory[]>([])
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [people, setPeople] = useState<UserSummary[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<TimeEntry | null>(null)
  const [form, setForm] = useState<TimeEntry | 'new' | null>(null)
  const [week, setWeek] = useState<TimeEntry[]>([])
  const [weekError, setWeekError] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const viewerId = currentUser?.id
  const key = `${viewerId}:${period.start}`
  const latestLoad = useRef(0)
  const currentLoad = useRef<(() => Promise<void>) | null>(null)
  const invalidateLoad = useCallback(() => {
    ++latestLoad.current
  }, [])
  const load = useCallback(async () => {
    if (!viewerId) return
    const request = ++latestLoad.current
    const result = await myTimeApi.entries(
      viewerId,
      weeksAround({
        start: period.start,
        end: period.end,
      }),
    )
    if (request !== latestLoad.current) return
    if (result.data) {
      setEntries(withOvertimeHours(result.data))
      setError(null)
    } else setError(result.error || "Couldn't load your hours.")
    setLoadedKey(key)
  }, [viewerId, period.start, period.end, key])
  useEffect(() => {
    currentLoad.current = load
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      invalidateLoad()
    }
  }, [load, invalidateLoad])
  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true)
    const result = await myTimeApi.categories()
    if (result.data) {
      setCategories(result.data.time_categories)
      setCategoriesError(null)
    } else setCategoriesError(result.error || "Couldn't load your work types.")
    setCategoriesLoading(false)
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCategories()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadCategories])
  useEffect(() => {
    void myTimeApi.people().then((result) => {
      if (result.data) setPeople(result.data.users)
    })
  }, [])
  useEffect(
    () =>
      startVisibilityAwarePolling(() => {
        if (!detail && !form) return load()
      }, 60_000),
    [load, detail, form],
  )
  useEffect(() => {
    if (!detail || !viewerId) return
    let cancelled = false
    const weekday = new Date(`${detail.work_date}T12:00:00Z`).getUTCDay()
    const start = addDateDays(detail.work_date, -weekday)
    void myTimeApi
      .entries(viewerId, weeksAround({ start, end: addDateDays(start, 6) }))
      .then((result) => {
        if (cancelled) return
        setWeekError(!result.data)
        setWeek(result.data ? withOvertimeHours(result.data) : [])
      })
    return () => {
      cancelled = true
    }
  }, [detail, viewerId])
  const days = timecardDays(entries, period)
  const visibleEntries = [...days.values()].flat().map((item) => item.entry)
  const groups =
    people.find((person) => person.id === viewerId)?.approval_group_keys ?? []
  const approverNames = people
    .filter(
      (person) =>
        person.role === 'manager' &&
        person.is_active &&
        person.id !== viewerId &&
        person.approval_group_keys?.some((group) => groups.includes(group)),
    )
    .map((person) => person.first_name || person.full_name)

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="My Hours" />
      <PeriodStepper
        period={period}
        max={todayInGuam()}
        onChange={(next) => {
          const query = new URLSearchParams(params)
          query.set('period', next.start)
          setParams(query)
          setDetail(null)
          setForm(null)
        }}
      />
      {message && (
        <p role="status" className="text-body text-ink">
          {message}
        </p>
      )}
      {categoriesError && !form && (
        <ErrorState
          title="Couldn't load your work types."
          description={categoriesError}
          onRetry={loadCategories}
        />
      )}
      {loadedKey !== key ? (
        <p role="status">Loading your hours…</p>
      ) : error ? (
        <ErrorState
          title="Couldn't load your hours."
          description={error}
          onRetry={load}
        />
      ) : (
        <>
          <HoursSummary
            entries={visibleEntries}
            period={period}
            approverNames={approverNames}
          />
          {days.size === 0 ? (
            <EmptyState title="No time recorded this pay period." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {[...days]
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([day, items]) => (
                  <li key={day}>
                    <h2 className="bg-surface-muted px-4 py-2 text-body-sm font-semibold text-ink">
                      {employeeDate(day, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </h2>
                    {items.map(({ entry, hours, partial, continuesFrom }) => (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => {
                          setWeek([])
                          setWeekError(false)
                          setDetail(entry)
                        }}
                        className="block min-h-16 w-full space-y-2 px-4 py-4 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                      >
                        <div className="flex items-start justify-between gap-3 text-body font-medium text-ink">
                          <span>
                            {entry.formatted_start_time ??
                              entry.start_time ??
                              '—'}
                            –
                            {entry.status === 'completed'
                              ? (entry.formatted_end_time ??
                                entry.end_time ??
                                '—')
                              : 'Now'}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {hours.toFixed(1)}h
                          </span>
                        </div>
                        <p className="text-body-sm text-ink-muted">
                          {entry.time_category?.name ?? 'No work type'}
                          {partial ? ' · hours in this period' : ''}
                          {continuesFrom
                            ? ` · from ${employeeDate(continuesFrom, { month: 'short', day: 'numeric' })}`
                            : ''}
                        </p>
                        <StatusPill tone={employeeShiftStatus(entry).tone}>
                          {employeeShiftStatus(entry).label}
                        </StatusPill>
                        {entry.overtime_status === 'pending' && (
                          <p className="text-body-sm text-amber-900">
                            {(entry.pending_overtime_hours ?? 0).toFixed(1)}h
                            overtime waiting
                          </p>
                        )}
                      </button>
                    ))}
                  </li>
                ))}
            </ul>
          )}
          <Button variant="ghost" onClick={() => setForm('new')}>
            Add time I forgot to clock
          </Button>
        </>
      )}
      {detail && (
        <ShiftSheet
          entry={detail}
          weekEntries={week}
          weekUnavailable={weekError || !week.length}
          onClose={() => setDetail(null)}
          onFix={() => {
            setForm(detail)
            setDetail(null)
          }}
        />
      )}
      {form && (
        <ShiftForm
          entry={form === 'new' ? undefined : form}
          categories={categories}
          categoriesError={categoriesError}
          categoriesLoading={categoriesLoading}
          onRetryCategories={loadCategories}
          onClose={() => {
            setForm(null)
            void currentLoad.current?.()
          }}
          onSaved={() => {
            setForm(null)
            setMessage('Your time was saved and sent for approval.')
            void currentLoad.current?.()
          }}
        />
      )}
    </div>
  )
}
