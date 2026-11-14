import { lazy, Suspense } from 'react'
import { createBrowserRouter, createRoutesFromElements, Link, Outlet, Route, RouterProvider, useRouteError } from 'react-router-dom'

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
import { AdminLanding, LegacyTimeRedirect, MovedPage } from './pages/admin/AdminRedirects'
import SchedulesGate from './pages/admin/SchedulesGate'

const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const EmployeeWorkspace = lazy(() => import('./pages/admin/EmployeeWorkspace'))
const Users = lazy(() => import('./pages/admin/Users'))
const TimeTracking = lazy(() => import('./pages/admin/TimeTracking'))
const Timecards = lazy(() => import('./pages/admin/Timecards'))
const Schedule = lazy(() => import('./pages/admin/Schedule'))
const DepartmentsWork = lazy(() => import('./pages/admin/settings/DepartmentsWork'))
const SettingsHome = lazy(() => import('./pages/admin/settings/SettingsHome'))
const SettingsPage = lazy(() => import('./pages/admin/settings/SettingsPage'))
const PayrollConnectionSettings = lazy(() => import('./pages/admin/settings/PayrollConnectionSettings'))
const Settings = lazy(() => import('./pages/admin/Settings'))
const RolesAccess = lazy(() => import('./pages/admin/RolesAccess'))
const Media = lazy(() => import('./pages/admin/Media'))
const ActivityHistory = lazy(() => import('./pages/admin/ActivityHistory'))
const PayrollRuns = lazy(() => import('./pages/admin/PayrollRuns'))
const PayrollAccountLink = lazy(() => import('./pages/admin/PayrollAccountLink'))
const MyPay = lazy(() => import('./pages/admin/MyPay'))
const MyPayStatement = lazy(() => import('./pages/admin/MyPayStatement'))
const MyPayPreview = lazy(() => import('./pages/admin/MyPayPreview'))
const PayStubs = lazy(() => import('./pages/admin/PayStubs'))
const PayStubLink = lazy(() => import('./pages/aire/PayStubLink'))
const MyTimeHome = lazy(() => import('./pages/admin/EmployeeClockRoute'))
const MyHours = lazy(() => import('./pages/admin/MyHours'))
const EmployeeLeaveRoute = lazy(() => import('./pages/admin/EmployeeLeaveRoute'))
const WebsiteLayout = lazy(() => import('./pages/admin/Website'))
const WebsiteHome = lazy(() => import('./pages/admin/Website').then((module) => ({ default: module.WebsiteHome })))

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

/** Every route renders inside this, so page views are tracked once per navigation. */
function AppShell() {
  return (
    <>
      <PostHogPageView />
      <Outlet />
    </>
  )
}

/**
 * A data router would otherwise show its own "Unexpected Application Error"
 * page. Rethrowing keeps what BrowserRouter did: the error reaches React's
 * root and the global error handlers that report it.
 */
function RethrowRouteError(): never {
  throw useRouteError()
}

const routes = createRoutesFromElements(
      <Route element={<AppShell />} errorElement={<RethrowRouteError />}>
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
        {/* Public page behind an emailed pay stub link; the token is in the URL fragment. */}
        <Route path="/stubs" element={<Suspense fallback={null}><PayStubLink /></Suspense>} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="staff">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          {/* Today for owners and admins; managers land on Approvals, employees on My Time. */}
          <Route index element={<AdminLanding><Suspense fallback={<AdminLoadingFallback />}><Dashboard /></Suspense></AdminLanding>} />
          {/* The old "Time & Payroll" tabs, one route each. /admin/time?tab=… redirects here.
              Each keeps its own key so React remounts TimeTracking between them: without it,
              one instance is reused and an Approvals period carries into Reports. */}
          <Route path="approvals" element={<ProtectedRoute requiredCapability="approve_time"><Suspense fallback={<AdminLoadingFallback />}><TimeTracking key="approvals" section="approvals" /></Suspense></ProtectedRoute>} />
          <Route path="timecards" element={<ProtectedRoute requiredCapability="manage_team_time"><Suspense fallback={<AdminLoadingFallback />}><Timecards /></Suspense></ProtectedRoute>} />
          <Route path="reports" element={<ProtectedRoute requiredCapability="export_hours_reports"><Suspense fallback={<AdminLoadingFallback />}><TimeTracking key="reports" section="reports" /></Suspense></ProtectedRoute>} />
          <Route path="leave" element={<Suspense fallback={<AdminLoadingFallback />}><EmployeeLeaveRoute /></Suspense>} />
          <Route path="my-hours" element={<Suspense fallback={<AdminLoadingFallback />}><MyHours /></Suspense>} />
          <Route path="my-time" element={<Suspense fallback={<AdminLoadingFallback />}><MyTimeHome /></Suspense>} />
          <Route path="time" element={<LegacyTimeRedirect />} />
          {/* Hidden unless "Use schedules" is on in Settings. */}
          <Route path="schedule" element={<SchedulesGate><Suspense fallback={<AdminLoadingFallback />}><Schedule /></Suspense></SchedulesGate>} />
          <Route path="pay" element={<Suspense fallback={<AdminLoadingFallback />}><MyPay /></Suspense>} />
          <Route path="pay/:id" element={<Suspense fallback={<AdminLoadingFallback />}><MyPayStatement /></Suspense>} />
          {/* Read-only My Pay preview: owners and admins only (checked again by the API). */}
          <Route path="pay-preview" element={<ProtectedRoute requiredCapability="preview_pay"><Suspense fallback={<AdminLoadingFallback />}><MyPayPreview view="picker" /></Suspense></ProtectedRoute>} />
          <Route path="pay-preview/:userId" element={<ProtectedRoute requiredCapability="preview_pay"><Suspense fallback={<AdminLoadingFallback />}><MyPayPreview view="list" /></Suspense></ProtectedRoute>} />
          <Route path="pay-preview/:userId/:id" element={<ProtectedRoute requiredCapability="preview_pay"><Suspense fallback={<AdminLoadingFallback />}><MyPayPreview view="statement" /></Suspense></ProtectedRoute>} />
          {/* Sending pay stubs: owners, admins and managers (checked again by the API). */}
          <Route path="pay-stubs" element={<ProtectedRoute requiredCapability="send_pay_statements"><Suspense fallback={<AdminLoadingFallback />}><PayStubs /></Suspense></ProtectedRoute>} />
          {/* Everything on the public site. Media moved here from /admin/media. */}
          <Route
            path="website"
            element={
              <ProtectedRoute requiredCapability="manage_site">
                <Suspense fallback={<AdminLoadingFallback />}><WebsiteLayout /></Suspense>
              </ProtectedRoute>
            }
          >
            <Route index element={<Suspense fallback={<AdminLoadingFallback />}><WebsiteHome /></Suspense>} />
            <Route path="media" element={<Suspense fallback={<AdminLoadingFallback />}><Media /></Suspense>} />
            {/* Contact settings write through the settings API, so this also needs manage_settings. */}
            <Route path="contact" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><Settings view="website" /></Suspense></ProtectedRoute>} />
          </Route>
          <Route path="media" element={<MovedPage to="/admin/website/media" />} />
          <Route
            path="payroll"
            element={
              <ProtectedRoute requiredCapability="manage_payroll">
                <Suspense fallback={<AdminLoadingFallback />}><PayrollRuns /></Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="payroll-link"
            element={
              <ProtectedRoute requiredCapability="manage_payroll">
                <Suspense fallback={<AdminLoadingFallback />}><PayrollAccountLink /></Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="activity"
            element={
              <ProtectedRoute requiredCapability="view_activity">
                <Suspense fallback={<AdminLoadingFallback />}><ActivityHistory /></Suspense>
              </ProtectedRoute>
            }
          />
          {/* Owners and admins get the full page; everyone else a read-only "What can I do?" view. */}
          <Route path="settings/time-clock" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><SettingsPage page="time-clock" /></Suspense></ProtectedRoute>} />
          <Route path="settings/approvals" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><SettingsPage page="approvals" /></Suspense></ProtectedRoute>} />
          <Route path="settings/pay-stubs" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><SettingsPage page="pay-stubs" /></Suspense></ProtectedRoute>} />
          <Route path="settings/kiosk" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><SettingsPage page="kiosk" /></Suspense></ProtectedRoute>} />
          <Route path="settings/schedules" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><SettingsPage page="schedules" /></Suspense></ProtectedRoute>} />
          <Route path="settings/payroll-connection" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><PayrollConnectionSettings /></Suspense></ProtectedRoute>} />
          <Route path="settings/departments" element={<ProtectedRoute requiredCapability="manage_settings"><Suspense fallback={<AdminLoadingFallback />}><DepartmentsWork /></Suspense></ProtectedRoute>} />
          <Route path="settings/roles" element={<ProtectedRoute requiredRole="staff"><Suspense fallback={<AdminLoadingFallback />}><RolesAccess /></Suspense></ProtectedRoute>} />
          <Route
            path="settings"
            element={
              <ProtectedRoute requiredCapability="manage_settings">
                <Suspense fallback={<AdminLoadingFallback />}><SettingsHome /></Suspense>
              </ProtectedRoute>
            }
          />
          <Route path="users/:id" element={<ProtectedRoute requiredCapability="manage_users"><Suspense fallback={<AdminLoadingFallback />}><EmployeeWorkspace /></Suspense></ProtectedRoute>} />
          <Route
            path="users"
            element={
              <ProtectedRoute requiredCapability="manage_users">
                <Suspense fallback={<AdminLoadingFallback />}><Users /></Suspense>
              </ProtectedRoute>
            }
          />
        </Route>
      </Route>,
)

type AppRouter = ReturnType<typeof createBrowserRouter>
let appRouter: AppRouter | undefined

// Created on the first render, as BrowserRouter was, so it reads the URL after
// the pay stub token guard and the providers in main.tsx have run.
function getAppRouter(): AppRouter {
  appRouter ??= createBrowserRouter(routes)
  return appRouter
}

// A hot reload of this file builds a new route tree and router; stop the old one listening.
import.meta.hot?.dispose(() => appRouter?.dispose())

/**
 * A data router (createBrowserRouter) rather than BrowserRouter, so pages can
 * use useBlocker, e.g. useUnsavedChanges asking before leaving with edits.
 */
function App() {
  return <RouterProvider router={getAppRouter()} />
}

export default App
