import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
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
  Send,
  Settings,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import type { Capabilities, Capability } from '../../lib/roles'
import { useCapabilities } from '../../lib/useCapabilities'
import { isWithinRoute } from '../../lib/employeeWorkspace'
import { lockDialogScroll } from '../../lib/useDialogFocus'
import KioskPinSetupModal from '../auth/KioskPinSetupModal'

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition group-hover:border-cyan-200 group-hover:text-cyan-700 group-focus-visible:border-cyan-200 group-focus-visible:text-cyan-700">
      <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
    </span>
  )
}

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
}

// Shown only when My Pay is on for the signed-in user.
const myPayNavigation: NavItem = {
  name: 'My Pay',
  href: '/admin/pay',
  icon: Wallet,
}

// Sending pay stubs: owners, admins and managers.
const payStubsNavigation: NavItem = {
  name: 'Pay stubs',
  href: '/admin/pay-stubs',
  icon: Send,
}

// Owner and admin areas, each shown only to roles with that capability.
const administrationNavigation: (NavItem & { capability: Capability })[] = [
  { name: 'Team', href: '/admin/users', icon: UserRound, capability: 'manage_users' },
  { name: 'Media', href: '/admin/media', icon: Image, capability: 'manage_site' },
  { name: 'Activity History', href: '/admin/activity', icon: History, capability: 'view_activity' },
  { name: 'Settings', href: '/admin/settings', icon: Settings, capability: 'manage_settings' },
]

// Employees see their own workspace; managers get the same short list pointed
// at the team (approvals and timecards); owners and admins get everything.
function navigationFor(capabilities: Capabilities, myPayEnabled: boolean): NavItem[] {
  const supervises = capabilities.manage_team_time
  const dashboard: NavItem = { name: supervises ? 'Dashboard' : 'My Dashboard', href: '/admin', icon: House }
  const time: NavItem = { name: supervises ? 'Time & Payroll' : 'My Time', href: '/admin/time', icon: Clock3 }
  const schedule: NavItem = { name: 'Schedule', href: '/admin/schedule', icon: CalendarDays }
  const administration = administrationNavigation.filter((item) => capabilities[item.capability])
  const myPay = myPayEnabled ? [myPayNavigation] : []
  const payStubs = capabilities.send_pay_statements ? [payStubsNavigation] : []

  if (administration.length > 0) return [dashboard, ...myPay, time, ...payStubs, schedule, ...administration]
  return [dashboard, time, ...payStubs, ...myPay, schedule]
}

const desktopSidebarStorageKey = 'aire-admin-sidebar-collapsed'

export default function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)
  const sidebarRef = useRef<HTMLElement>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement>(null)
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(desktopSidebarStorageKey) === 'true'
  })
  const location = useLocation()
  const { isClerkEnabled, currentUser, refreshCurrentUser } = useAuthContext()

  const capabilities = useCapabilities()
  const isAdmin = capabilities.manage_settings
  const workspaceLabel = isAdmin ? 'Admin' : capabilities.manage_team_time ? 'Manager' : 'Staff'
  const myPayEnabled = Boolean(currentUser?.my_pay_enabled)
  const navigation = useMemo(() => navigationFor(capabilities, myPayEnabled), [capabilities, myPayEnabled])
  const needsKioskPinSetup = Boolean(isClerkEnabled && currentUser?.needs_kiosk_pin_setup)
  // Required PIN setup takes precedence over the navigation dialog.
  const navigationOpen = mobileOpen && !needsKioskPinSetup
  const restoreNavigationFocus = useEffectEvent((sidebar: HTMLElement | null, trigger: HTMLButtonElement | null) => {
    if (needsKioskPinSetup) return
    if (window.innerWidth >= 1024) {
      if (document.activeElement === document.body) sidebar?.querySelector<HTMLElement>('a[href]')?.focus()
    } else {
      trigger?.focus()
    }
  })

  const isActive = (href: string) => {
    if (href === '/admin') return location.pathname === '/admin'
    if (href === '/admin/time') return location.pathname.startsWith('/admin/time') || location.pathname.startsWith('/admin/payroll')
    // My Pay preview is opened from Team, so Team stays highlighted.
    if (href === '/admin/users') return isWithinRoute(location.pathname, href) || isWithinRoute(location.pathname, '/admin/pay-preview')
    return isWithinRoute(location.pathname, href)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(desktopSidebarStorageKey, String(desktopCollapsed))
  }, [desktopCollapsed])

  useEffect(() => {
    const updateViewport = () => {
      const desktop = window.innerWidth >= 1024
      setIsDesktop(desktop)
      if (desktop) setMobileOpen(false)
    }
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    if (!navigationOpen || isDesktop) return
    const sidebar = sidebarRef.current
    const trigger = mobileTriggerRef.current
    const unlockScroll = lockDialogScroll()
    const focusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
    focusable()[0]?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileOpen(false)
      } else if (event.key === 'Tab') {
        const items = focusable()
        const first = items[0]
        const last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      unlockScroll()
      restoreNavigationFocus(sidebar, trigger)
    }
  }, [navigationOpen, isDesktop])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.08),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_100%)]">
      <div inert={navigationOpen && !isDesktop} className="border-b border-slate-200/90 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-16 w-full max-w-[104rem] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button ref={mobileTriggerRef} onClick={() => setMobileOpen((v) => !v)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Toggle sidebar" aria-expanded={navigationOpen}>
              {navigationOpen ? <X className="h-6 w-6" aria-hidden="true" /> : <Menu className="h-6 w-6" aria-hidden="true" />}
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
              <p className="text-xs text-slate-500 lg:hidden">{isAdmin ? 'Admin dashboard' : `${workspaceLabel} portal`}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 md:inline-flex">
              {`${workspaceLabel} workspace`}
            </div>
            <Link to="/kiosk" className="text-sm text-slate-500 hover:text-slate-900" target="_blank" rel="noopener noreferrer">Kiosk</Link>
            <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">View Site</Link>
            {isClerkEnabled && (
              <SignedIn>
                <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
              </SignedIn>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[104rem]">
        {/* Backdrop overlay for mobile */}
        {navigationOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/30 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside ref={sidebarRef} role={!isDesktop && navigationOpen ? 'dialog' : undefined} aria-modal={!isDesktop && navigationOpen ? true : undefined} aria-label="Navigation" aria-hidden={!isDesktop && !navigationOpen ? true : undefined} inert={!isDesktop && !navigationOpen} className={`fixed top-16 bottom-0 left-0 z-40 overflow-y-auto border-r border-slate-200 bg-white px-4 py-6 shadow-xl transition-all duration-300 motion-reduce:transition-none lg:static lg:translate-x-0 lg:overflow-visible lg:shadow-none ${desktopCollapsed ? 'w-72 lg:w-24' : 'w-72'} ${navigationOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
          {!isDesktop && <button type="button" onClick={() => setMobileOpen(false)} className="mb-4 flex min-h-11 items-center gap-2 text-slate-700 lg:hidden" aria-label="Close navigation"><X className="h-5 w-5" aria-hidden="true" />Close</button>}
          <div className={`mb-6 ${desktopCollapsed ? 'px-0' : 'px-2'}`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 ${desktopCollapsed ? 'hidden lg:block lg:text-center' : ''}`}>
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
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`group relative flex items-center rounded-xl px-4 py-3 text-sm font-medium transition ${desktopCollapsed ? 'gap-3 lg:justify-center lg:gap-0 lg:px-2' : 'gap-3'} ${isActive(item.href) ? 'bg-cyan-50 text-cyan-700 shadow-sm' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {desktopCollapsed ? (
                  <>
                    <span className="inline-flex"><NavIcon icon={item.icon} /></span>
                    <span className="lg:hidden">{item.name}</span>
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

        <main inert={navigationOpen && !isDesktop} className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
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
