import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { SignedIn } from '@clerk/clerk-react'
import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { useCapabilities } from '../../lib/useCapabilities'
import { startVisibilityAwarePolling } from '../../lib/visibilityPolling'
import KioskPinSetupModal from '../auth/KioskPinSetupModal'
import { ToastProvider } from '../ui'
import AdminTabBar from './AdminTabBar'
import { AccountButton } from './Header'
import { ShellChromeProvider } from './ShellChromeContext'
import { approvalBadgeText, isNavItemActive, navItemLabel, navigationGroups, tabBarLayout, type NavigationOptions } from './adminNavigation'

function NavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition group-hover:border-primary/25 group-hover:text-primary group-focus-visible:border-primary/25 group-focus-visible:text-primary group-aria-[current=page]:border-primary/25 group-aria-[current=page]:text-primary">
      <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
    </span>
  )
}

const desktopSidebarStorageKey = 'aire-admin-sidebar-collapsed'
const APPROVAL_BADGE_REFRESH_MS = 60_000

/** Items waiting on the signed-in supervisor, for the Approvals badge. Refreshed on navigation and every minute. */
function usePendingApprovalCount(enabled: boolean) {
  const [count, setCount] = useState(0)
  const location = useLocation()

  useEffect(() => {
    if (!enabled) return
    let active = true
    const load = async () => {
      const response = await api.getPendingApprovals({ page: 1, per_page: 1 })
      if (active && response.data) setCount(response.data.summary?.entry_count ?? 0)
    }
    void load().catch(() => undefined)
    const stop = startVisibilityAwarePolling(load, APPROVAL_BADGE_REFRESH_MS)
    return () => { active = false; stop() }
  }, [enabled, location.pathname])

  return enabled ? count : 0
}

// Toasts and the selection bar need the shell around every admin page.
export default function AdminLayout() {
  return (
    <ShellChromeProvider>
      <ToastProvider>
        <AdminShell />
      </ToastProvider>
    </ShellChromeProvider>
  )
}

function AdminShell() {
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(desktopSidebarStorageKey) === 'true'
  })
  const location = useLocation()
  const { isClerkEnabled, currentUser, refreshCurrentUser } = useAuthContext()

  const capabilities = useCapabilities()
  const isAdmin = capabilities.manage_settings
  const workspaceLabel = isAdmin ? 'Admin' : capabilities.manage_team_time ? 'Manager' : 'Staff'
  const navigationOptions: NavigationOptions = useMemo(() => ({
    capabilities,
    myPayEnabled: Boolean(currentUser?.my_pay_enabled),
    schedulesEnabled: Boolean(currentUser?.schedules_enabled),
    // Local development without Clerk has no signed-in record; show the full workspace.
    tracksTime: currentUser ? currentUser.time_tracking_enabled !== false : !isClerkEnabled,
  }), [capabilities, currentUser, isClerkEnabled])
  const groups = useMemo(() => navigationGroups(navigationOptions), [navigationOptions])
  const tabBar = useMemo(() => tabBarLayout(navigationOptions), [navigationOptions])
  const approvalCount = usePendingApprovalCount(capabilities.approve_time)
  const needsKioskPinSetup = Boolean(isClerkEnabled && currentUser?.needs_kiosk_pin_setup)
  const sidebarRef = useRef<HTMLElement>(null)
  // After the phone "More" sheet closes on a resize to desktop, continue from the current page's sidebar link.
  const focusSidebar = useCallback(() => {
    const sidebar = sidebarRef.current
    ;(sidebar?.querySelector<HTMLElement>('a[aria-current="page"]') ?? sidebar?.querySelector<HTMLElement>('a[href]'))?.focus()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(desktopSidebarStorageKey, String(desktopCollapsed))
  }, [desktopCollapsed])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(6,182,212,0.08),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#f3f4f6_100%)]">
      <div className="border-b border-slate-200/90 bg-white/95 pt-safe backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-16 w-full max-w-[104rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDesktopCollapsed((value) => !value)}
              className="hidden rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 lg:inline-flex"
              aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {desktopCollapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
            </button>
            <div className="min-w-0">
              <Link to="/admin" className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">AIRE Ops</Link>
              <p className="text-xs text-slate-500 lg:hidden">{`${workspaceLabel} workspace`}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 lg:inline-flex">
              {`${workspaceLabel} workspace`}
            </div>
            <Link to="/" className="inline-flex min-h-11 items-center text-sm text-slate-500 hover:text-slate-900">View site</Link>
            {isClerkEnabled && (
              <SignedIn>
                <AccountButton />
              </SignedIn>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[104rem]">
        <div className={`hidden shrink-0 border-r border-slate-200 bg-white px-4 py-6 lg:block ${desktopCollapsed ? 'w-24' : 'w-72'}`}>
          <nav ref={sidebarRef} aria-label="Main" className="space-y-6">
            {groups.map((group) => (
              <div key={group.id} role="group" aria-label={group.label ?? 'Workspace'}>
                {group.label && (
                  <p aria-hidden="true" className={`mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 ${desktopCollapsed ? 'text-center' : 'px-4'}`}>
                    {group.label}
                  </p>
                )}
                <ul className="space-y-1">
                  {group.items.map((navItem) => {
                    const active = isNavItemActive(navItem, location.pathname)
                    const showBadge = navItem.badge === 'approvals' && approvalCount > 0
                    return (
                      <li key={navItem.id}>
                        <Link
                          to={navItem.href}
                          target={navItem.external ? '_blank' : undefined}
                          rel={navItem.external ? 'noopener noreferrer' : undefined}
                          aria-label={navItemLabel(navItem, approvalCount)}
                          title={desktopCollapsed ? navItem.name : undefined}
                          aria-current={active ? 'page' : undefined}
                          className={`group relative flex items-center rounded-xl py-3 text-sm transition ${desktopCollapsed ? 'justify-center px-2' : 'gap-3 px-4'} ${active ? 'bg-primary/[0.07] font-semibold text-primary shadow-[inset_3px_0_0_var(--color-primary)]' : 'font-medium text-slate-700 hover:bg-slate-100'}`}
                        >
                          <span className="relative inline-flex">
                            <NavIcon icon={navItem.icon} />
                            {showBadge && desktopCollapsed && (
                              <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-bold leading-none text-white ring-2 ring-white">
                                {approvalBadgeText(approvalCount)}
                              </span>
                            )}
                          </span>
                          {desktopCollapsed ? (
                            <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-lg transition duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                              {navItem.name}
                            </span>
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate">{navItem.name}</span>
                              {showBadge && (
                                <span aria-hidden="true" className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-1.5 text-xs font-bold text-amber-800">
                                  {approvalBadgeText(approvalCount)}
                                </span>
                              )}
                            </>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Room for the phone tab bar and the home indicator below the last row. */}
        <main className="min-w-0 flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-6 sm:px-6 lg:px-8 lg:pb-8 xl:py-8">
          <Outlet />
        </main>
      </div>

      <AdminTabBar layout={tabBar} approvalCount={approvalCount} suspended={needsKioskPinSetup} onDesktopDismiss={focusSidebar} />

      <KioskPinSetupModal
        open={needsKioskPinSetup}
        userName={currentUser?.full_name ?? 'Team member'}
        onComplete={refreshCurrentUser}
      />
    </div>
  )
}
