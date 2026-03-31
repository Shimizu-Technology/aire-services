import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { SignedIn, UserButton } from '@clerk/clerk-react'

const navigation = [
  { name: 'Dashboard', href: '/admin' },
  { name: 'Time Tracking', href: '/admin/time' },
  { name: 'Schedule', href: '/admin/schedule' },
  { name: 'Users', href: '/admin/users' },
]

export default function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const isActive = (href: string) => (href === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(href))

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen((v) => !v)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Toggle sidebar">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
            </button>
            <Link to="/admin" className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">AIRE Ops</Link>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">View Site</Link>
            <SignedIn>
              <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
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
