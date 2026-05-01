import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'

import { PostHogPageView } from './providers/PostHogProvider'
import PublicLayout from './components/layouts/PublicLayout'
import AdminLayout from './components/layouts/AdminLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'

import AireHome from './pages/aire/AireHome'
import AirePrograms from './pages/aire/AirePrograms'
import AireTeam from './pages/aire/AireTeam'
import AireContact from './pages/aire/AireContact'
import AireDiscoveryFlight from './pages/aire/AireDiscoveryFlight'
import AireCareers from './pages/aire/AireCareers'
import AireKiosk from './pages/aire/AireKiosk'

const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const Users = lazy(() => import('./pages/admin/Users'))
const TimeTracking = lazy(() => import('./pages/admin/TimeTracking'))
const Schedule = lazy(() => import('./pages/admin/Schedule'))
const Settings = lazy(() => import('./pages/admin/Settings'))
const Media = lazy(() => import('./pages/admin/Media'))

function AdminLoadingFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-bold text-slate-900">404</h1>
      <p className="mt-4 text-lg text-slate-600">The page you're looking for doesn't exist.</p>
      <Link to="/" className="mt-6 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
        Back to Home
      </Link>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <PostHogPageView />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<AireHome />} />
          <Route path="/programs" element={<AirePrograms />} />
          <Route path="/team" element={<AireTeam />} />
          <Route path="/discovery-flight" element={<AireDiscoveryFlight />} />
          <Route path="/careers" element={<AireCareers />} />
          <Route path="/contact" element={<AireContact />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        <Route path="/kiosk" element={<AireKiosk />} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="staff">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Suspense fallback={<AdminLoadingFallback />}><Dashboard /></Suspense>} />
          <Route path="time" element={<Suspense fallback={<AdminLoadingFallback />}><TimeTracking /></Suspense>} />
          <Route path="schedule" element={<Suspense fallback={<AdminLoadingFallback />}><Schedule /></Suspense>} />
          <Route
            path="media"
            element={
              <ProtectedRoute requiredRole="admin">
                <Suspense fallback={<AdminLoadingFallback />}><Media /></Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="settings"
            element={
              <ProtectedRoute requiredRole="admin">
                <Suspense fallback={<AdminLoadingFallback />}><Settings /></Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="users"
            element={
              <ProtectedRoute requiredRole="admin">
                <Suspense fallback={<AdminLoadingFallback />}><Users /></Suspense>
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
