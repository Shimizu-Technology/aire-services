import { ADMIN_PATHS } from './adminRoutes'
import { capabilitiesFor } from './roles'

/** Where a signed-in person with this role does their work, and what to call the button. */
export function workAreaFor(role: Parameters<typeof capabilitiesFor>[0] | null | undefined) {
  if (!role) return null
  const capabilities = capabilitiesFor(role)
  if (capabilities.manage_settings) return { href: ADMIN_PATHS.today, label: 'Back to Today' }
  if (capabilities.approve_time) return { href: ADMIN_PATHS.approvals, label: 'Back to Approvals' }
  if (capabilities.manage_team_time) return { href: ADMIN_PATHS.timecards, label: 'Open Timecards' }
  return { href: ADMIN_PATHS.myTime, label: 'Open My Time' }
}
