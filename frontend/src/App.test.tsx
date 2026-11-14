import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, Outlet } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const apiMock = vi.hoisted(() => ({
  getTimeEntry: vi.fn(),
  getTimeEntries: vi.fn(),
  getTimeCategories: vi.fn(),
  getUsers: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getPendingApprovals: vi.fn(),
  getHoursReport: vi.fn(),
  getWhosWorking: vi.fn(),
  getPayrollCutoff: vi.fn(),
}))
vi.mock('./lib/api', () => ({ api: apiMock }))
vi.mock('./contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin', currentUser: { id: 1 } }),
}))
vi.mock('./providers/PostHogProvider', () => ({ PostHogPageView: () => null }))
vi.mock('./components/auth/ProtectedRoute', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./components/layouts/AdminLayout', async () => {
  // The real layout provides toasts; Timecards uses them.
  const { ToastProvider } = await import('./components/ui')
  return {
    default: () => (
      <ToastProvider>
        <Link to="/admin/reports">Go to Reports</Link>
        <Link to="/admin/timecards">Go to Timecards</Link>
        <Link to="/admin/my-hours?date=2026-11-10">Go to My Hours</Link>
        <Outlet />
      </ToastProvider>
    ),
  }
})
vi.mock('./components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
vi.mock('./components/time-tracking/WhosWorking', () => ({ default: () => null }))
vi.mock('./components/time-tracking/ClockInOutCard', () => ({ default: () => <p>Your clock card</p> }))

// The time sections are sibling routes with the same wrappers. Each needs its
// own TimeTracking instance, or one section's period leaks into the next.
describe('App time-section routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getTimeEntry.mockResolvedValue({ error: 'No linked fixture', status: 404 })
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [], pagination: { total_pages: 1 } } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getHoursReport.mockResolvedValue({ error: 'No report rows in this test' })
    apiMock.getWhosWorking.mockResolvedValue({ data: { workers: [] } })
    apiMock.getPayrollCutoff.mockResolvedValue({ data: { cutoff: { period: null, cutoff_at: null } } })
  })
  afterEach(() => window.history.pushState({}, '', '/'))

  it('opens Reports without the period from a dated Approvals view', async () => {
    window.history.pushState({}, '', '/admin/approvals?start_date=2026-08-01&end_date=2026-08-15')
    render(<App />)
    // The lazy route must finish importing before its data effect can run.
    expect(await screen.findByDisplayValue('2026-08-01', {}, {
      timeout: 10_000,
    })).toBeInTheDocument()
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-08-01', end_date: '2026-08-15' })))

    fireEvent.click(screen.getByRole('link', { name: 'Go to Reports' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument()
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalled())
    expect(apiMock.getHoursReport).not.toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-08-01' }))
    expect(screen.queryByDisplayValue('2026-08-01')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('2026-08-15')).not.toBeInTheDocument()
    await waitFor(() => expect(window.location.search).not.toContain('2026-08-01'))
  })

  // My Hours is a separate pay-period view without a clock card.
  it('opens My Hours by pay period and keeps Timecards separate', async () => {
    window.history.pushState({}, '', '/admin/my-hours?date=2026-11-10')
    render(<App />)
    // The app's router outlives one test, so move with a link rather than the address bar.
    fireEvent.click(await screen.findByRole('link', { name: 'Go to My Hours' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'My Hours' })).toBeInTheDocument()
    expect(screen.queryByText('Your clock card')).not.toBeInTheDocument()
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ user_id: 1, start_date: expect.any(String), end_date: expect.any(String) })))
    expect(screen.queryByRole('searchbox', { name: 'Find a person' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Go to Timecards' }))

    expect(await screen.findByRole('searchbox', { name: 'Find a person' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Timecards' })).toBeInTheDocument()
    expect(screen.queryByText('Your clock card')).not.toBeInTheDocument()
  })
})
