import { useMemo } from 'react'
import { useAuthContext } from '../contexts/AuthContext'
import { capabilitiesFor, type Capabilities } from './roles'

// What the signed-in person can do. Local development without Clerk has always
// shown the full admin workspace, so it gets owner capabilities.
export function useCapabilities(): Capabilities {
  const { isClerkEnabled, userRole } = useAuthContext()
  return useMemo(() => capabilitiesFor(isClerkEnabled ? userRole : 'owner'), [isClerkEnabled, userRole])
}
