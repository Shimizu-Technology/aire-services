import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { SignedIn, UserButton } from '@clerk/clerk-react'
import { useAuthContext } from '../../contexts/AuthContext'
import KioskPinSetupModal from '../auth/KioskPinSetupModal'

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition group-hover:border-cyan-200 group-hover:text-cyan-700 group-focus-visible:border-cyan-200 group-focus-visible:text-cyan-700">
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        {children}
      </svg>
    </span>
  )
}

const employeeNavigation = [
  {
    name: 'My Dashboard',
    href: '/admin',
    icon: (
      <NavIcon>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.75 10.5 12 4l8.25 6.5v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V10.5Z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 20.25v-6h6v6" />
      </NavIcon>
    ),
  },
  {
    name: 'My Time',
    href: '/admin/time',
    icon: (
      <NavIcon>
        <circle cx="12" cy="12" r="8.25" strokeWidth={1.8} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 7.5v4.75l3 1.75" />
      </NavIcon>
    ),
  },
  {
    name: 'Schedule',
    href: '/admin/schedule',
    icon: (
      <NavIcon>
        <rect x="4" y="5.5" width="16" height="14" rx="2.5" strokeWidth={1.8} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 3.75v3.5M16 3.75v3.5M4 9.25h16" />
      </NavIcon>
    ),
  },
]

const adminNavigation = [
  {
    name: 'Dashboard',
    href: '/admin',
    icon: (
      <NavIcon>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3.75 10.5 12 4l8.25 6.5v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V10.5Z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 20.25v-6h6v6" />
      </NavIcon>
    ),
  },
  {
    name: 'Time Tracking',
    href: '/admin/time',
    icon: (
      <NavIcon>
        <circle cx="12" cy="12" r="8.25" strokeWidth={1.8} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 7.5v4.75l3 1.75" />
      </NavIcon>
    ),
  },
  {
    name: 'Schedule',
    href: '/admin/schedule',
    icon: (
      <NavIcon>
        <rect x="4" y="5.5" width="16" height="14" rx="2.5" strokeWidth={1.8} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 3.75v3.5M16 3.75v3.5M4 9.25h16" />
      </NavIcon>
    ),
  },
  {
    name: 'Users',
    href: '/admin/users',
    icon: (
      <NavIcon>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.5 19.25v-1.5a3.5 3.5 0 0 0-3.5-3.5h-2a3.5 3.5 0 0 0-3.5 3.5v1.5" />
        <circle cx="12" cy="9" r="3.25" strokeWidth={1.8} />
      </NavIcon>
    ),
  },
  {
    name: 'Settings',
    href: '/admin/settings',
    icon: (
      <NavIcon>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3.75v2.1m0 12.3v2.1m8.25-8.25h-2.1m-12.3 0h-2.1m11.18-5.93-1.48 1.48M8.55 15.45l-1.48 1.48m0-10.86 1.48 1.48m5.9 5.9 1.48 1.48" />
        <circle cx="12" cy="12" r="3.2" strokeWidth={1.8} />
      </NavIcon>
    ),
  },
]

const desktopSidebarStorageKey = 'aire-admin-sidebar-collapsed'

export default function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(desktopSidebarStorageKey) === 'true'
  })
  const location = useLocation()
  const { userRole, isClerkEnabled, currentUser, refreshCurrentUser } = useAuthContext()

  const isAdmin = !isClerkEnabled || userRole === 'admin'
  const navigation = useMemo(() => {
    return isAdmin ? adminNavigation : employeeNavigation
  }, [isAdmin])
  const needsKioskPinSetup = Boolean(isClerkEnabled && currentUser?.needs_kiosk_pin_setup)

  const isActive = (href: string) => (href === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(href))

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(desktopSidebarStorageKey, String(desktopCollapsed))
  }, [desktopCollapsed])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.08),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_100%)]">
      <div className="border-b border-slate-200/90 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen((v) => !v)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Toggle sidebar" aria-expanded={mobileOpen}>
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
            </button>
            <button
              type="button"
              onClick={() => setDesktopCollapsed((value) => !value)}
              className="hidden rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 lg:inline-flex"
              aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={desktopCollapsed ? 'M13 5l7 7-7 7M4 5h5v14H4z' : 'M11 19l-7-7 7-7M15 5h5v14h-5z'} />
              </svg>
            </button>
            <div>
              <Link to="/admin" className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">AIRE Ops</Link>
              <p className="text-xs text-slate-400 lg:hidden">{isAdmin ? 'Admin dashboard' : 'Staff portal'}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 md:inline-flex">
              {isAdmin ? 'Admin workspace' : 'Staff workspace'}
            </div>
            <Link to="/kiosk" className="text-sm text-slate-500 hover:text-slate-900" target="_blank" rel="noopener noreferrer">Kiosk</Link>
            <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">View Site</Link>
            <SignedIn>
              <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
            </SignedIn>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl">
        {/* Backdrop overlay for mobile */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside className={`fixed top-16 bottom-0 left-0 z-40 border-r border-slate-200 bg-white/95 px-4 py-6 shadow-xl transition-all duration-300 lg:static lg:translate-x-0 lg:shadow-none ${desktopCollapsed ? 'w-72 lg:w-24' : 'w-72'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          <div className={`mb-6 ${desktopCollapsed ? 'px-0' : 'px-2'}`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.12em] text-slate-400 ${desktopCollapsed ? 'hidden lg:block lg:text-center' : ''}`}>
              {desktopCollapsed ? 'Nav' : isAdmin ? 'Admin Navigation' : 'Navigation'}
            </p>
          </div>
          <nav className="space-y-1">
            {navigation.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                aria-label={desktopCollapsed ? item.name : undefined}
                title={desktopCollapsed ? item.name : undefined}
                className={`group relative flex items-center rounded-xl px-4 py-3 text-sm font-medium transition ${desktopCollapsed ? 'justify-center lg:px-2' : 'gap-3'} ${isActive(item.href) ? 'bg-cyan-50 text-cyan-700 shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {desktopCollapsed ? (
                  <>
                    <span className="hidden lg:inline-flex">{item.icon}</span>
                    <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-lg transition duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 lg:block">
                      {item.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={isActive(item.href) ? 'text-cyan-700' : ''}>{item.icon}</span>
                    <span>{item.name}</span>
                  </>
                )}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
          <Outlet />
        </main>
      </div>

      <KioskPinSetupModal
        open={needsKioskPinSetup}
        userName={currentUser?.full_name ?? 'Team member'}
        onComplete={refreshCurrentUser}
      />
    </div>
  )
}
