import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { setAuthTokenGetter, api } from '../lib/api'
import type { CurrentUser } from '../lib/api'
import { isUserRole, type UserRole } from '../lib/roles'

interface AuthContextType {
  isClerkEnabled: boolean
  isSignedIn: boolean
  isLoading: boolean
  userRole: UserRole | null
  isStaff: boolean
  currentUser: CurrentUser | null
  authError: string | null
  isAuthServiceUnavailable: boolean
  /** Re-reads the signed-in profile. `background` keeps the current pages mounted while it loads. */
  /** Resolves true once the signed-in profile has been reloaded; false if that attempt failed (retries continue). */
  refreshCurrentUser: (options?: { background?: boolean }) => Promise<boolean>
}

const AuthContext = createContext<AuthContextType>({ 
  isClerkEnabled: false,
  isSignedIn: false,
  isLoading: true,
  userRole: null,
  isStaff: false,
  currentUser: null,
  authError: null,
  isAuthServiceUnavailable: false,
  refreshCurrentUser: async () => false,
})

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthContext() {
  return useContext(AuthContext)
}

interface AuthProviderProps {
  children: ReactNode
  isClerkEnabled: boolean
}

const CLERK_JWT_TEMPLATE = import.meta.env.VITE_CLERK_JWT_TEMPLATE

function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isAuthServiceUnavailable, setIsAuthServiceUnavailable] = useState(false)
  const [roleFetched, setRoleFetched] = useState(false)
  const fetchedRef = useRef(false)
  const fetchRoleRef = useRef<((retryCount?: number, force?: boolean) => Promise<boolean>) | undefined>(undefined)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastClerkIdRef = useRef<string | null>(null)

  useEffect(() => {
    const currentClerkId = clerkUser?.id ?? null
    if (currentClerkId !== lastClerkIdRef.current) {
      lastClerkIdRef.current = currentClerkId
      fetchedRef.current = false
      clearTimeout(retryTimerRef.current)
      setCurrentUser(null)
      setUserRole(null)
      setAuthError(null)
      setIsAuthServiceUnavailable(false)
      setRoleFetched(!currentClerkId)
    }
  }, [clerkUser?.id])

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        const token = await getToken(CLERK_JWT_TEMPLATE ? { template: CLERK_JWT_TEMPLATE } : undefined)
        return token
      } catch (error) {
        console.error('Error getting auth token:', error)
        return null
      }
    })
  }, [getToken])

  const clerkUserId = clerkUser?.id

  // Resolves true when this attempt loaded the profile.
  const fetchRole = useCallback(async (retryCount = 0, force = false): Promise<boolean> => {
    if (!isLoaded || !isSignedIn || !clerkUserId) {
      setCurrentUser(null)
      setUserRole(null)
      setIsAuthServiceUnavailable(false)
      setRoleFetched(true)
      return false
    }

    if (fetchedRef.current && !force) return false
    fetchedRef.current = true

    try {
      const response = await api.getCurrentUser()
      if (response.data?.user) {
        const nextUser = response.data.user
        const role = isUserRole(nextUser.role) ? nextUser.role : null
        setCurrentUser(nextUser)
        setUserRole(role)
        setAuthError(null)
        setIsAuthServiceUnavailable(false)
        setRoleFetched(true)
        return true
      } else if (response.status === 401 || response.status === 403) {
        setCurrentUser(null)
        setUserRole(null)
        setAuthError(response.error || 'Unable to verify your staff access')
        setIsAuthServiceUnavailable(false)
        setRoleFetched(true)
        return false
      } else {
        throw new Error(response.error || 'No user in response')
      }
    } catch {
      fetchedRef.current = false
      if (retryCount < 2) {
        const delay = (retryCount + 1) * 1500
        retryTimerRef.current = setTimeout(() => fetchRoleRef.current?.(retryCount + 1, force), delay)
      } else {
        setCurrentUser(null)
        setUserRole(null)
        setAuthError(null)
        setIsAuthServiceUnavailable(true)
        setRoleFetched(true)
      }
      return false
    }
  }, [isLoaded, isSignedIn, clerkUserId])

  useLayoutEffect(() => {
    fetchRoleRef.current = fetchRole
  }, [fetchRole])

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      fetchRole()
    } else if (isLoaded && !isSignedIn) {
      clearTimeout(retryTimerRef.current)
      fetchedRef.current = false
      setCurrentUser(null)
      setUserRole(null)
      setAuthError(null)
      setIsAuthServiceUnavailable(false)
      setRoleFetched(true)
    }
    return () => clearTimeout(retryTimerRef.current)
  }, [isLoaded, isSignedIn, fetchRole])

  const refreshCurrentUser = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    fetchedRef.current = false
    // A full refresh shows the sign-in check again; a background one (after
    // a settings change) updates the profile without unmounting the page.
    if (!background) setRoleFetched(false)
    setIsAuthServiceUnavailable(false)
    return fetchRole(0, true)
  }, [fetchRole])

  return (
    <AuthContext.Provider value={{ 
      isClerkEnabled: true, 
      isSignedIn: isSignedIn ?? false,
      isLoading: !isLoaded || (isSignedIn === true && !roleFetched),
      userRole,
      isStaff: isUserRole(userRole),
      currentUser,
      authError,
      isAuthServiceUnavailable,
      refreshCurrentUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

function NoAuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    setAuthTokenGetter(async () => null)
  }, [])

  return (
    <AuthContext.Provider value={{ 
      isClerkEnabled: false, 
      isSignedIn: false,
      isLoading: false,
      userRole: null,
      isStaff: false,
      currentUser: null,
      authError: null,
      isAuthServiceUnavailable: false,
      refreshCurrentUser: async () => false,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children, isClerkEnabled }: AuthProviderProps) {
  if (isClerkEnabled) {
    return <ClerkAuthProvider>{children}</ClerkAuthProvider>
  }

  return <NoAuthProvider>{children}</NoAuthProvider>
}
