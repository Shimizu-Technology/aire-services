import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { setAuthTokenGetter, api } from '../lib/api'
import type { CurrentUser } from '../lib/api'

interface AuthContextType {
  isClerkEnabled: boolean
  isSignedIn: boolean
  isLoading: boolean
  userRole: 'admin' | 'employee' | null
  isStaff: boolean
  currentUser: CurrentUser | null
  authError: string | null
  isAuthServiceUnavailable: boolean
  refreshCurrentUser: () => Promise<void>
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
  refreshCurrentUser: async () => {},
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
  const [userRole, setUserRole] = useState<'admin' | 'employee' | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isAuthServiceUnavailable, setIsAuthServiceUnavailable] = useState(false)
  const [roleFetched, setRoleFetched] = useState(false)
  const fetchedRef = useRef(false)
  const fetchRoleRef = useRef<((retryCount?: number, force?: boolean) => Promise<void>) | undefined>(undefined)
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

  const fetchRole = useCallback(async (retryCount = 0, force = false) => {
    if (!isLoaded || !isSignedIn || !clerkUserId) {
      setCurrentUser(null)
      setUserRole(null)
      setIsAuthServiceUnavailable(false)
      setRoleFetched(true)
      return
    }

    if (fetchedRef.current && !force) return
    fetchedRef.current = true

    try {
      const response = await api.getCurrentUser()
      if (response.data?.user) {
        const nextUser = response.data.user
        const role = nextUser.role
        setCurrentUser(nextUser)
        setUserRole(role)
        setAuthError(null)
        setIsAuthServiceUnavailable(false)
        setRoleFetched(true)
      } else if (response.status === 401 || response.status === 403) {
        setCurrentUser(null)
        setUserRole(null)
        setAuthError(response.error || 'Unable to verify your staff access')
        setIsAuthServiceUnavailable(false)
        setRoleFetched(true)
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

  const refreshCurrentUser = useCallback(async () => {
    fetchedRef.current = false
    setRoleFetched(false)
    setIsAuthServiceUnavailable(false)
    await fetchRole(0, true)
  }, [fetchRole])

  return (
    <AuthContext.Provider value={{ 
      isClerkEnabled: true, 
      isSignedIn: isSignedIn ?? false,
      isLoading: !isLoaded || (isSignedIn === true && !roleFetched),
      userRole,
      isStaff: userRole === 'admin' || userRole === 'employee',
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
      refreshCurrentUser: async () => {},
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
