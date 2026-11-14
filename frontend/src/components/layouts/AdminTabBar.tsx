import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import { Sheet } from '../ui'
import { cx } from '../../lib/cx'
import { useShellChrome } from './shellChrome'
import { approvalBadgeText, isNavItemActive, navItemLabel, type NavItem, type TabBarLayout } from './adminNavigation'

function TabIcon({ icon: Icon, badge }: { icon: LucideIcon; badge?: string }) {
  return (
    <span className="relative inline-flex">
      <Icon aria-hidden="true" className="size-6" strokeWidth={1.8} />
      {badge && (
        <span aria-hidden="true" className="absolute -right-2.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-bold leading-none text-white ring-2 ring-surface">
          {badge}
        </span>
      )}
    </span>
  )
}

const tabClass = (active: boolean) => cx(
  'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-control px-0 pb-1 pt-2 text-[13px] leading-4 font-semibold tracking-[-0.01em] transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
  active ? 'text-primary' : 'text-ink-muted hover:text-ink',
)

// Matches Tailwind's lg breakpoint, where the sidebar replaces the tab bar.
const DESKTOP_MIN_WIDTH = 1024

interface AdminTabBarProps {
  layout: TabBarLayout
  approvalCount: number
  /** True while a required dialog (kiosk PIN setup) is open: the bar is inert and More stays closed. */
  suspended?: boolean
  /** Called after More closes because the window grew to desktop width, so focus can move to the sidebar. */
  onDesktopDismiss?: () => void
}

/**
 * Phones and tablets: a bottom tab bar instead of the slide-over sidebar.
 * Sits above the home indicator (safe-area padding) and hides from lg up,
 * where the sidebar takes over. Overflow pages live in a "More" sheet.
 */
export default function AdminTabBar({ layout, approvalCount, suspended = false, onDesktopDismiss }: AdminTabBarProps) {
  const location = useLocation()
  const { selectionBarActive } = useShellChrome()
  const [moreOpen, setMoreOpen] = useState(false)
  const [wasSuspended, setWasSuspended] = useState(suspended)
  const dismissedForDesktop = useRef(false)
  const moreItems = layout.more.flatMap((group) => group.items)
  const moreActive = moreItems.some((navItem) => isNavItemActive(navItem, location.pathname, location.search))

  // Required PIN setup closes More; it doesn't reopen once the PIN is saved.
  if (suspended !== wasSuspended) {
    setWasSuspended(suspended)
    if (suspended) setMoreOpen(false)
  }

  // The sheet is portaled outside the lg:hidden bar, so close it when the
  // window grows to desktop width rather than leave it over the sidebar.
  useEffect(() => {
    if (!moreOpen) return
    const closeOnDesktop = () => {
      if (window.innerWidth < DESKTOP_MIN_WIDTH) return
      dismissedForDesktop.current = true
      setMoreOpen(false)
    }
    window.addEventListener('resize', closeOnDesktop)
    return () => window.removeEventListener('resize', closeOnDesktop)
  }, [moreOpen])

  // Runs after the sheet's own cleanup has returned focus to the hidden More
  // button, so the sidebar gets focus instead.
  useEffect(() => {
    if (moreOpen || !dismissedForDesktop.current) return
    dismissedForDesktop.current = false
    onDesktopDismiss?.()
  }, [moreOpen, onDesktopDismiss])

  const renderTab = (navItem: NavItem) => {
    const active = isNavItemActive(navItem, location.pathname, location.search)
    const badge = navItem.badge === 'approvals' && approvalCount > 0 ? approvalBadgeText(approvalCount) : undefined
    return (
      <li key={navItem.id} className="flex min-w-0 flex-1">
        <Link
          to={navItem.href}
          target={navItem.external ? '_blank' : undefined}
          rel={navItem.external ? 'noopener noreferrer' : undefined}
          aria-current={active ? 'page' : undefined}
          aria-label={navItemLabel(navItem, approvalCount)}
          className={tabClass(active)}
        >
          <TabIcon icon={navItem.icon} badge={badge} />
          <span className="max-w-full truncate">{navItem.shortName ?? navItem.name}</span>
        </Link>
      </li>
    )
  }

  return (
    <>
      {/* A SelectionBar takes this place while something is selected. */}
      <nav aria-label="Main tabs" inert={suspended} hidden={selectionBarActive} className="fixed inset-x-0 bottom-0 z-(--z-tabbar) border-t border-line bg-surface/95 pb-safe pl-safe pr-safe backdrop-blur supports-[backdrop-filter]:bg-surface/85 lg:hidden">
        <ul className="mx-auto flex max-w-xl items-stretch gap-1 px-2">
          {layout.tabs.map(renderTab)}
          {moreItems.length > 0 && (
            <li className="flex min-w-0 flex-1">
              <button
                type="button"
                onClick={() => { if (!suspended) setMoreOpen(true) }}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
                className={tabClass(moreActive)}
              >
                <TabIcon icon={Ellipsis} />
                <span>More</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Sheet open={moreOpen && !suspended} onClose={() => setMoreOpen(false)} title="More">
        <div className="space-y-5">
          {layout.more.map((group) => (
            <section key={group.id} aria-label={group.label ?? 'Pages'}>
              {group.label && <h3 className="mb-1 px-1 text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">{group.label}</h3>}
              <ul className="space-y-1">
                {group.items.map((navItem) => {
                  const active = isNavItemActive(navItem, location.pathname, location.search)
                  const Icon = navItem.icon
                  return (
                    <li key={navItem.id}>
                      <Link
                        to={navItem.href}
                        target={navItem.external ? '_blank' : undefined}
                        rel={navItem.external ? 'noopener noreferrer' : undefined}
                        onClick={() => setMoreOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        aria-label={navItemLabel(navItem, approvalCount)}
                        className={cx(
                          'flex min-h-12 items-center gap-3 rounded-control px-3 text-body font-medium transition-colors duration-150',
                          active ? 'bg-primary/5 text-primary' : 'text-ink hover:bg-surface-muted',
                        )}
                      >
                        <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1 truncate">{navItem.name}</span>
                        {navItem.badge === 'approvals' && approvalCount > 0 && (
                          <span aria-hidden="true" className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">{approvalBadgeText(approvalCount)}</span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>
    </>
  )
}
