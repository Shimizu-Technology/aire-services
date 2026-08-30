import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { SignedIn, UserButton } from '@clerk/clerk-react'
import {
  CalendarDays,
  Clock3,
  History,
  House,
  Image,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import KioskPinSetupModal from '../auth/KioskPinSetupModal'

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition group-hover:border-cyan-200 group-hover:text-cyan-700 group-focus-visible:border-cyan-200 group-focus-visible:text-cyan-700">
      <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
    </span>
  )
}

const employeeNavigation = [
  {
    name: 'My Dashboard',
    href: '/admin',
    icon: House,
  },
  {
    name: 'My Time',
    href: '/admin/time',
    icon: Clock3,
  },
  {
    name: 'Schedule',
    href: '/admin/schedule',
    icon: CalendarDays,
  },
]

const adminNavigation = [
  {
    name: 'Dashboard',
    href: '/admin',
    icon: House,
  },
  {
    name: 'Time & Payroll',
    href: '/admin/time',
    icon: Clock3,
  },
  {
    name: 'Schedule',
    href: '/admin/schedule',
    icon: CalendarDays,
  },
  {
    name: 'Users',
    href: '/admin/users',
    icon: UserRound,
  },
  {
    name: 'Media',
    href: '/admin/media',
    icon: Image,
  },
  {
    name: 'Activity History',
    href: '/admin/activity',
    icon: History,
  },
  {
    name: 'Settings',
    href: '/admin/settings',
    icon: Settings,
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

  const isActive = (href: string) => {
    if (href === '/admin') return location.pathname === '/admin'
    if (href === '/admin/time') return location.pathname.startsWith('/admin/time') || location.pathname.startsWith('/admin/payroll')
    return location.pathname.startsWith(href)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(desktopSidebarStorageKey, String(desktopCollapsed))
  }, [desktopCollapsed])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.08),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_100%)]">
      <div className="border-b border-slate-200/90 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-16 w-full max-w-[104rem] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen((v) => !v)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Toggle sidebar" aria-expanded={mobileOpen}>
              {mobileOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => setDesktopCollapsed((value) => !value)}
              className="hidden rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 lg:inline-flex"
              aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {desktopCollapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
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

      <div className="mx-auto flex w-full max-w-[104rem]">
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
                    <span className="hidden lg:inline-flex"><NavIcon icon={item.icon} /></span>
                    <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-lg transition duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 lg:block">
                      {item.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={isActive(item.href) ? 'text-cyan-700' : ''}><NavIcon icon={item.icon} /></span>
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
