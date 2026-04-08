import { useState, useEffect, useCallback } from 'react'
import WhosWorking from '../../components/time-tracking/WhosWorking'
import ClockInOutCard from '../../components/time-tracking/ClockInOutCard'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'

const actionLinks = [
  {
    title: 'Time Tracking',
    description: 'Review entries, resolve issues, and finalize work weeks.',
    href: '/admin/time',
  },
  {
    title: 'Reports',
    description: 'Inspect payroll summaries, exports, and category totals.',
    href: '/admin/time?tab=reports',
  },
  {
    title: 'Schedule',
    description: 'Balance staffing, handoffs, and planned hours for the week.',
    href: '/admin/schedule',
  },
  {
    title: 'Users',
    description: 'Manage roles, invites, and kiosk PIN access for the team.',
    href: '/admin/users',
  },
]

function formatDateISO(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatWeekStart(date: Date): string {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  return formatDateISO(d)
}

export default function Dashboard() {
  const { userRole, isClerkEnabled } = useAuthContext()
  const isAdmin = !isClerkEnabled || userRole === 'admin'

  useEffect(() => { document.title = isAdmin ? 'Dashboard | AIRE Ops' : 'My Dashboard | AIRE Ops' }, [isAdmin])

  if (isAdmin) return <AdminDashboard />
  return <EmployeeDashboard />
}

function EmployeeDashboard() {
  const [mySchedule, setMySchedule] = useState<{ work_date: string; formatted_start_time: string; formatted_end_time: string; hours: number; notes?: string | null }[]>([])

  useEffect(() => {
    api.getMySchedule().then(r => {
      if (r.data?.schedules) setMySchedule(r.data.schedules)
    }).catch(() => undefined)
  }, [])

  const todayStr = formatDateISO(new Date())

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">AIRE Ops</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">My Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Clock in, track breaks, and view your schedule.</p>
      </div>

      <ClockInOutCard />

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">My Upcoming Schedule</h2>
          <p className="mt-0.5 text-sm text-slate-500">Your shifts for the next two weeks.</p>
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
                    {s.notes && <p className="mt-0.5 text-xs text-slate-500">{s.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-700">{s.formatted_start_time} — {s.formatted_end_time}</p>
                    <p className="text-xs text-slate-400">{s.hours}h</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/admin/time"
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:bg-slate-50"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">My Time Entries</h3>
            <p className="mt-0.5 text-xs text-slate-500">View and manage your logged hours.</p>
          </div>
          <svg className="h-5 w-5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        <Link
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
        </Link>
      </div>
    </div>
  )
}

function AdminDashboard() {
  const [stats, setStats] = useState({
    activeCount: 0,
    pendingApprovals: 0,
    scheduledToday: 0,
    weeklyHours: 0,
    totalMembers: 0,
  })

  const loadStats = useCallback(async () => {
    try {
      const [workersRes, approvalsRes, schedulesRes, usersRes] = await Promise.all([
        api.getWhosWorking(),
        api.getPendingApprovals(),
        api.getSchedules({ week: formatWeekStart(new Date()) }),
        api.getUsers(),
      ])

      const workers = workersRes.data?.workers ?? []
      const active = workers.filter(
        (w) => w.status === 'clocked_in' || w.status === 'on_break',
      ).length

      const todayStr = formatDateISO(new Date())
      const schedules = schedulesRes.data?.schedules ?? []
      const todaySchedules = schedules.filter((s) => s.work_date === todayStr)
      const weeklyHours = schedules.reduce((sum, s) => sum + s.hours, 0)

      setStats({
        activeCount: active,
        pendingApprovals: approvalsRes.data?.count ?? 0,
        scheduledToday: todaySchedules.length,
        weeklyHours,
        totalMembers: usersRes.data?.users.length ?? 0,
      })
    } catch {
      // Dashboard stats are best-effort
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetch pattern; setState is in async callback
    loadStats()
  }, [loadStats])

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">AIRE Ops</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Operations Dashboard</h1>
          </div>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Link
              to="/admin/time?tab=reports"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Open Reports
            </Link>
            <Link
              to="/admin/schedule"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Adjust Schedule
            </Link>
          </div>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Keep staffing, time tracking, and payroll-ready reporting aligned from one place.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:hidden">
          <Link
            to="/admin/time?tab=reports"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Open Reports
          </Link>
          <Link
            to="/admin/schedule"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Adjust Schedule
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Right Now" value={stats.activeCount.toString()} sublabel="Staff currently clocked in or on break" accent />
        <StatCard label="Pending Approvals" value={stats.pendingApprovals.toString()} sublabel="Manual entries or overtime waiting on admin review" accent />
        <StatCard label="Scheduled Today" value={stats.scheduledToday.toString()} sublabel="Assigned shifts on the current Guam workday" accent />
        <StatCard label="Weekly Scheduled Hours" value={`${stats.weeklyHours.toFixed(1)}h`} sublabel="Total planned hours across the active week" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Who's Working</h2>
            <p className="mt-0.5 text-sm text-slate-500">Live staffing status for the current Guam workday.</p>
          </div>
          <button
            onClick={loadStats}
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
          <p className="mt-0.5 text-sm text-slate-500">High-signal admin surfaces to keep the team moving.</p>
        </div>
        <div className="space-y-2">
          {actionLinks.map((item) => (
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
      </section>
    </div>
  )
}

function StatCard({ label, value, sublabel, accent }: { label: string; value: string; sublabel: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accent ? 'text-cyan-700' : 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-400">{sublabel}</p>
    </div>
  )
}
