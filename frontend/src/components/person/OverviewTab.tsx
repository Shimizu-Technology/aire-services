import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronRight } from 'lucide-react'
import type { AdminUser, AuditLogEntry, LeaveRequest, TimeEntry } from '../../lib/api'
import { peopleApi } from '../../lib/api/people'
import { timecardsApi, type TimecardSummaryEmployee } from '../../lib/api/timecards'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { employeeEvidenceApi } from '../../lib/employeeEvidenceApi'
import { formatPayPeriod, type PayPeriod } from '../../lib/payPeriods'
import { PERSON_TOTAL_LABELS } from '../../lib/payrollTerms'
import { formatHours, guamDate, isApprovedTime, isOpenClock, timecardDays } from '../../lib/timecards'
import { dayLabel, monthDay, timeLabel } from '../today/format'
import { Button, EmptyState, ErrorState, type MenuItem } from '../ui'
import { Skeleton } from '../ui/Skeleton'

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T }

const RECENT_ACTIVITY = 5
const LEAVE_KINDS: Record<LeaveRequest['leave_type'], string> = {
  paid_time_off: 'Paid time off',
  sick: 'Sick leave',
  unpaid: 'Unpaid leave',
  bereavement: 'Bereavement leave',
  other: 'Leave',
}

interface OverviewTabProps {
  user: AdminUser
  period: PayPeriod
  today: string
  /** The Time tab for this pay period. */
  timecardHref: string
  /** Activity filtered to this person. */
  activityHref: string
  /** Scroll Recent activity into view once it loads (an old ?tab=activity link). */
  focusActivity?: boolean
  /** The desktop Quick actions column. */
  quickActions: MenuItem[]
}

interface PeriodNumbers {
  approved: number
  waiting: number
  overtimeWaiting: number
  last: TimeEntry | null
}

function periodNumbers(entries: TimeEntry[], summary: TimecardSummaryEmployee | null, period: PayPeriod): PeriodNumbers {
  // The same in-period hours the Time tab shows.
  const items = [...timecardDays(entries, period).values()].flat()
  const waiting = items.filter(({ entry }) => entry.status === 'completed' && entry.approval_status === 'pending').reduce((sum, item) => sum + item.hours, 0)
  const approved = summary ? summary.total_hours : items.filter(({ entry }) => isApprovedTime(entry)).reduce((sum, item) => sum + item.hours, 0)
  const overtimeWaiting = items
    .filter(({ entry }) => entry.overtime_status === 'pending')
    .reduce((sum, { entry }) => sum + (entry.pending_overtime_hours ?? 0), 0)
  const order = (entry: TimeEntry) => entry.clock_in_at ?? `${entry.work_date}T${entry.start_time ?? '00:00'}`
  const last = items.map(item => item.entry).sort((a, b) => order(b).localeCompare(order(a)))[0] ?? null
  return { approved, waiting, overtimeWaiting, last }
}

function lastClockLabel(entry: TimeEntry, today: string) {
  const day = entry.work_date === today ? 'Today' : dayLabel(entry.work_date)
  const start = entry.clock_in_at ? timeLabel(entry.clock_in_at) : entry.formatted_start_time
  if (isOpenClock(entry)) return `${day}, on the clock since ${start ?? 'an unknown time'}`
  const end = entry.clock_out_at ? timeLabel(entry.clock_out_at) : entry.formatted_end_time
  return start && end ? `${day} ${start} – ${end}` : `${day} · ${formatHours(entry.hours)}`
}

function leaveDates(request: LeaveRequest) {
  if (request.start_date === request.end_date) return dayLabel(request.start_date)
  return `${dayLabel(request.start_date)} – ${monthDay(request.end_date)}`
}

function Section({ title, action, id, children }: { title: string; action?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="scroll-mt-20"
    >
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h2 id={id ? `${id}-title` : undefined} className="text-body font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const textLink = 'inline-flex min-h-11 items-center text-body-sm font-semibold text-primary hover:underline'
const card = 'rounded-card border border-line bg-surface'

/** This pay period, what's coming up and what changed lately, for one person. */
export function OverviewTab({ user, period, today, timecardHref, activityHref, focusActivity = false, quickActions }: OverviewTabProps) {
  const [numbers, setNumbers] = useState<Loadable<PeriodNumbers>>({ status: 'loading' })
  const [leave, setLeave] = useState<Loadable<LeaveRequest[]>>({ status: 'loading' })
  const [activity, setActivity] = useState<Loadable<AuditLogEntry[]>>({ status: 'loading' })
  const [retry, setRetry] = useState({ numbers: 0, leave: 0, activity: 0 })

  useEffect(() => {
    let cancelled = false
    setNumbers({ status: 'loading' })
    void Promise.all([timecardsApi.personEntries(user.id, period), timecardsApi.personSummary(user.id, period)]).then(([entries, summary]) => {
      if (cancelled) return
      if (!entries.data) { setNumbers({ status: 'error', message: entries.error ?? "Couldn't load the shifts." }); return }
      const row = summary.data?.employees.find(employee => employee.id === user.id) ?? null
      setNumbers({ status: 'ready', value: periodNumbers(entries.data, row, period) })
    })
    return () => { cancelled = true }
  }, [user.id, period, retry.numbers])

  useEffect(() => {
    let cancelled = false
    setLeave({ status: 'loading' })
    void peopleApi.upcomingLeave(user.id, today).then((response) => {
      if (cancelled) return
      setLeave(response.data ? { status: 'ready', value: response.data } : { status: 'error', message: response.error ?? "Couldn't load leave." })
    })
    return () => { cancelled = true }
  }, [user.id, today, retry.leave])

  useEffect(() => {
    const controller = new AbortController()
    setActivity({ status: 'loading' })
    employeeEvidenceApi.activity(String(user.id), 1, controller.signal)
      .then((result) => setActivity({ status: 'ready', value: result.audit_logs.slice(0, RECENT_ACTIVITY) }))
      .catch((reason) => { if (!controller.signal.aborted) setActivity({ status: 'error', message: reason instanceof Error ? reason.message : "Couldn't load activity." }) })
    return () => controller.abort()
  }, [user.id, retry.activity])

  // An old Activity link lands here; bring Recent activity into view once it's drawn.
  const activityReady = activity.status !== 'loading'
  useEffect(() => {
    if (!focusActivity || !activityReady) return
    requestAnimationFrame(() => document.getElementById('activity')?.scrollIntoView?.({ block: 'start' }))
  }, [focusActivity, activityReady])

  const again = (key: keyof typeof retry) => setRetry(value => ({ ...value, [key]: value[key] + 1 }))
  const periodName = useMemo(() => formatPayPeriod(period), [period])

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-6">
        <Section
          title={`This pay period · ${periodName}`}
          action={<Link to={timecardHref} className={textLink}>Timecard</Link>}
        >
          {numbers.status === 'loading' ? (
            <div aria-busy="true" aria-label="Loading this pay period" className={`${card} space-y-2 p-4`}>
              {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} height={20} className="w-full" />)}
            </div>
          ) : numbers.status === 'error' ? (
            <ErrorState title="Couldn't load this pay period." description={numbers.message} onRetry={() => again('numbers')} />
          ) : (
            <dl className={`${card} divide-y divide-line text-body-sm`}>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <dt className="text-ink-muted">{PERSON_TOTAL_LABELS.approved}</dt>
                <dd className="font-semibold tabular-nums text-ink">{formatHours(numbers.value.approved)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <dt className="text-ink-muted">{PERSON_TOTAL_LABELS.waiting}</dt>
                <dd className={`font-semibold tabular-nums ${numbers.value.waiting > 0 ? 'text-amber-900' : 'text-ink'}`}>{formatHours(numbers.value.waiting)}</dd>
              </div>
              {numbers.value.overtimeWaiting > 0 && (
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <dt className="text-ink-muted">Overtime waiting</dt>
                  <dd className="font-semibold tabular-nums text-amber-900">{formatHours(numbers.value.overtimeWaiting)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <dt className="shrink-0 text-ink-muted">Last clock</dt>
                <dd className="text-right font-semibold text-ink">{numbers.value.last ? lastClockLabel(numbers.value.last, today) : `None in ${periodName}`}</dd>
              </div>
            </dl>
          )}
        </Section>

        <Section title="Coming up">
          {leave.status === 'loading' ? (
            <Skeleton height={56} className="w-full" />
          ) : leave.status === 'error' ? (
            <ErrorState title="Couldn't load leave." description={leave.message} onRetry={() => again('leave')} />
          ) : leave.value.length === 0 ? (
            <p className={`${card} px-4 py-3 text-body-sm text-ink-muted`}>No leave requested or approved from today on.</p>
          ) : (
            <ul className={`${card} divide-y divide-line`}>
              {leave.value.map(request => (
                <li key={request.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CalendarDays aria-hidden="true" className="size-5 shrink-0 text-ink-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-semibold text-ink">{LEAVE_KINDS[request.leave_type] ?? 'Leave'} · {leaveDates(request)}</p>
                    <p className="mt-0.5 text-body-sm text-ink-muted [overflow-wrap:anywhere]">
                      {request.status === 'pending' ? 'Waiting for approval' : 'Approved'}
                      {request.reason ? ` · ${request.reason}` : ''}
                    </p>
                  </div>
                  {request.status === 'pending' && (
                    <Link to={ADMIN_PATHS.leave} className={textLink}>Review</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="activity"
          title="Recent activity"
          action={<Link to={activityHref} className={textLink}>All activity</Link>}
        >
          {activity.status === 'loading' ? (
            <Skeleton height={120} className="w-full" />
          ) : activity.status === 'error' ? (
            <ErrorState title="Couldn't load activity." description={activity.message} onRetry={() => again('activity')} />
          ) : activity.value.length === 0 ? (
            <EmptyState title="Nothing recorded yet." description="Changes to this person's access and profile show here." />
          ) : (
            <ul className={`${card} divide-y divide-line text-body-sm`}>
              {activity.value.map(event => (
                <li key={event.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{event.summary}</span>
                  <span className="shrink-0 text-ink-subtle">{guamDate(event.occurred_at) === today ? timeLabel(event.occurred_at) : monthDay(guamDate(event.occurred_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {quickActions.length > 0 && (
        <aside aria-labelledby="quick-actions-title" className="hidden lg:block">
          <h2 id="quick-actions-title" className="mb-2 flex min-h-11 items-center text-body font-semibold text-ink">Quick actions</h2>
          <ul className={`${card} divide-y divide-line`}>
            {quickActions.map(item => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  fullWidth
                  icon={item.icon}
                  onClick={item.onSelect}
                  disabled={item.disabled}
                  className="justify-start rounded-none px-4 text-ink"
                >
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronRight aria-hidden="true" className="size-4 text-ink-subtle" />
                </Button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}
