import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { SignedIn, UserButton } from '@clerk/clerk-react'
import Seo from '../seo/Seo'

const navigation = [
  { name: 'Dashboard', href: '/admin' },
  { name: 'Time Tracking', href: '/admin/time' },
  { name: 'Reports', href: '/admin/reports' },
  { name: 'Schedule', href: '/admin/schedule' },
  { name: 'Users', href: '/admin/users' },
  { name: 'Settings', href: '/admin/settings' },
]

export default function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const reportsActive = location.pathname.startsWith('/admin/time') && new URLSearchParams(location.search).get('tab') === 'reports'
  const isActive = (href: string) => {
    if (href === '/admin') return location.pathname === '/admin'
    if (href === '/admin/reports') return reportsActive
    if (href === '/admin/time') return location.pathname.startsWith('/admin/time') && !reportsActive
    return location.pathname.startsWith(href)
  }
  let pageTitle = 'AIRE Admin Dashboard'
  if (reportsActive) pageTitle = 'Reports | AIRE Admin'
  else if (location.pathname.startsWith('/admin/time')) pageTitle = 'Time Tracking | AIRE Admin'
  else if (location.pathname.startsWith('/admin/schedule')) pageTitle = 'Schedule | AIRE Admin'
  else if (location.pathname.startsWith('/admin/users')) pageTitle = 'Users | AIRE Admin'
  else if (location.pathname.startsWith('/admin/settings')) pageTitle = 'Settings | AIRE Admin'

  return (
    <div className="min-h-screen bg-slate-50">
      <Seo
        title={pageTitle}
        description="Private admin and operations dashboard for AIRE Services Guam staff."
        path={location.pathname}
        robots="noindex,nofollow"
      />

      <div className="border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setMobileOpen((v) => !v)} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Toggle sidebar">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
            </button>
            <Link to="/admin" className="min-w-0">
              <div className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">AIRE Ops</div>
              <div className="mt-1 truncate text-sm font-semibold leading-none text-slate-900">Staff dashboard</div>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900">View Site</Link>
            <SignedIn>
              <div className="flex items-center justify-center">
                <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
              </div>
            </SignedIn>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl">
        <aside className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-slate-200 bg-white px-4 py-6 transition-transform lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <div className="mb-6 px-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Admin Navigation</p>
          </div>
          <nav className="space-y-2">
            {navigation.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-xl px-4 py-3 text-sm font-medium transition ${isActive(item.href) ? 'bg-cyan-50 text-cyan-700' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
