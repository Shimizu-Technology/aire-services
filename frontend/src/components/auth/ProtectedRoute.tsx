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

  if (!isClerkEnabled && import.meta.env.PROD) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-white">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold">Authentication is not configured</h1>
          <p className="mt-3 text-sm text-slate-300">
            Staff access is unavailable until the Clerk publishable key is set for this deployment.
          </p>
        </div>
      </div>
    )
  }

  // If Clerk is not enabled in development, allow access without auth
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
