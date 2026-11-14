import {
  CalendarDays,
  CalendarPlus,
  ChartNoAxesColumnIncreasing,
  CircleCheckBig,
  CircleHelp,
  Clock3,
  Globe,
  History,
  House,
  KeyRound,
  ListChecks,
  ReceiptText,
  Send,
  Settings,
  Timer,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { ADMIN_PATHS } from '../../lib/adminRoutes'
import { isWithinRoute } from '../../lib/employeeWorkspace'
import type { Capabilities } from '../../lib/roles'

export interface NavItem {
  id: string
  name: string
  /** Shorter label for the phone tab bar. */
  shortName?: string
  href: string
  icon: LucideIcon
  /** Other routes that keep this item highlighted. */
  alsoActiveOn?: string[]
  /** Opens outside the admin shell (the shared kiosk), in a new tab. */
  external?: boolean
  badge?: 'approvals'
  /** On phones, always under More rather than taking a tab. */
  moreOnly?: boolean
}

export interface NavGroup {
  id: 'main' | 'admin' | 'me'
  /** Shown above the group; the first group has none. */
  label?: string
  items: NavItem[]
}

export interface NavigationOptions {
  capabilities: Capabilities
  /** The signed-in person's My Pay is on. */
  myPayEnabled: boolean
  /** "Use schedules" is on in Settings. */
  schedulesEnabled: boolean
  /** The signed-in person clocks in (users.time_tracking_enabled). */
  tracksTime: boolean
}

const item = {
  today: { id: 'today', name: 'Today', href: ADMIN_PATHS.today, icon: House },
  approvals: { id: 'approvals', name: 'Approvals', href: ADMIN_PATHS.approvals, icon: CircleCheckBig, badge: 'approvals', alsoActiveOn: [ADMIN_PATHS.leave] },
  timecards: { id: 'timecards', name: 'Timecards', href: ADMIN_PATHS.timecards, icon: ListChecks },
  payroll: { id: 'payroll', name: 'Payroll', href: ADMIN_PATHS.payroll, icon: ReceiptText, alsoActiveOn: ['/admin/payroll-link'] },
  // My Pay previews are opened from Team, so Team stays highlighted.
  team: { id: 'team', name: 'Team', href: ADMIN_PATHS.team, icon: UserRound, alsoActiveOn: ['/admin/pay-preview'] },
  reports: { id: 'reports', name: 'Reports', href: ADMIN_PATHS.reports, icon: ChartNoAxesColumnIncreasing },
  payStubs: { id: 'pay-stubs', name: 'Pay stubs', href: ADMIN_PATHS.payStubs, icon: Send },
  schedule: { id: 'schedule', name: 'Schedule', href: ADMIN_PATHS.schedule, icon: CalendarDays },
  settings: { id: 'settings', name: 'Settings', href: ADMIN_PATHS.settings, icon: Settings },
  website: { id: 'website', name: 'Website', href: ADMIN_PATHS.website, icon: Globe },
  activity: { id: 'activity', name: 'Activity', href: ADMIN_PATHS.activity, icon: History },
  myTime: { id: 'my-time', name: 'My Time', href: ADMIN_PATHS.myTime, icon: Clock3 },
  clock: { id: 'my-time', name: 'Clock', href: ADMIN_PATHS.myTime, icon: Clock3 },
  myHours: { id: 'my-hours', name: 'My Hours', shortName: 'Hours', href: ADMIN_PATHS.myHours, icon: Timer },
  leave: { id: 'leave', name: 'Leave', href: ADMIN_PATHS.leave, icon: CalendarPlus },
  myPay: { id: 'my-pay', name: 'My Pay', href: ADMIN_PATHS.myPay, icon: Wallet },
  kiosk: { id: 'kiosk', name: 'Unlock kiosk', shortName: 'Kiosk', href: '/kiosk', icon: KeyRound, external: true },
  // Managers' and employees' read-only Roles & access view. Owners and admins
  // open the full page from Settings.
  whatCanIDo: { id: 'what-can-i-do', name: 'What can I do?', href: ADMIN_PATHS.rolesAccess, icon: CircleHelp, moreOnly: true },
} satisfies Record<string, NavItem>

const when = <T,>(condition: boolean, value: T): T[] => (condition ? [value] : [])

/**
 * The sidebar, grouped by job (audit §6). Owners and admins: the week's work,
 * then admin pages, then their own time. Managers: the team's time, then
 * theirs. Employees: their own time only. Managers and employees end with
 * "What can I do?". Schedule appears only when "Use schedules" is on.
 */
export function navigationGroups({ capabilities, myPayEnabled, schedulesEnabled, tracksTime }: NavigationOptions): NavGroup[] {
  const groups: NavGroup[] = []
  const supervises = capabilities.manage_team_time

  if (capabilities.manage_settings) {
    groups.push({
      id: 'main',
      items: [
        item.today,
        item.approvals,
        item.timecards,
        // Admins edit schedules, so it sits with Timecards rather than under Me.
        ...when(schedulesEnabled && capabilities.manage_schedules, item.schedule),
        ...when(capabilities.manage_payroll, item.payroll),
        ...when(capabilities.manage_users, item.team),
        item.reports,
        ...when(capabilities.send_pay_statements, item.payStubs),
      ],
    })
    groups.push({
      id: 'admin',
      label: 'Admin',
      items: [
        item.settings,
        ...when(capabilities.manage_site, item.website),
        ...when(capabilities.view_activity, item.activity),
      ],
    })
    groups.push({
      id: 'me',
      label: 'Me',
      items: [...when(tracksTime, item.myTime), ...when(myPayEnabled, item.myPay), ...when(capabilities.unlock_kiosk, item.kiosk)],
    })
  } else if (supervises) {
    groups.push({
      id: 'main',
      items: [
        ...when(capabilities.approve_time, item.approvals),
        item.timecards,
        ...when(capabilities.export_hours_reports, item.reports),
        ...when(capabilities.send_pay_statements, item.payStubs),
      ],
    })
    groups.push({
      id: 'me',
      label: 'Me',
      items: [
        ...when(tracksTime, item.myTime),
        ...when(myPayEnabled, item.myPay),
        ...when(schedulesEnabled, item.schedule),
        ...when(capabilities.unlock_kiosk, item.kiosk),
        item.whatCanIDo,
      ],
    })
  } else {
    groups.push({
      id: 'main',
      items: [item.clock, item.myHours, item.leave, ...when(myPayEnabled, item.myPay), ...when(schedulesEnabled, item.schedule)],
    })
  }

  return groups.filter((group) => group.items.length > 0)
}

export interface TabBarLayout {
  tabs: NavItem[]
  /** Everything else, grouped like the sidebar, behind a "More" tab. Empty when it all fits. */
  more: NavGroup[]
}

const MAX_TABS = 5

/**
 * The phone tab bar: the role's daily pages first, the rest in a "More" sheet.
 * Managers get Approvals, Timecards, Reports and My Time; employees their
 * clock, hours, leave and pay; owners and admins Today, Approvals, Timecards
 * and Payroll. If only one page is left over it takes the fifth slot instead
 * of a "More" tab. "More only" pages (What can I do?) never take a tab, so
 * they keep the More tab; other pages fill the free slots before it.
 */
export function tabBarLayout(options: NavigationOptions): TabBarLayout {
  const groups = navigationGroups(options)
  const all = groups.flatMap((group) => group.items)
  const preferred = options.capabilities.manage_settings
    ? ['today', 'approvals', 'timecards', 'payroll']
    : options.capabilities.manage_team_time
      ? ['approvals', 'timecards', 'reports', 'my-time']
      : ['my-time', 'my-hours', 'leave', 'my-pay']
  const tabs = preferred.flatMap((id) => all.filter((candidate) => candidate.id === id)).slice(0, MAX_TABS - 1)
  let rest = all.filter((candidate) => !tabs.includes(candidate))

  if (rest.some((candidate) => candidate.moreOnly)) {
    const promotable = rest.filter((candidate) => !candidate.moreOnly)
    if (tabs.length + promotable.length <= MAX_TABS - 1) {
      tabs.push(...promotable)
      rest = rest.filter((candidate) => candidate.moreOnly)
    }
  } else {
    if (rest.length === 0) return { tabs, more: [] }
    if (rest.length === 1 && tabs.length < MAX_TABS) return { tabs: [...tabs, rest[0]], more: [] }
    if (tabs.length + rest.length <= MAX_TABS) return { tabs: [...tabs, ...rest], more: [] }
  }

  const more = groups
    .map((group) => ({ ...group, items: group.items.filter((candidate) => rest.includes(candidate)) }))
    .filter((group) => group.items.length > 0)
  return { tabs, more }
}

/** True when the current path belongs to this nav item. Today matches only /admin itself. */
export function isNavItemActive(navItem: NavItem, pathname: string) {
  if (navItem.external) return false
  if (navItem.href === ADMIN_PATHS.today) return pathname === ADMIN_PATHS.today || pathname === `${ADMIN_PATHS.today}/`
  return [navItem.href, ...(navItem.alsoActiveOn ?? [])].some((href) => isWithinRoute(pathname, href))
}

export function approvalBadgeText(count: number) {
  return count > 99 ? '99+' : String(count)
}

/** "Approvals, 12 waiting" for screen readers; the plain name otherwise. */
export function navItemLabel(navItem: NavItem, approvalCount: number) {
  if (navItem.badge === 'approvals' && approvalCount > 0) return `${navItem.name}, ${approvalCount} waiting`
  return navItem.external ? `${navItem.name} (opens in a new tab)` : navItem.name
}
