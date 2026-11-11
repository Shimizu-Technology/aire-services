import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import { Sheet } from '../ui'
import { cx } from '../../lib/cx'
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
  'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-control px-1 pb-1 pt-2 text-xs font-semibold transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
  active ? 'text-primary' : 'text-ink-muted hover:text-ink',
)

/**
 * Phones and tablets: a bottom tab bar instead of the slide-over sidebar.
 * Sits above the home indicator (safe-area padding) and hides from lg up,
 * where the sidebar takes over. Overflow pages live in a "More" sheet.
 */
export default function AdminTabBar({ layout, approvalCount }: { layout: TabBarLayout; approvalCount: number }) {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreItems = layout.more.flatMap((group) => group.items)
  const moreActive = moreItems.some((navItem) => isNavItemActive(navItem, location.pathname))

  const renderTab = (navItem: NavItem) => {
    const active = isNavItemActive(navItem, location.pathname)
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
      <nav aria-label="Main tabs" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-safe pl-safe pr-safe backdrop-blur supports-[backdrop-filter]:bg-surface/85 lg:hidden">
        <ul className="mx-auto flex max-w-xl items-stretch gap-1 px-2">
          {layout.tabs.map(renderTab)}
          {moreItems.length > 0 && (
            <li className="flex min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
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

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="space-y-5">
          {layout.more.map((group) => (
            <section key={group.id} aria-label={group.label ?? 'Pages'}>
              {group.label && <h3 className="mb-1 px-1 text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">{group.label}</h3>}
              <ul className="space-y-1">
                {group.items.map((navItem) => {
                  const active = isNavItemActive(navItem, location.pathname)
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
