import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import WhosWorking from '../../components/time-tracking/WhosWorking'
import { api } from '../../lib/api'
import { formatDateISO } from '../../lib/dateUtils'

type Snapshot = {
  activeWorkers: number
  scheduledToday: number
  pendingApprovals: number
  totalTeamMembers: number
  weeklyScheduledHours: number
}

const quickLinks = [
  { title: 'Time Tracking', description: 'Review entries, resolve issues, and finalize work weeks.', href: '/admin/time' },
  { title: 'Reports', description: 'Inspect payroll summaries, exports, and category totals.', href: '/admin/reports' },
  { title: 'Schedule', description: 'Balance staffing, handoffs, and planned hours for the week.', href: '/admin/schedule' },
  { title: 'Users', description: 'Manage roles, invites, and kiosk PIN access for the team.', href: '/admin/users' },
]

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot>({
    activeWorkers: 0,
    scheduledToday: 0,
    pendingApprovals: 0,
    totalTeamMembers: 0,
    weeklyScheduledHours: 0,
  })

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    setSnapshotError(null)
    try {
      const today = formatDateISO(new Date())
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())

      const [workersRes, pendingRes, usersRes, schedulesRes] = await Promise.all([
        api.getWhosWorking(),
        api.getPendingApprovals(),
        api.getAdminUsers(),
        api.getSchedules({ week: formatDateISO(weekStart) }),
      ])

      const workers = workersRes.data?.workers || []
      const schedules = schedulesRes.data?.schedules || []
      const users = usersRes.data?.users || []

      setSnapshot({
        activeWorkers: workers.filter((worker) => worker.status === 'clocked_in' || worker.status === 'on_break').length,
        scheduledToday: schedules.filter((schedule) => schedule.work_date === today).length,
        pendingApprovals: pendingRes.data?.count || 0,
        totalTeamMembers: users.filter((user) => user.role === 'admin' || user.role === 'employee').length,
        weeklyScheduledHours: schedules.reduce((sum, schedule) => sum + schedule.hours, 0),
      })
    } catch {
      setSnapshotError('Could not refresh the dashboard snapshot right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSnapshot()
  }, [loadSnapshot])

  const cards = useMemo(() => [
    {
      label: 'Active Right Now',
      value: loading ? '—' : String(snapshot.activeWorkers),
      tone: 'text-emerald-600',
      helper: 'Staff currently clocked in or on break',
    },
    {
      label: 'Pending Approvals',
      value: loading ? '—' : String(snapshot.pendingApprovals),
      tone: snapshot.pendingApprovals > 0 ? 'text-amber-600' : 'text-slate-900',
      helper: 'Manual entries or overtime waiting on admin review',
    },
    {
      label: 'Scheduled Today',
      value: loading ? '—' : String(snapshot.scheduledToday),
      tone: 'text-cyan-700',
      helper: 'Assigned shifts on the current Guam workday',
    },
    {
      label: 'Weekly Scheduled Hours',
      value: loading ? '—' : `${snapshot.weeklyScheduledHours.toFixed(1)}h`,
      tone: 'text-slate-900',
      helper: 'Total planned hours across the active week',
    },
  ], [loading, snapshot])

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">AIRE Ops</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Operations Dashboard</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Keep staffing, time tracking, and payroll-ready reporting aligned from one place. This is the daily control center for the AIRE admin side.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/reports" className="inline-flex items-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
            Open Reports
          </Link>
          <Link to="/admin/schedule" className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
            Adjust Schedule
          </Link>
        </div>
      </div>

      {snapshotError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {snapshotError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-sm font-medium text-slate-500">{card.label}</p>
            <div className={`mt-2 text-3xl font-bold ${card.tone}`}>{card.value}</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">{card.helper}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr,0.9fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Who’s Working</h2>
              <p className="mt-1 text-sm text-slate-500">Live staffing status for the current Guam workday.</p>
            </div>
            <button onClick={loadSnapshot} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
              Refresh snapshot
            </button>
          </div>
          <WhosWorking alwaysShow dashboardStyle />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Action Center</h2>
          <p className="mt-1 text-sm text-slate-500">High-signal admin surfaces to keep the team moving.</p>
          <div className="mt-5 space-y-3">
            {quickLinks.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="block rounded-2xl border border-slate-200 px-4 py-4 transition hover:border-cyan-300 hover:bg-cyan-50/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-500">{item.description}</p>
                  </div>
                  <span className="text-cyan-700">→</span>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">Current Team Snapshot</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500">Total team members</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : snapshot.totalTeamMembers}</div>
              </div>
              <div>
                <div className="text-slate-500">Approvals waiting</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{loading ? '—' : snapshot.pendingApprovals}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
