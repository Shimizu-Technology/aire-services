import { useEffect, useState } from 'react'
import { useAuth, useUser, RedirectToSignIn } from '@clerk/clerk-react'
import { useAuthContext } from '../../contexts/AuthContext'

interface ClerkProtectedContentProps {
  children: React.ReactNode
  requiredRole?: 'admin' | 'employee' | 'staff' | 'client'
}

export default function ClerkProtectedContent({ children, requiredRole }: ClerkProtectedContentProps) {
  const { isLoaded, isSignedIn } = useAuth()
  const { user: clerkUser } = useUser()
  const { userRole, isLoading: authLoading, isStaff } = useAuthContext()
  const [authStatus, setAuthStatus] = useState<'loading' | 'authorized' | 'unauthorized' | 'access_denied'>('loading')

  useEffect(() => {
    if (!isLoaded || authLoading) return

    if (!isSignedIn) {
      setAuthStatus('unauthorized')
      return
    }

    if (!userRole) {
      setAuthStatus('unauthorized')
      return
    }

    if (requiredRole) {
      const hasAccess =
        requiredRole === 'staff' ? isStaff :
        requiredRole === 'admin' ? userRole === 'admin' :
        requiredRole === 'client' ? userRole === 'client' :
        userRole === requiredRole

      if (!hasAccess) {
        setAuthStatus('access_denied')
        return
      }
    }

    setAuthStatus('authorized')
  }, [isLoaded, isSignedIn, authLoading, userRole, requiredRole, isStaff])

  if (!isLoaded || authStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (authStatus === 'unauthorized' || !isSignedIn) {
    return <RedirectToSignIn signInForceRedirectUrl={window.location.href} />
  }

  if (authStatus === 'access_denied') {
    const isClientTryingAdmin = userRole === 'client' && (requiredRole === 'staff' || requiredRole === 'admin')

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md mx-auto text-center p-8">
          {isClientTryingAdmin ? (
            <>
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Looking for your portal?</h2>
              <p className="text-gray-600 mb-6">
                This area is for staff only. Your client portal is right here:
              </p>
              <a
                href="/portal"
                className="inline-block px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors font-medium"
              >
                Go to My Portal
              </a>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
              <p className="text-gray-600 mb-6">
                You don't have permission to access this area.
                {requiredRole && ` This page requires ${requiredRole} access.`}
              </p>
              <p className="text-sm text-gray-500">
                Signed in as: {clerkUser?.primaryEmailAddress?.emailAddress}
              </p>
              <a
                href="/"
                className="mt-6 inline-block px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
              >
                Return to Home
              </a>
            </>
          )}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
