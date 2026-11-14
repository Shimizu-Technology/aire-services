import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import type { TimeEntry } from '../../lib/api'
import { timecardsApi, type TimecardSummaryEmployee } from '../../lib/api/timecards'
import { formatDateOnly } from '../../lib/dateUtils'
import { formatPayPeriod, payPeriodDays, todayInGuam, type PayPeriod } from '../../lib/payPeriods'
import { formatHours, isApprovedTime, isOpenClock, timecardDays } from '../../lib/timecards'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import EditTimeEntryModal from '../time-tracking/EditTimeEntryModal'
import { Avatar, Button, EmptyState, ErrorState, PeriodStepper } from '../ui'
import { Skeleton } from '../ui/Skeleton'
import { DayRow } from './DayRow'

export interface TimecardPerson {
  id: number
  name: string
  firstName: string
  /** One short line under the name: "Ops / Maintenance". */
  meta?: string
  employmentStatus?: 'active' | 'pending' | 'inactive' | 'terminated'
  terminationEffectiveOn?: string | null
}

export interface TimecardViewProps {
  person: TimecardPerson
  period: PayPeriod
  onPeriodChange: (period: PayPeriod) => void
  /** Active work categories; each shift offers the ones assigned to the person. */
  categories: Array<{ id: number; name: string }>
  /** A linked shift to highlight and scroll to. A forgotten clock opens its fix. */
  focusEntryId?: number | null
  /** When this period locks (ISO), for "Fix it before the lock on …". */
  lockAt?: string | null
  /** Change it to reload after a write elsewhere on the page. */
  refreshKey?: number
  /** After this view saves or deletes a shift. */
  onChanged?: () => void
  /** Shows "Log missed time for …" under the days. */
  onLogMissedTime?: () => void
  /** Why Log missed time can't open yet (e.g. a scheduled shift is loading). */
  logMissedTimeBlockedReason?: string | null
  /** Why no shift can be fixed or edited right now (e.g. work categories didn't load). */
  blockedReason?: string | null
  /** Hold the background refresh, e.g. while the page's Log missed time sheet is open. */
  pauseRefresh?: boolean
  /** Beside the name, e.g. a ⋯ Menu. */
  actions?: ReactNode
  /** Above the name, e.g. a back link. */
  backLink?: ReactNode
  /** Guam today; defaults to now. */
  today?: string
}

const shortDay = (date: string) => formatDateOnly(date, { weekday: 'short', month: 'short', day: 'numeric' })
const monthDay = (date: string) => formatDateOnly(date, { month: 'short', day: 'numeric' })
const LOCK_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Guam', weekday: 'short', month: 'short', day: 'numeric' })

function futureLine(days: string[]) {
  if (days.length === 1) return `${monthDay(days[0])} hasn't happened yet`
  const first = days[0]
  const last = days[days.length - 1]
  return `${monthDay(first)}–${first.slice(0, 7) === last.slice(0, 7) ? Number(last.slice(8)) : monthDay(last)} haven't happened yet`
}

/**
 * One person's pay period: what's approved and waiting, every day including
 * days off, and a forgotten clock fixed in place. Tapping a shift opens the
 * shift editor (a sheet on phones). Used by Timecards and the person page.
 */
export function TimecardView({
  person, period, onPeriodChange, categories, focusEntryId = null, lockAt, refreshKey = 0,
  onChanged, onLogMissedTime, logMissedTimeBlockedReason = null, blockedReason = null, pauseRefresh = false, actions, backLink, today: todayProp,
}: TimecardViewProps) {
  const today = todayProp ?? todayInGuam()
  const readOnly = person.employmentStatus === 'terminated'
  const [state, setState] = useState<{ key: string; revision: number; entries: TimeEntry[] | null; summary: TimecardSummaryEmployee | null; summaryFailed: boolean; error: string | null }>({ key: '', revision: 0, entries: null, summary: null, summaryFailed: false, error: null })
  const [revision, setRevision] = useState(0)
  // Background refreshes (tab return, every 60s) count up here.
  const [tick, setTick] = useState(0)
  // Set by a write or a reload: shifts can't be fixed or edited again until this revision arrives.
  const [awaitRevision, setAwaitRevision] = useState(0)
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  // The fix the viewer opened or closed for this link; until then a linked forgotten clock shows its fix.
  const [fixChoice, setFixChoice] = useState<{ focus: number | null; id: number | null } | null>(null)
  const scrolledTo = useRef<number | null>(null)
  const { start: periodStart, end: periodEnd } = period
  const requestKey = `${person.id}:${periodStart}:${refreshKey}:${revision}:${tick}`
  // A refresh of the same person and period keeps the days on screen, so the
  // row the viewer was on (and its focus) stays put while the new data loads.
  const loaded = state.key === requestKey || (state.entries !== null && state.key.startsWith(`${person.id}:${periodStart}:`))

  useEffect(() => {
    let cancelled = false
    const range = { start: periodStart, end: periodEnd }
    void Promise.all([timecardsApi.personEntries(person.id, range), timecardsApi.personSummary(person.id, range)]).then(([entries, summary]) => {
      if (cancelled) return
      setState({
        key: requestKey,
        revision,
        entries: entries.data ?? null,
        // The report is optional here: without it the totals come from the shifts.
        summary: summary.data?.employees.find(row => row.id === person.id) ?? null,
        summaryFailed: !summary.data,
        error: entries.data ? null : entries.error ?? "Couldn't load the shifts.",
      })
    })
    return () => { cancelled = true }
  }, [person.id, periodStart, periodEnd, requestKey, revision])

  const reload = useCallback(() => {
    const next = revision + 1
    setRevision(next)
    setAwaitRevision(next)
  }, [revision])
  const afterWrite = useCallback(() => { reload(); onChanged?.() }, [onChanged, reload])
  const loading = state.revision < awaitRevision

  // Refresh on returning to the tab and every 60 seconds, but never under an
  // open fix, shift editor or Log missed time sheet.
  const holdRefresh = useRef(false)
  useEffect(() => startVisibilityAwarePolling(() => { if (!holdRefresh.current) setTick(value => value + 1) }, 60_000), [])

  const allEntries = useMemo(() => (loaded ? state.entries : null) ?? [], [loaded, state.entries])
  const byDay = useMemo(() => timecardDays(allEntries, { start: periodStart, end: periodEnd }), [allEntries, periodStart, periodEnd])
  // The shifts with time in this period (the list also holds the day before).
  const items = useMemo(() => [...byDay.values()].flat(), [byDay])
  const entries = useMemo(() => items.map(item => item.entry), [items])
  const forgotten = entries.filter(entry => isOpenClock(entry) && entry.work_date < today).sort((a, b) => a.work_date.localeCompare(b.work_date))

  // A link to a forgotten clock (Today, Who's Working) opens its fix.
  const linked = loaded && focusEntryId ? entries.find(entry => entry.id === focusEntryId) ?? null : null
  const autoFixId = linked && !readOnly && isOpenClock(linked) && linked.work_date < today ? linked.id : null
  const fixingId = fixChoice && fixChoice.focus === focusEntryId ? fixChoice.id : autoFixId
  const setFixingId = (id: number | null) => setFixChoice({ focus: focusEntryId, id })
  useEffect(() => { holdRefresh.current = pauseRefresh || fixingId !== null || editing !== null }, [pauseRefresh, fixingId, editing])
  const rowsBlocked = blockedReason ?? (loading ? 'Loading the latest copy of these shifts…' : null)

  useEffect(() => {
    if (!linked || scrolledTo.current === linked.id) return
    scrolledTo.current = linked.id
    // A shift from the day before the period shows only as its continuation.
    requestAnimationFrame(() => {
      const row = document.getElementById(`timecard-entry-${linked.id}`)
        ?? document.getElementById(`timecard-entry-${linked.id}-continued`)
      row?.scrollIntoView?.({ block: 'center' })
    })
  }, [linked])

  // The same in-period hours the day rows show.
  const waitingHours = items.filter(({ entry }) => entry.status === 'completed' && entry.approval_status === 'pending').reduce((sum, item) => sum + item.hours, 0)
  const approvedHours = state.summary && loaded ? state.summary.total_hours : items.filter(({ entry }) => isApprovedTime(entry)).reduce((sum, item) => sum + item.hours, 0)
  const overtimeHours = loaded ? state.summary?.overtime_hours ?? 0 : 0
  const overtimeWaiting = entries.filter(entry => entry.overtime_status === 'pending').length

  const days = payPeriodDays(period)
  const futureDays = days.filter(date => date > today && !byDay.has(date))
  const shownDays = days.filter(date => !futureDays.includes(date))
  const periodLabel = formatPayPeriod(period)

  return (
    <section aria-label={`${person.name}'s timecard`} className="space-y-4">
      {backLink}
      <div className="flex items-center gap-3">
        <Avatar name={person.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title font-semibold text-ink">{person.name}</h2>
          {person.meta && <p className="truncate text-body-sm text-ink-muted">{person.meta}</p>}
        </div>
        {actions}
      </div>

      <PeriodStepper period={period} onChange={onPeriodChange} max={today} />

      {readOnly && (
        <p className="rounded-card border border-line bg-surface-muted px-4 py-3 text-body-sm text-ink">
          Employment ended{person.terminationEffectiveOn ? ` ${monthDay(person.terminationEffectiveOn)}` : ''}. This timecard is read-only.
        </p>
      )}

      {!loaded ? (
        <div aria-busy="true" aria-label="Loading the timecard" className="space-y-2 rounded-card border border-line bg-surface p-4">
          <Skeleton height={20} className="w-2/3" />
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} height={40} className="w-full" />)}
        </div>
      ) : state.error ? (
        <ErrorState title="Couldn't load this timecard." description={state.error} onRetry={reload} />
      ) : (
        <>
          <dl className="grid grid-cols-3 divide-x divide-line rounded-card border border-line bg-surface text-center">
            <div className="px-2 py-3">
              <dt className="text-caption text-ink-muted">Approved</dt>
              <dd className="text-title font-semibold tabular-nums text-ink">{formatHours(approvedHours)}</dd>
            </div>
            <div className="px-2 py-3">
              <dt className="text-caption text-ink-muted">Waiting</dt>
              <dd className="text-title font-semibold tabular-nums text-ink">{formatHours(waitingHours)}</dd>
            </div>
            <div className="px-2 py-3">
              <dt className="text-caption text-ink-muted">Overtime</dt>
              <dd className="text-title font-semibold tabular-nums text-ink">
                {/* Without the report, overtime is unknown, not zero. */}
                {state.summaryFailed ? <span className="block text-body-sm font-normal text-ink-muted">Didn't load</span> : overtimeHours > 0 ? formatHours(overtimeHours) : '—'}
                {overtimeWaiting > 0 && <span className="block text-caption font-normal text-amber-900">{overtimeWaiting} waiting</span>}
              </dd>
            </div>
          </dl>

          {forgotten.length > 0 && (
            <p role="status" className="flex items-start gap-2.5 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm text-amber-900">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                Still clocked in from {shortDay(forgotten[0].work_date)}.
                {!readOnly && (lockAt ? ` Fix it before the lock on ${LOCK_FORMAT.format(new Date(lockAt))}.` : ' Fix it before the lock.')}
              </span>
            </p>
          )}

          {entries.length === 0 ? (
            <EmptyState
              title={`No time recorded for ${person.firstName} in ${periodLabel}.`}
              action={onLogMissedTime && !readOnly ? <Button variant="secondary" icon={<Plus className="size-4" />} onClick={onLogMissedTime} disabled={!!logMissedTimeBlockedReason} title={logMissedTimeBlockedReason ?? undefined}>Log missed time</Button> : undefined}
            />
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <ul aria-label={`Days in ${periodLabel}`} className="divide-y divide-line">
                {shownDays.map(date => (
                  <li key={date}>
                    <DayRow
                      date={date}
                      today={today}
                      items={byDay.get(date) ?? []}
                      categories={categories}
                      readOnly={readOnly}
                      blockedReason={rowsBlocked}
                      highlightedEntryId={focusEntryId}
                      fixingEntryId={fixingId}
                      onFix={(entry) => setFixingId(entry?.id ?? null)}
                      onOpen={setEditing}
                      onSaved={afterWrite}
                    />
                  </li>
                ))}
              </ul>
              {futureDays.length > 0 && (
                <p className="border-t border-line px-4 py-2.5 text-body-sm text-ink-subtle">{futureLine(futureDays)}</p>
              )}
            </div>
          )}

          {onLogMissedTime && !readOnly && entries.length > 0 && (
            <Button variant="secondary" fullWidth icon={<Plus className="size-4" />} onClick={onLogMissedTime} disabled={!!logMissedTimeBlockedReason} title={logMissedTimeBlockedReason ?? undefined}>
              Log missed time for {person.firstName}
            </Button>
          )}
        </>
      )}

      <EditTimeEntryModal
        phoneSheet
        isOpen={!!editing}
        entry={editing}
        categories={editing ? categories.filter(category => editing.user.time_category_ids?.includes(category.id)) : []}
        canManageTeamTime
        canDelete
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); afterWrite() }}
        onDeleted={() => { setEditing(null); afterWrite() }}
      />
    </section>
  )
}
