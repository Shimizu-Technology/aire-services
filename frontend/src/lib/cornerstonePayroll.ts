import { isStaging, stagingNavigationUrl } from './staging'

/** Where Cornerstone Payroll starts the AIRE connection. Verified in Cornerstone's
 *  router and sidebar: "Time tracking account" under its settings. */
export const CORNERSTONE_CONNECTION_PATH = '/app/aire-account-connection'

/**
 * Link to Cornerstone Payroll's connection screen, or null when this build doesn't
 * know where Cornerstone lives. AIRE cannot start the connection itself: Cornerstone
 * creates the one-time link and sends the person here with it.
 */
export function cornerstoneConnectionUrl(): string | null {
  const configured = isStaging
    ? import.meta.env.VITE_STAGING_PAYROLL_FRONTEND_ORIGIN
    : import.meta.env.VITE_CORNERSTONE_PAYROLL_URL
  if (!configured) return null
  try {
    const origin = new URL(configured)
    const local = ['localhost', '127.0.0.1'].includes(origin.hostname)
    if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) return null
    const url = `${origin.origin}${CORNERSTONE_CONNECTION_PATH}`
    return isStaging ? stagingNavigationUrl(url) : url
  } catch {
    return null
  }
}
