import type { AdminUser } from '../../lib/api'
import { roleLabel } from '../../lib/roles'
import type { StatusTone } from '../ui'

// Words about a person shared by the Team list and the person page.

export const personName = (user: Pick<AdminUser, 'full_name' | 'display_name' | 'email'>) =>
  user.full_name?.trim() || user.display_name?.trim() || user.email || 'Unnamed person'

export const firstName = (user: Pick<AdminUser, 'first_name' | 'full_name' | 'display_name' | 'email'>) =>
  user.first_name?.trim() || personName(user).split(/\s+/)[0]

export const departments = (user: Pick<AdminUser, 'approval_group_labels' | 'approval_group_label'>) =>
  user.approval_group_labels?.length ? user.approval_group_labels.join(', ') : user.approval_group_label || ''

export const isKioskLocked = (user: Pick<AdminUser, 'kiosk_locked_until'>, now = Date.now()) => {
  if (!user.kiosk_locked_until) return false
  const lockedUntil = new Date(user.kiosk_locked_until).getTime()
  return Number.isFinite(lockedUntil) && lockedUntil > now
}

export const hasEnded = (user: Pick<AdminUser, 'employment_status'>) =>
  user.employment_status === 'terminated' || user.employment_status === 'inactive'

/** "Employee · Ops/Maint · kiosk only" */
export function teamLine(user: AdminUser) {
  return [roleLabel(user.role), departments(user), user.personal_access_enabled ? null : 'kiosk only'].filter(Boolean).join(' · ')
}

/** "Certified Flight Instructor · CFI · Employee" */
export function headerLine(user: AdminUser) {
  return [user.staff_title?.trim(), departments(user), roleLabel(user.role)].filter(Boolean).join(' · ')
}

export const signInLabel = (user: Pick<AdminUser, 'personal_access_enabled' | 'time_tracking_enabled'>) =>
  user.personal_access_enabled ? 'Personal sign-in' : user.time_tracking_enabled ? 'Kiosk only' : 'No sign-in'

/** The one state on a Team row that someone acts on, if any. */
export function teamState(user: AdminUser, onTheClock: boolean): { label: string; tone: StatusTone } | null {
  if (user.employment_status === 'terminated') return { label: 'Ended', tone: 'off' }
  if (user.employment_status === 'inactive') return { label: 'Inactive', tone: 'off' }
  if (onTheClock) return { label: 'On the clock', tone: 'approved' }
  if (user.kiosk_enabled && isKioskLocked(user)) return { label: 'PIN locked', tone: 'needs-fix' }
  if (!user.email) return { label: 'No email', tone: 'waiting' }
  return null
}

/** The person page's status pill. */
export function employmentPill(user: AdminUser): { label: string; tone: StatusTone } {
  if (user.employment_status === 'terminated') return { label: 'Ended', tone: 'off' }
  if (user.employment_status === 'inactive') return { label: 'Inactive', tone: 'off' }
  // An invited person who hasn't signed in yet; kiosk-only people are never pending.
  if (user.is_pending) return { label: "Hasn't signed in yet", tone: 'waiting' }
  return { label: 'Active', tone: 'approved' }
}
