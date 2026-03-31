import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { setAuthTokenGetter, api } from '../lib/api'

interface AuthContextType {
  isClerkEnabled: boolean
  isSignedIn: boolean
  isLoading: boolean
  userRole: 'admin' | 'employee' | 'client' | null
  isClient: boolean
  isStaff: boolean
}

const AuthContext = createContext<AuthContextType>({ 
  isClerkEnabled: false,
  isSignedIn: false,
  isLoading: true,
  userRole: null,
  isClient: false,
  isStaff: false,
})

export function useAuthContext() {
  return useContext(AuthContext)
}

interface AuthProviderProps {
  children: ReactNode
  isClerkEnabled: boolean
}

const ROLE_CACHE_PREFIX = 'cst_role_'
const ROLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
type UserRole = 'admin' | 'employee' | 'client' | null

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
    if (role === 'admin' || role === 'employee' || role === 'client') return role
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
  const [userRole, setUserRole] = useState<'admin' | 'employee' | 'client' | null>(null)
  const [roleFetched, setRoleFetched] = useState(false)
  const fetchedRef = useRef(false)
  const fetchRoleRef = useRef<((retryCount?: number) => Promise<void>) | undefined>(undefined)
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

  const fetchRole = useCallback(async (retryCount = 0) => {
    if (!isLoaded || !isSignedIn || !clerkUserId) {
      setUserRole(null)
      setRoleFetched(true)
      return
    }

    if (fetchedRef.current) return
    fetchedRef.current = true

    try {
      const response = await api.getCurrentUser()
      if (response.data?.user) {
        const role = response.data.user.role
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
        retryTimerRef.current = setTimeout(() => fetchRoleRef.current?.(retryCount + 1), delay)
      } else {
        const fallback = getCachedRole(clerkUserId)
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
      setUserRole(null)
      setRoleFetched(true)
    }
    return () => clearTimeout(retryTimerRef.current)
  }, [isLoaded, isSignedIn, fetchRole])

  return (
    <AuthContext.Provider value={{ 
      isClerkEnabled: true, 
      isSignedIn: isSignedIn ?? false,
      isLoading: !isLoaded || (isSignedIn === true && !roleFetched),
      userRole,
      isClient: userRole === 'client',
      isStaff: userRole === 'admin' || userRole === 'employee',
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
      isClient: false,
      isStaff: false,
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
