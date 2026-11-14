import { parsePayPeriodStart, payPeriodContaining, type PayPeriod } from './payPeriods'
import { isIsoDate } from './payrollPeriods'

/** The person page's tabs. */
export type PersonTab = 'overview' | 'time' | 'pay' | 'access' | 'employment'

/** Tab keys from before the person page was rebuilt; links from Payroll, Activity and Cornerstone still send them. */
export type LegacyEmployeeTab = 'hours' | 'schedule' | 'activity' | 'setup'

export type EmployeeTab = PersonTab | LegacyEmployeeTab

export const PERSON_TABS: PersonTab[] = ['overview', 'time', 'pay', 'access', 'employment']

/**
 * Old keys mapped to today's. Cornerstone Payroll's evidence link sends
 * `?tab=hours&period=…&entry=…`, which lands on Time. Schedules are off, so a
 * schedule link opens Time too; Activity lives on Overview now.
 */
export const LEGACY_TAB_ALIASES: Record<LegacyEmployeeTab, PersonTab> = {
  hours: 'time',
  schedule: 'time',
  activity: 'overview',
  setup: 'access',
}

export function personTab(value: string | null | undefined): PersonTab {
  if (!value) return 'overview'
  if ((PERSON_TABS as string[]).includes(value)) return value as PersonTab
  return Object.prototype.hasOwnProperty.call(LEGACY_TAB_ALIASES, value) ? LEGACY_TAB_ALIASES[value as LegacyEmployeeTab] : 'overview'
}

/** A positive whole-number id from a link, or null. */
export const linkedId = (value: string | null | undefined) => (value && /^[1-9]\d*$/.test(value) ? Number(value) : null)

/**
 * The pay period a link to the Time tab asks for: `period` (Cornerstone sends
 * the period's first day), else the period holding `start_date` (Payroll's
 * links), else null so the page can use the linked shift's or this period.
 */
export function linkedTimePeriod(params: URLSearchParams): PayPeriod | null {
  const period = params.get('period')
  const parsed = parsePayPeriodStart(period) ?? (isIsoDate(period) ? payPeriodContaining(period) : null)
  if (parsed) return parsed
  const startDate = params.get('start_date')
  return isIsoDate(startDate) ? payPeriodContaining(startDate) : null
}

// True for the route itself or a page under it ("/admin/pay", "/admin/pay/42?x"),
// never for a sibling that only shares its prefix ("/admin/payroll").
export function isWithinRoute(path: string, route: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0]
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function safeAdminReturn(value: string | null | undefined): string {
  if (!value || !value.startsWith('/admin') || !/^\/admin(?:\/|\?|$)/.test(value) || (value.includes('\\') || Array.from(value).some((character) => character.charCodeAt(0) < 32))) return '/admin/users'
  const url = new URL(value, 'https://local.invalid')
  return url.origin === 'https://local.invalid' ? `${url.pathname}${url.search}${url.hash}` : '/admin/users'
}

export function employeeWorkspaceHref(id: number | string, options: { tab?: EmployeeTab; returnTo?: string; startDate?: string; endDate?: string; allHistory?: boolean; period?: string; entry?: string; cursor?: string; detailCursor?: string; sourceUserUuid?: string; sourceInstanceId?: string } = {}): string {
  if (!/^[1-9]\d*$/.test(String(id))) return '/admin/users'
  const query = new URLSearchParams()
  query.set('tab', personTab(options.tab))
  if (options.returnTo) query.set('return_to', safeAdminReturn(options.returnTo))
  if (options.startDate) query.set('start_date', options.startDate)
  if (options.endDate) query.set('end_date', options.endDate)
  // Without dates the person page opens on the current pay period.
  if (options.allHistory && !options.startDate && !options.endDate) query.set('range', 'all')
  if (options.period) query.set('period', options.period)
  if (options.entry) query.set('entry', options.entry)
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.detailCursor) query.set('detail_cursor', options.detailCursor)
  if (options.sourceUserUuid) query.set('source_user_uuid', options.sourceUserUuid)
  if (options.sourceInstanceId) query.set('source_instance_id', options.sourceInstanceId)
  // An Activity link scrolls to Recent activity on Overview.
  return `/admin/users/${id}?${query}${options.tab === 'activity' ? '#activity' : ''}`
}
