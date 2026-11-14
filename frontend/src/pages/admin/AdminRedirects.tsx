import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { landingPathFor, legacyTimeRedirect } from '../../lib/adminRoutes'
import { useCapabilities } from '../../lib/useCapabilities'

/** /admin: Today for owners and admins; managers go to Approvals, employees to My Time. */
export function AdminLanding({ children }: { children: ReactNode }) {
  const capabilities = useCapabilities()
  const location = useLocation()
  const landing = landingPathFor(capabilities)
  if (landing === '/admin') return <>{children}</>
  return (
    <Navigate
      replace
      to={`${landing}${location.search}${location.hash}`}
      state={location.state}
    />
  )
}

/**
 * /admin/time and its ?tab= links, which the cutoff reminder email, older
 * bookmarks and "Fix clock-out" links use. Replaces the history entry, so
 * Back goes to the page before the old link rather than bouncing here.
 */
export function LegacyTimeRedirect() {
  const capabilities = useCapabilities()
  const location = useLocation()
  return (
    <Navigate
      replace
      to={legacyTimeRedirect(location.search, location.hash, capabilities)}
      state={location.state}
    />
  )
}

/** A moved page: same query and hash, new path. */
export function MovedPage({ to }: { to: string }) {
  const location = useLocation()
  return (
    <Navigate
      replace
      to={`${to}${location.search}${location.hash}`}
      state={location.state}
    />
  )
}

/** Supervisors review leave in the inbox; employees keep their Leave page. */
export function SupervisorLeaveRedirect({ children }: { children: ReactNode }) {
  const capabilities = useCapabilities()
  const location = useLocation()
  if (!capabilities.approve_leave) return <>{children}</>
  const query = new URLSearchParams(location.search)
  query.set('kind', 'leave')
  return (
    <Navigate
      replace
      to={`/admin/approvals?${query}${location.hash}`}
      state={location.state}
    />
  )
}
