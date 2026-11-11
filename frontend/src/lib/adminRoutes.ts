import type { Capabilities } from './roles'

// One place for the admin URLs that the old "Time & Payroll" tabs became.
// Old links (emails, bookmarks, Cornerstone Payroll) still use /admin/time
// and /admin/media; legacyAdminRedirect maps them here.
export const ADMIN_PATHS = {
  today: '/admin',
  approvals: '/admin/approvals',
  timecards: '/admin/timecards',
  reports: '/admin/reports',
  leave: '/admin/leave',
  payroll: '/admin/payroll',
  myTime: '/admin/my-time',
  myHours: '/admin/my-hours',
  myPay: '/admin/pay',
  payStubs: '/admin/pay-stubs',
  schedule: '/admin/schedule',
  team: '/admin/users',
  settings: '/admin/settings',
  website: '/admin/website',
  websiteMedia: '/admin/website/media',
  websiteContact: '/admin/website/contact',
  activity: '/admin/activity',
} as const

export type TimeSection = 'entries' | 'approvals' | 'reports' | 'leave'

type SearchInit = URLSearchParams | Record<string, string> | string

function withSearch(path: string, search?: SearchInit) {
  const query = new URLSearchParams(search).toString()
  return query ? `${path}?${query}` : path
}

/** Where a time section lives now. Team time goes to Timecards; your own to My Hours. */
export function timeSectionPath(section: TimeSection, { supervises = true }: { supervises?: boolean } = {}) {
  if (section === 'approvals') return ADMIN_PATHS.approvals
  if (section === 'reports') return ADMIN_PATHS.reports
  if (section === 'leave') return ADMIN_PATHS.leave
  return supervises ? ADMIN_PATHS.timecards : ADMIN_PATHS.myHours
}

export function timeSectionHref(section: TimeSection, search?: SearchInit, options?: { supervises?: boolean }) {
  return withSearch(timeSectionPath(section, options), search)
}

/** The first page after sign-in: owners and admins get Today, managers Approvals, employees My Time. */
export function landingPathFor(capabilities: Capabilities) {
  if (capabilities.manage_settings) return ADMIN_PATHS.today
  if (capabilities.manage_team_time) return ADMIN_PATHS.approvals
  return ADMIN_PATHS.myTime
}

/**
 * The new URL for an old /admin/time?tab=… link, keeping every other query
 * parameter (dates, entry_id, user_id, view, filters) and the hash.
 * Approvals and reports were never open to employees, so their old links
 * land on My Hours instead of an access-denied page.
 */
export function legacyTimeRedirect(search: string, hash: string, capabilities: Capabilities) {
  const params = new URLSearchParams(search)
  const tab = params.get('tab')
  params.delete('tab')
  const supervises = capabilities.manage_team_time
  const section: TimeSection = tab === 'approvals' && capabilities.approve_time
    ? 'approvals'
    : tab === 'reports' && capabilities.export_hours_reports
      ? 'reports'
      : tab === 'leave' ? 'leave' : 'entries'
  return `${timeSectionHref(section, params, { supervises })}${hash}`
}
