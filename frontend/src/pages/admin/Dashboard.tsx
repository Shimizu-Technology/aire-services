import PayrollCutoffNotice from '../../components/time-tracking/PayrollCutoffNotice'
import PayrollLockControl from '../../components/payroll/PayrollLockControl'
import { useState, useEffect, useCallback } from 'react'
import WhosWorking from '../../components/time-tracking/WhosWorking'
import ClockInOutCard from '../../components/time-tracking/ClockInOutCard'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { businessDateISO, businessWeekStart } from '../../lib/dateUtils'
import { useCapabilities } from '../../lib/useCapabilities'
import type { Capabilities, Capability } from '../../lib/roles'
import type { TimeEntry } from '../../lib/api'
import { currentPayrollPeriod, formatPayrollDate, formatPayrollPeriod, greatestPayrollEndDate, payrollPreparationPeriod, withPayrollPeriod } from '../../lib/payrollPeriods'
import { ADMIN_PATHS, landingPathFor, timeSectionHref } from '../../lib/adminRoutes'
import { useAuthContext } from '../../contexts/AuthContext'
import { useSchedulesEnabled } from '../../lib/useSchedulesEnabled'
import Today from './Today'

const actionLinks: { title: string; description: string; href: string; capability: Capability }[] = [
  {
    title: 'Timecards',
    description: 'Find and fix anyone’s recorded time, or log missed time.',
    href: ADMIN_PATHS.timecards,
    capability: 'manage_team_time',
  },
  {
    title: 'Pending Approvals',
    description: 'Filter by date, review oldest hours first, and clear payroll cutoffs.',
    href: ADMIN_PATHS.approvals,
    capability: 'approve_time',
  },
  {
    title: 'Leave Requests',
    description: 'Submit your own time off and review employee leave requests.',
    href: ADMIN_PATHS.leave,
    capability: 'approve_leave',
  },
  {
    title: 'Hours Reports',
    description: 'Inspect live hour summaries, working exports, and category totals.',
    href: ADMIN_PATHS.reports,
    capability: 'export_hours_reports',
  },
  {
    title: 'Schedule',
    description: 'Balance staffing, handoffs, and planned hours for the week.',
    href: '/admin/schedule',
    capability: 'manage_schedules',
  },
  {
    title: 'Team',
    description: 'Manage roles, invites, and kiosk PIN access for the team.',
    href: '/admin/users',
    capability: 'manage_users',
  },
]

function formatWeekStart(date: Date): string {
  return businessWeekStart(businessDateISO(date))
}

export default function Dashboard() {
  const capabilities = useCapabilities()
  const supervises = capabilities.manage_team_time
  const showsToday = landingPathFor(capabilities) === ADMIN_PATHS.today

  // Today sets its own title.
  useEffect(() => { if (!showsToday) document.title = supervises ? 'Dashboard | AIRE Ops' : 'My Dashboard | AIRE Ops' }, [showsToday, supervises])

  if (showsToday) return <Today />
  if (supervises) return <AdminDashboard capabilities={capabilities} />
  return <MyTimeHome />
}

/** My Time (/admin/my-time): your clock, today's activity and leave. Employees land here. */
export function MyTimeHome() {
  const capabilities = useCapabilities()
  const { currentUser } = useAuthContext()
  const schedulesEnabled = useSchedulesEnabled()
  // Supervisors' own entries live in Timecards, filtered to them.
  const myHoursHref = capabilities.manage_team_time
    ? timeSectionHref('entries', currentUser ? { user_id: String(currentUser.id) } : undefined)
    : ADMIN_PATHS.myHours
  useEffect(() => { document.title = 'My Time | AIRE Ops' }, [])
  const [mySchedule, setMySchedule] = useState<{ work_date: string; formatted_start_time: string; formatted_end_time: string; hours: number; notes?: string | null; approved_leave_conflict?: boolean }[]>([])
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([])
  const [loadingTodayEntries, setLoadingTodayEntries] = useState(true)

  const todayStr = businessDateISO()
  const loadDashboardData = useCallback(async () => {
    try {
      // Shifts are only fetched while "Use schedules" is on.
      const [scheduleRes, entriesRes] = await Promise.all([
        schedulesEnabled ? api.getMySchedule() : Promise.resolve(null),
        // Supervisors can read the team's entries, so ask for this person's own.
        currentUser
          ? api.getTimeEntries({ date: todayStr, per_page: 20, user_id: currentUser.id })
          : Promise.resolve(null),
      ])

      if (scheduleRes?.data?.schedules) setMySchedule(scheduleRes.data.schedules)
      if (entriesRes.data?.time_entries) setTodayEntries(entriesRes.data.time_entries)
    } catch {
      // Employee dashboard is best-effort.
    } finally {
      setLoadingTodayEntries(false)
    }
  }, [todayStr, schedulesEnabled, currentUser])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  return (
    <div className="space-y-6">
      <PayrollCutoffNotice />
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Time</h1>
        <p className="mt-1 text-sm text-slate-600">{schedulesEnabled ? 'Clock in, track breaks, and view your schedule.' : 'Clock in, track breaks, and see today’s time.'}</p>
      </div>

      <ClockInOutCard onStatusChange={loadDashboardData} />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Today&apos;s Activity</h2>
          <p className="mt-0.5 text-sm text-slate-500">Your clock-ins, active time, and completed entries for today.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {loadingTodayEntries ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">Loading today&apos;s activity…</div>
          ) : todayEntries.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">No time logged today yet.</div>
          ) : (
            todayEntries.map((entry) => {
              const badge =
                entry.status === 'on_break'
                  ? { label: 'On break', className: 'border-amber-200 bg-amber-50 text-amber-700' }
                  : entry.status === 'clocked_in'
                    ? { label: 'Clocked in', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
                    : entry.approval_status === 'pending'
                      ? { label: 'Pending review', className: 'border-amber-200 bg-amber-50 text-amber-700' }
                      : { label: 'Completed', className: 'border-slate-200 bg-slate-50 text-slate-700' }

              return (
                <div key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900">
                        {entry.time_category?.name ?? 'General'}
                      </p>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {entry.formatted_start_time ?? '—'}
                      {entry.formatted_end_time ? ` — ${entry.formatted_end_time}` : ' — In progress'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-slate-900">{entry.hours.toFixed(2)}h</p>
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{entry.entry_method}</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {schedulesEnabled && <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">My Upcoming Schedule</h2>
          <p className="mt-0.5 text-sm text-slate-500">Your upcoming shifts.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {mySchedule.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">No upcoming shifts scheduled.</div>
          ) : (
            mySchedule.map((s, i) => {
              const isToday = s.work_date === todayStr
              return (
                <div key={i} className={`flex items-center justify-between px-5 py-3 ${isToday ? 'bg-cyan-50/50' : ''}`}>
                  <div>
                    <p className={`text-sm font-medium ${isToday ? 'text-cyan-700' : 'text-slate-900'}`}>
                      {new Date(s.work_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {isToday && <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-700">Today</span>}
                    </p>
                    {s.approved_leave_conflict && <p className="mt-1 text-sm font-medium text-amber-800">Approved leave overlaps this shift. Check with your scheduler.</p>}
                    {s.notes && <p className="mt-0.5 text-xs text-slate-500">{s.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-700">{s.formatted_start_time} — {s.formatted_end_time}</p>
                    <p className="text-xs text-slate-500">{s.hours}h</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to={myHoursHref}
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:bg-slate-50"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">My Hours</h3>
            <p className="mt-0.5 text-xs text-slate-500">View and manage your logged hours.</p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        <Link
          to={ADMIN_PATHS.leave}
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:bg-slate-50"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Request Leave</h3>
            <p className="mt-0.5 text-xs text-slate-500">Submit and track your time-off requests.</p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        {schedulesEnabled && <Link
          to="/admin/schedule"
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:bg-slate-50"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Full Schedule</h3>
            <p className="mt-0.5 text-xs text-slate-500">See the team schedule for the week.</p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>}
      </div>
    </div>
  )
}

// Owners, admins and managers. Managers see the same staffing and approval
// picture without the payroll workspace (they can't open it).
function AdminDashboard({ capabilities }: { capabilities: Capabilities }) {
  const canManagePayroll = capabilities.manage_payroll
  const schedulesEnabled = useSchedulesEnabled()
  const [payrollPeriod, setPayrollPeriod] = useState(currentPayrollPeriod)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [snapshotAt, setSnapshotAt] = useState<Date | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [stats, setStats] = useState({
    activeCount: 0,
    openFromEarlierDays: 0,
    pendingApprovals: 0,
    // Null when schedules are off or the schedule request failed.
    scheduledToday: null as number | null,
    weeklyHours: null as number | null,
    totalMembers: 0,
    periodPendingApprovals: 0,
    periodApprovalHours: 0,
    payrollFinalizedThrough: null as string | null,
  })

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const [workersRes, approvalsRes, schedulesRes, usersRes, payrollRes, cutoffRes] = await Promise.all([
        api.getWhosWorking(),
        api.getPendingApprovals(),
        // Schedules are optional: skipped while "Use schedules" is off, and a
        // failure only blanks the two schedule cards.
        schedulesEnabled
          ? api.getSchedules({ week: formatWeekStart(new Date()) }).catch(() => null)
          : Promise.resolve(null),
        api.getUsers(),
        canManagePayroll ? api.getPayrollBatches() : Promise.resolve(null),
        api.getPayrollCutoff(),
      ])

      const failure = [workersRes, approvalsRes, usersRes, payrollRes, cutoffRes].find((result) => result && (result.error || !result.data))
      if (failure) {
        setSnapshotError(failure.error || 'Dashboard snapshot unavailable')
        return
      }
      const preparationPeriod = payrollPreparationPeriod(cutoffRes.data, payrollRes?.data?.payroll_batches ?? [])
      const periodApprovals = await api.getPendingApprovals({ start_date: preparationPeriod.start, end_date: preparationPeriod.end, per_page: 1 })
      if (periodApprovals.error || !periodApprovals.data) {
        setSnapshotError(periodApprovals.error || 'Payroll-period approvals unavailable')
        return
      }
      const workers = workersRes.data?.workers ?? []
      const active = workers.filter(
        (w) => w.status === 'clocked_in' || w.status === 'on_break',
      ).length

      const todayStr = businessDateISO()
      const schedules = schedulesRes && !schedulesRes.error ? schedulesRes.data?.schedules ?? null : null
      const scheduledToday = schedules ? schedules.filter((s) => s.work_date === todayStr).length : null
      const weeklyHours = schedules ? schedules.reduce((sum, s) => sum + s.hours, 0) : null

      setPayrollPeriod(preparationPeriod)
      setStats({
        periodPendingApprovals: periodApprovals.data.summary?.entry_count ?? periodApprovals.data.count,
        periodApprovalHours: periodApprovals.data.summary?.total_hours ?? 0,
        activeCount: active,
        openFromEarlierDays: workers.filter((w) => w.open_since_work_date).length,
        pendingApprovals: approvalsRes.data?.count ?? 0,
        scheduledToday,
        weeklyHours,
        totalMembers: usersRes.data?.users.length ?? 0,
        payrollFinalizedThrough: greatestPayrollEndDate(payrollRes?.data?.payroll_batches ?? []),
      })
      setSnapshotError(null)
      setSnapshotAt(new Date())
    } catch {
      setSnapshotError('Dashboard snapshot unavailable')
    } finally {
      setStatsLoading(false)
    }
  }, [canManagePayroll, schedulesEnabled])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // Payroll admins prepare payroll from the readiness card below, so the header
  // doesn't repeat that button.
  const primaryAction = canManagePayroll
    ? null
    : { label: 'Review Approvals', href: withPayrollPeriod(ADMIN_PATHS.approvals, payrollPeriod) }
  const scheduleActionLabel = capabilities.manage_schedules ? 'Adjust Schedule' : 'View Schedule'

  return (
    <div className="space-y-8">
      <PayrollCutoffNotice />
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">AIRE Ops</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Operations Dashboard</h1>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            {primaryAction && <Link
              to={primaryAction.href} aria-disabled={!snapshotAt} onClick={event => { if (!snapshotAt) event.preventDefault() }}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {primaryAction.label}
            </Link>}
            {schedulesEnabled && <Link
              to="/admin/schedule"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {scheduleActionLabel}
            </Link>}
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          {canManagePayroll
            ? 'Keep staffing, time tracking, and payroll-ready reporting aligned from one place.'
            : 'Keep staffing, time and approvals moving before each payroll cutoff.'}
        </p>
        {(primaryAction || schedulesEnabled) && <div className={`mt-4 grid gap-2 sm:hidden ${primaryAction && schedulesEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {primaryAction && <Link
            to={primaryAction.href} aria-disabled={!snapshotAt} onClick={event => { if (!snapshotAt) event.preventDefault() }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {primaryAction.label}
          </Link>}
          {schedulesEnabled && <Link
            to="/admin/schedule"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            {scheduleActionLabel}
          </Link>}
        </div>}
      </div>

      {snapshotError && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <p>{snapshotError}. {snapshotAt ? `Showing the last successful snapshot from ${snapshotAt.toLocaleTimeString()}. Refresh before making payroll decisions.` : 'Counts and payroll readiness are unavailable.'}</p>
        <button type="button" disabled={statsLoading} onClick={loadStats} className="mt-2 min-h-11 underline disabled:opacity-50">Retry dashboard snapshot</button>
      </div>}
      {!snapshotAt && !snapshotError && <p role="status">Loading dashboard snapshot…</p>}
      {snapshotAt && <>
      <div className={`grid grid-cols-2 gap-4 ${schedulesEnabled ? 'lg:grid-cols-4' : ''}`}>
        <StatCard
          label="Active Right Now"
          value={stats.activeCount.toString()}
          sublabel={stats.openFromEarlierDays > 0
            ? `Includes ${stats.openFromEarlierDays} still clocked in from an earlier day`
            : 'Staff currently clocked in or on break'}
          accent
        />
        <StatCard label="Pending Approvals" value={stats.pendingApprovals.toString()} sublabel="Shifts and overtime waiting for approval" accent />
        {schedulesEnabled && <>
          <StatCard label="Scheduled Today" value={stats.scheduledToday === null ? '—' : stats.scheduledToday.toString()} sublabel={stats.scheduledToday === null ? 'Schedule unavailable. Refresh to try again.' : 'Assigned shifts on the current Guam workday'} accent />
          <StatCard label="Weekly Scheduled Hours" value={stats.weeklyHours === null ? '—' : `${stats.weeklyHours.toFixed(1)}h`} sublabel={stats.weeklyHours === null ? 'Schedule unavailable. Refresh to try again.' : 'Total planned hours across the active week'} />
        </>}
      </div>

      <section className="overflow-hidden rounded-2xl border border-primary/20 bg-white shadow-sm">
        <div className="grid gap-0 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{canManagePayroll ? 'Payroll readiness' : 'Approvals this pay period'}</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 className="text-xl font-semibold text-slate-950">{formatPayrollPeriod(payrollPeriod)}</h2>
              {canManagePayroll && <p className="text-sm text-slate-500">
                {stats.payrollFinalizedThrough
                  ? `Finalized through ${formatPayrollDate(stats.payrollFinalizedThrough)}`
                  : 'No payroll cutoffs finalized yet'}
              </p>}
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {stats.periodPendingApprovals > 0
                ? `${stats.periodPendingApprovals} approval${stats.periodPendingApprovals === 1 ? '' : 's'} covering ${stats.periodApprovalHours.toFixed(2)} hours still need review.${canManagePayroll ? ' Pending work can remain tracked and excluded when you finalize.' : ' Anything still pending at the cutoff is left out of that payroll.'}`
                : canManagePayroll
                  ? 'No approvals are currently waiting. Preview the cutoff to confirm included hours, exclusions, and any blocking payroll data.'
                  : 'No approvals are currently waiting for this pay period.'}
            </p>
            {canManagePayroll && <PayrollLockControl variant="compact" />}
          </div>
          <div className="flex flex-col justify-center gap-3 border-t border-primary/10 bg-primary/5 p-5 sm:flex-row lg:flex-col lg:border-l lg:border-t-0">
            <Link to={withPayrollPeriod(ADMIN_PATHS.approvals, payrollPeriod)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/20 bg-white px-4 py-2.5 text-sm font-semibold text-primary transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Review approvals</Link>
            {canManagePayroll && <Link to={withPayrollPeriod('/admin/payroll', payrollPeriod)} aria-disabled={!snapshotAt} onClick={event => { if (!snapshotAt) event.preventDefault() }} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Prepare payroll cutoff</Link>}
          </div>
        </div>
      </section>

      </>}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Who's Working</h2>
            <p className="mt-0.5 text-sm text-slate-500">Live staffing status for the current Guam workday.</p>
          </div>
          <button
            onClick={loadStats}
            disabled={statsLoading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Refresh snapshot
          </button>
        </div>
        <div className="p-5">
          <WhosWorking alwaysShow dashboardStyle />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Action Center</h2>
          <p className="mt-0.5 text-sm text-slate-500">High-signal surfaces to keep the team moving.</p>
        </div>
        <div className="space-y-2">
          {actionLinks.filter((item) => capabilities[item.capability] && (schedulesEnabled || item.href !== ADMIN_PATHS.schedule)).map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-4 transition hover:border-slate-200 hover:bg-slate-50"
            >
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>
              </div>
              <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </section>

      {snapshotAt && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Current Team Snapshot</p>
        <div className="mt-3 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="text-sm text-slate-500">Total team members</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.totalMembers}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Approvals waiting</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.pendingApprovals}</p>
          </div>
        </div>
      </section>}
    </div>
  )
}

function StatCard({ label, value, sublabel, accent }: { label: string; value: string; sublabel: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ? 'text-cyan-700' : 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sublabel}</p>
    </div>
  )
}
