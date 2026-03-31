import WhosWorking from '../../components/time-tracking/WhosWorking'
import { Link } from 'react-router-dom'

const quickLinks = [
  { title: 'Time Tracking', description: 'Review entries, reports, and payroll export.', href: '/admin/time' },
  { title: 'Schedule', description: 'Manage employee schedules and staffing coverage.', href: '/admin/schedule' },
  { title: 'Users', description: 'Manage staff accounts and kiosk PIN access.', href: '/admin/users' },
]

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-700">AIRE Ops</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Operations Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Monitor who is working right now, manage staff access, and keep time tracking organized for payroll.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {quickLinks.map((item) => (
          <Link key={item.href} to={item.href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md">
            <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.description}</p>
          </Link>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Who’s Working</h2>
          <p className="mt-1 text-sm text-slate-500">Live status for the current Guam workday.</p>
        </div>
        <WhosWorking />
      </section>
    </div>
  )
}
