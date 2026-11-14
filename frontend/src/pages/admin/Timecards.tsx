import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Plus } from 'lucide-react'
import PayrollCutoffNotice from '../../components/time-tracking/PayrollCutoffNotice'
import { EveryoneWeek } from '../../components/timecards/EveryoneWeek'
import { LogMissedTimeSheet, type MissedTimePerson, type MissedTimePrefill } from '../../components/timecards/LogMissedTimeSheet'
import { PeoplePicker } from '../../components/timecards/PeoplePicker'
import { TimecardView, type TimecardPerson } from '../../components/timecards/TimecardView'
import { Button, EmptyState, ErrorState, Menu, OfflineBanner, PageHeader, SegmentedControl, useToast, type MenuItem } from '../../components/ui'
import { Skeleton } from '../../components/ui/Skeleton'
import type { TimeCategory, UserSummary, WorkerStatus } from '../../lib/api'
import { timecardsApi, type TimecardSummaryResponse } from '../../lib/api/timecards'
import { employeeWorkspaceHref, isWithinRoute, safeAdminReturn } from '../../lib/employeeWorkspace'
import { currentPayPeriod, formatPayPeriod, parsePayPeriodStart, payPeriodContaining, payPeriodIncludes, todayInGuam, type PayPeriod } from '../../lib/payPeriods'
import { isIsoDate } from '../../lib/payrollPeriods'
import { buildPeopleRows, formatHours, personName } from '../../lib/timecards'
import { useCapabilities } from '../../lib/useCapabilities'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'

type View = 'person' | 'everyone'

const DESKTOP = '(min-width: 1024px)'
const LOCK_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', weekday: 'short', month: 'short', day: 'numeric' })
// Links into this page that only mean something on arrival.
const ARRIVAL_PARAMS = ['entry_id', 'date', 'start_date', 'end_date']

const positiveId = (value: string | null) => (value && /^[1-9]\d*$/.test(value) ? Number(value) : null)

/**
 * Timecards: find one person and check or fix their pay period. On desktop
 * the people list sits beside the timecard, with "Everyone" for the week grid.
 * The URL holds the person, period and view, so Back and links land in place.
 * Old links (?entry_id=&date=&user_id=, ?view=period&start_date=) still work.
 */
export default function Timecards() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const capabilities = useCapabilities()
  const desktop = useMediaQuery(DESKTOP)
  const toast = useToast()
  const today = todayInGuam()

  const userId = positiveId(searchParams.get('user_id'))
  const entryId = positiveId(searchParams.get('entry_id'))
  const date = searchParams.get('date')
  const arrivalDate = isIsoDate(date) ? date : isIsoDate(searchParams.get('start_date')) ? searchParams.get('start_date')! : null
  const periodParam = searchParams.get('period')
  const period: PayPeriod = useMemo(
    () => parsePayPeriodStart(periodParam) ?? (arrivalDate ? payPeriodContaining(arrivalDate) : currentPayPeriod()),
    [arrivalDate, periodParam],
  )
  const rawView = searchParams.get('view')
  // ?view=week without a person is the old team week; it opens Everyone.
  const view: View = rawView === 'everyone' || (rawView === 'week' && !userId && !entryId) ? 'everyone' : 'person'
  const showEveryone = desktop && view === 'everyone'
  const weekDate = isIsoDate(date) ? date : payPeriodIncludes(period, today) ? today : period.start
  const returnTo = searchParams.has('return_to') ? safeAdminReturn(searchParams.get('return_to')) : null

  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const [users, setUsers] = useState<{ list: UserSummary[] | null; error: string | null }>({ list: null, error: null })
  const [usersRetry, setUsersRetry] = useState(0)
  const [summary, setSummary] = useState<{ periodStart: string; report: TimecardSummaryResponse | null; error: string | null }>({ periodStart: '', report: null, error: null })
  const [summaryRetry, setSummaryRetry] = useState(0)
  // Background refreshes of the people list (tab return, every 60s).
  const [pollTick, setPollTick] = useState(0)
  const [workers, setWorkers] = useState<WorkerStatus[]>([])
  const [categories, setCategories] = useState<TimeCategory[] | null>(null)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [categoriesRetry, setCategoriesRetry] = useState(0)
  const [locks, setLocks] = useState<Array<{ start: string; at: string }>>([])
  const [link, setLink] = useState<{ entryId: number; error: string | null } | null>(null)
  const linkError = entryId && link?.entryId === entryId ? link.error : null
  const [prefillFailure, setPrefillFailure] = useState<string | null>(null)
  const [logPrefill, setLogPrefill] = useState<MissedTimePrefill | null>(null)

  useEffect(() => { document.title = 'Timecards | AIRE Ops' }, [])

  useEffect(() => {
    let cancelled = false
    void timecardsApi.users().then((response) => {
      if (!cancelled) setUsers(response.data ? { list: response.data.users, error: null } : { list: null, error: response.error ?? "Couldn't load people." })
    })
    return () => { cancelled = true }
  }, [usersRetry])

  // Fixing a clock-out and logging missed time both need the work categories.
  useEffect(() => {
    let cancelled = false
    void timecardsApi.categories().then((response) => {
      if (cancelled) return
      if (response.data) { setCategories(response.data.time_categories); setCategoriesError(null) } else setCategoriesError(response.error ?? 'Unknown error')
    })
    return () => { cancelled = true }
  }, [categoriesRetry])

  useEffect(() => {
    let cancelled = false
    void timecardsApi.cutoff().then((response) => {
      const cutoff = response.data?.cutoff
      const next = response.data?.next_lock
      if (cancelled) return
      // The headline lock can be one that already happened; the next one belongs to the period being worked in.
      setLocks([
        ...(cutoff?.period && cutoff.cutoff_at ? [{ start: cutoff.period.start_date, at: cutoff.cutoff_at }] : []),
        ...(next ? [{ start: next.period.start_date, at: next.cutoff_at }] : []),
      ])
    })
    return () => { cancelled = true }
  }, [])

  const { start: periodStart, end: periodEnd } = period
  const summaryKey = `${periodStart}:${revision}:${summaryRetry}:${pollTick}`
  useEffect(() => {
    let cancelled = false
    const range = { start: periodStart, end: periodEnd }
    void Promise.all([timecardsApi.peopleSummary(range), timecardsApi.whosWorking()]).then(([report, working]) => {
      if (cancelled) return
      // Without the report the list still works, but it can't say who needs a look.
      setSummary({ periodStart, report: report.data ?? null, error: report.data ? null : report.error ?? 'Unknown error' })
      if (working.data) setWorkers(working.data.workers)
    })
    return () => { cancelled = true }
  }, [periodEnd, periodStart, summaryKey])

  // Keep the list current: on returning to the tab and every 60 seconds, but
  // not while the Log missed time sheet is open.
  const holdRefresh = useRef(false)
  useEffect(() => { holdRefresh.current = logPrefill !== null }, [logPrefill])
  useEffect(() => startVisibilityAwarePolling(() => { if (!holdRefresh.current) setPollTick(value => value + 1) }, 60_000), [])

  // A link to one shift (Who's Working, Today, the person page) opens that
  // person's timecard on the shift's pay period.
  useEffect(() => {
    if (!entryId) return
    let cancelled = false
    void timecardsApi.entry(entryId).then((response) => {
      if (cancelled) return
      const entry = response.data?.time_entry
      if (!entry) { setLink({ entryId, error: response.error ?? "Couldn't open the linked shift." }); return }
      const owner = String(entry.user.id)
      const linkedPeriod = payPeriodContaining(entry.work_date).start
      setSearchParams((current) => {
        if (current.get('user_id') && current.get('user_id') !== owner) return current
        const next = new URLSearchParams(current)
        next.set('user_id', owner)
        if (!parsePayPeriodStart(current.get('period'))) next.set('period', linkedPeriod)
        return next.toString() === current.toString() ? current : next
      }, { replace: true })
      setLink({ entryId, error: userId && String(userId) !== owner ? "The linked shift isn't on this person's timecard." : null })
    })
    return () => { cancelled = true }
  }, [entryId, setSearchParams, userId])

  const update = useCallback((change: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams)
    change(next)
    setSearchParams(next, { replace })
  }, [searchParams, setSearchParams])

  const choosePerson = (id: number, at: PayPeriod = period) => update((next) => {
    ARRIVAL_PARAMS.forEach(key => next.delete(key))
    next.delete('view')
    next.set('user_id', String(id))
    next.set('period', at.start)
  })
  const changePeriod = (next: PayPeriod) => update((params) => {
    ARRIVAL_PARAMS.forEach(key => params.delete(key))
    params.set('period', next.start)
  })
  const changeView = (next: View) => update((params) => {
    params.delete('entry_id')
    if (next === 'everyone') params.set('view', 'everyone')
    else params.delete('view')
  })

  // A refresh of the same period keeps the list on screen while it loads.
  const people = useMemo(() => {
    if (!users.list || summary.periodStart !== periodStart) return null
    return buildPeopleRows(users.list, summary.report?.employees ?? null, workers, today)
  }, [periodStart, summary, today, users.list, workers])
  const summaryError = summary.periodStart === periodStart ? summary.error : null

  const selectedUser = userId ? users.list?.find(user => user.id === userId) ?? null : null
  const selectedRow = people?.find(row => row.id === userId)
  const person: TimecardPerson | null = selectedUser && {
    id: selectedUser.id,
    name: personName(selectedUser),
    firstName: selectedUser.first_name || personName(selectedUser).split(/\s+/)[0],
    meta: (selectedRow?.groups ?? selectedUser.approval_group_labels ?? []).join(', ') || undefined,
    employmentStatus: selectedUser.employment_status,
    terminationEffectiveOn: selectedUser.termination_effective_on,
  }

  const missedTimePeople: MissedTimePerson[] = useMemo(() => (users.list ?? [])
    .filter(user => user.employment_status !== 'terminated' && user.employment_status !== 'inactive')
    .map((user) => {
      const name = personName(user)
      return { id: user.id, name, firstName: user.first_name || name.split(/\s+/)[0], meta: user.approval_group_labels?.join(', '), timeCategoryIds: user.time_category_ids ?? [] }
    }), [users.list])

  // "Log time for this shift" from a schedule opens the sheet filled in.
  const prefillScheduleId = searchParams.get('prefill') === 'true' ? searchParams.get('schedule_id') ?? '' : null
  useEffect(() => {
    if (prefillScheduleId === null || !users.list) return
    let cancelled = false
    const finish = () => setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const key of ['prefill', 'schedule_id', 'start_time', 'end_time', 'notes']) next.delete(key)
      return next
    }, { replace: true })
    const scheduleId = positiveId(prefillScheduleId)
    if (!scheduleId || !userId) return
    void timecardsApi.schedule(scheduleId).then((response) => {
      if (cancelled) return
      const shift = response.data?.schedule
      if (!shift || shift.user_id !== userId) {
        setPrefillFailure(response.error ?? 'The scheduled shift has changed. Open it from the schedule again.')
      } else {
        setPrefillFailure(null)
        setLogPrefill({ personId: shift.user_id, workDate: shift.work_date, startTime: shift.start_time, endTime: shift.end_time, note: [`Scheduled shift: ${shift.formatted_time_range}`, shift.notes].filter(Boolean).join(' — ') })
      }
      finish()
    })
    return () => { cancelled = true }
  }, [prefillScheduleId, setSearchParams, userId, users.list])

  const prefillError = prefillScheduleId !== null && (!positiveId(prefillScheduleId) || !userId)
    ? 'This shift link is incomplete. Open Log time from the schedule again.'
    : prefillFailure
  const prefillLoading = prefillScheduleId !== null && !prefillError

  // Fixing a clock-out and logging missed time both need the work categories.
  const categoriesBlocked = categoriesError
    ? "Work categories didn't load. Try again at the top of the page."
    : categories === null ? 'Loading work categories…' : null
  // A scheduled shift fills the sheet when it loads; opening it before then would lose that.
  const logBlocked = categoriesBlocked ?? (prefillLoading ? 'Loading the scheduled shift…' : null)

  const openLog = (prefill: MissedTimePrefill = {}) => setLogPrefill({ personId: showEveryone ? null : person?.id ?? null, ...prefill })
  const workCategories = categories ?? []
  const onLogged = (who: MissedTimePerson, hours: number) => {
    setLogPrefill(null)
    toast.show({ message: `Added ${formatHours(hours)} for ${who.firstName}. It's waiting in Approvals.` })
    refresh()
  }

  // Everyone shows a week, so the header names the pay period that week falls in.
  const headerPeriod = showEveryone ? payPeriodContaining(weekDate) : period
  const lock = locks.find((item) => item.start === period.start)?.at ?? null
  const headerLock = locks.find((item) => item.start === headerPeriod.start)?.at ?? null
  const description = `${formatPayPeriod(headerPeriod)}${headerLock ? ` · locks ${LOCK_FORMAT.format(new Date(headerLock))}` : ''}`

  const menuItems: MenuItem[] = person ? [
    ...(capabilities.manage_users ? [{ id: 'person', label: 'Open person page', onSelect: () => navigate(employeeWorkspaceHref(person.id, { tab: 'hours', period: period.start, returnTo: `${location.pathname}${location.search}` })) }] : []),
    ...(capabilities.send_pay_statements ? [{ id: 'stub', label: 'Send pay stub', onSelect: () => navigate(`/admin/pay-stubs?${new URLSearchParams({ send: String(person.id) })}`) }] : []),
  ] : []

  const backToList = new URLSearchParams(searchParams)
  for (const key of ['user_id', 'view', ...ARRIVAL_PARAMS]) backToList.delete(key)
  const backSearch = backToList.toString()

  const backLink = desktop ? undefined : (
    <Link to={{ search: backSearch ? `?${backSearch}` : '' }} className="-ml-1 inline-flex min-h-11 items-center gap-1 text-body-sm font-semibold text-primary">
      <ChevronLeft aria-hidden="true" className="size-4" />Timecards
    </Link>
  )

  const timecard = person && (
    <TimecardView
      key={person.id}
      person={person}
      period={period}
      onPeriodChange={changePeriod}
      categories={workCategories}
      blockedReason={categoriesBlocked}
      logMissedTimeBlockedReason={logBlocked}
      pauseRefresh={logPrefill !== null}
      focusEntryId={linkError ? null : entryId}
      lockAt={lock}
      refreshKey={revision}
      onChanged={refresh}
      onLogMissedTime={desktop ? undefined : () => openLog()}
      actions={menuItems.length > 0 ? <Menu label={`More for ${person.name}`} items={menuItems} /> : undefined}
      backLink={backLink}
    />
  )

  const missingPerson = userId && users.list && !selectedUser
  // The back link stays in every state, so a phone can always reach the list.
  const personPane = users.error && userId ? (
    <div className="space-y-4">{backLink}<ErrorState title="Couldn't load this person." description={users.error} onRetry={() => setUsersRetry(value => value + 1)} /></div>
  ) : missingPerson ? (
    <div className="space-y-4">{backLink}<EmptyState title="We couldn't find that person." description="They may have been removed. Pick someone from the list." /></div>
  ) : timecard ?? (
    <div aria-busy="true" aria-label="Loading the timecard" className="space-y-2 rounded-card border border-line bg-surface p-4">
      {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} height={40} className="w-full" />)}
    </div>
  )

  return (
    <div className="space-y-5">
      <PayrollCutoffNotice />
      <OfflineBanner />
      {returnTo && (
        <Link to={returnTo} className="inline-flex min-h-11 items-center text-body-sm font-semibold text-primary">
          {isWithinRoute(returnTo, '/admin/pay') ? 'Back to paycheck' : 'Back to employee review'}
        </Link>
      )}
      <PageHeader
        title="Timecards"
        description={description}
        className={!desktop && userId ? 'sr-only' : undefined}
        actions={desktop ? (
          <>
            <SegmentedControl label="Show" options={[{ value: 'person', label: 'One person' }, { value: 'everyone', label: 'Everyone' }]} value={view} onChange={changeView} />
            <Button icon={<Plus className="size-4" />} onClick={() => openLog()} disabled={!users.list || !!logBlocked} title={logBlocked ?? undefined}>Log missed time</Button>
          </>
        ) : undefined}
      />

      {linkError && <ErrorState title={linkError} description="Pick the person from the list to see their timecard." />}
      {prefillError && <ErrorState title={prefillError} />}
      {categoriesError && (
        <ErrorState
          title="Couldn't load work categories."
          description="Fixing a clock-out and logging missed time need them. Nothing else is affected."
          onRetry={() => setCategoriesRetry(value => value + 1)}
        />
      )}

      {showEveryone ? (
        <EveryoneWeek
          date={weekDate}
          onDateChange={(next) => update(params => { params.delete('entry_id'); params.set('date', next) })}
          categories={workCategories}
          refreshKey={revision}
          onChanged={refresh}
          onOpenPerson={(id, day) => choosePerson(id, payPeriodContaining(day))}
          onAddEntry={(day) => openLog({ personId: null, workDate: day })}
          addDisabled={!users.list || !!logBlocked}
          blockedReason={categoriesBlocked}
        />
      ) : desktop ? (
        <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-6">
          <PeoplePicker
            people={people}
            selectedId={userId}
            onSelect={(row) => choosePerson(row.id)}
            filter={searchParams.get('filter')}
            onFilterChange={(filter) => update(params => params.set('filter', filter), true)}
            error={users.error}
            onRetry={() => setUsersRetry(value => value + 1)}
            summaryError={summaryError}
            onRetrySummary={() => setSummaryRetry(value => value + 1)}
          />
          {userId ? personPane : <EmptyState title="Pick a person to see their pay period." description="People who need a look are listed first." />}
        </div>
      ) : userId ? personPane : (
        <PeoplePicker
          people={people}
          selectedId={null}
          onSelect={(row) => choosePerson(row.id)}
          filter={searchParams.get('filter')}
          onFilterChange={(filter) => update(params => params.set('filter', filter), true)}
          error={users.error}
          onRetry={() => setUsersRetry(value => value + 1)}
          summaryError={summaryError}
          onRetrySummary={() => setSummaryRetry(value => value + 1)}
        />
      )}

      <LogMissedTimeSheet
        open={logPrefill !== null}
        onClose={() => setLogPrefill(null)}
        people={missedTimePeople}
        categories={workCategories}
        prefill={logPrefill ?? {}}
        today={today}
        onSaved={onLogged}
        onUncertain={refresh}
        blockedReason={categoriesBlocked}
      />
    </div>
  )
}
