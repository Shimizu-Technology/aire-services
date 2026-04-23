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
  refreshCurrentUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({ 
  isClerkEnabled: false,
  isSignedIn: false,
  isLoading: true,
  userRole: null,
  isStaff: false,
  currentUser: null,
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

const ROLE_CACHE_PREFIX = 'aire_role_'
const ROLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
type UserRole = 'admin' | 'employee' | null

function getCachedRole(clerkId: string | undefined): UserRole {
  if (!clerkId) return null
  const raw = localStorage.getItem(`${ROLE_CACHE_PREFIX}${clerkId}`)
  if (!raw) return null
  try {
    const { role, ts } = JSON.parse(raw)
    if (Date.now() - ts > ROLE_CACHE_TTL_MS) {
      localStorage.removeItem(`${ROLE_CACHE_PREFIX}${clerkId}`)
      return null
    }
    if (role === 'admin' || role === 'employee') return role
  } catch { /* corrupted entry */ }
  localStorage.removeItem(`${ROLE_CACHE_PREFIX}${clerkId}`)
  return null
}

function setCachedRole(clerkId: string | undefined, role: UserRole) {
  if (!clerkId) return
  if (role) {
    localStorage.setItem(`${ROLE_CACHE_PREFIX}${clerkId}`, JSON.stringify({ role, ts: Date.now() }))
  } else {
    localStorage.removeItem(`${ROLE_CACHE_PREFIX}${clerkId}`)
  }
}

function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const [userRole, setUserRole] = useState<'admin' | 'employee' | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [roleFetched, setRoleFetched] = useState(false)
  const fetchedRef = useRef(false)
  const fetchRoleRef = useRef<((retryCount?: number, force?: boolean) => Promise<void>) | undefined>(undefined)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastClerkIdRef = useRef<string | null>(null)

  useEffect(() => {
    const currentClerkId = clerkUser?.id ?? null
    if (currentClerkId !== lastClerkIdRef.current) {
      if (lastClerkIdRef.current && !currentClerkId) {
        setCachedRole(lastClerkIdRef.current, null)
      }
      lastClerkIdRef.current = currentClerkId
      fetchedRef.current = false
      clearTimeout(retryTimerRef.current)
    }
  }, [clerkUser?.id])

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        const token = await getToken()
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
        setCachedRole(clerkUserId, role)
        setRoleFetched(true)
      } else {
        throw new Error('No user in response')
      }
    } catch {
      fetchedRef.current = false
      if (retryCount < 2) {
        const delay = (retryCount + 1) * 1500
        retryTimerRef.current = setTimeout(() => fetchRoleRef.current?.(retryCount + 1, force), delay)
      } else {
        const fallback = getCachedRole(clerkUserId)
        setCurrentUser(null)
        setUserRole(fallback)
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
      setRoleFetched(true)
    }
    return () => clearTimeout(retryTimerRef.current)
  }, [isLoaded, isSignedIn, fetchRole])

  const refreshCurrentUser = useCallback(async () => {
    fetchedRef.current = false
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
