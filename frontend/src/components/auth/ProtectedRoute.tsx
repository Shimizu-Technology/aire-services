import { lazy, Suspense } from 'react'
import { useAuthContext } from '../../contexts/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: 'admin' | 'employee' | 'staff'
}

// Lazy load the Clerk-protected component to avoid importing Clerk hooks when not needed
const ClerkProtectedContent = lazy(() => import('./ClerkProtectedContent'))

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isClerkEnabled } = useAuthContext()

  // If Clerk is not enabled (dev mode), allow access without auth
  if (!isClerkEnabled) {
    return <>{children}</>
  }

  // When Clerk is enabled, use the protected route logic
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      }
    >
      <ClerkProtectedContent requiredRole={requiredRole}>{children}</ClerkProtectedContent>
    </Suspense>
  )
}
