import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, Outlet } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { ToastProvider } from './components/ui'

const apiMock = vi.hoisted(() => ({
  getTimeEntry: vi.fn(),
  getTimeEntries: vi.fn(),
  getTimeCategories: vi.fn(),
  getUsers: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getPendingApprovals: vi.fn(),
  getHoursReport: vi.fn(),
  getPayrollCutoff: vi.fn().mockResolvedValue({ error: 'No period' }),
  getLeaveRequests: vi
    .fn()
    .mockResolvedValue({ data: { leave_requests: [], pagination: { total_pages: 1 } } }),
  getWhosWorking: vi.fn().mockResolvedValue({ data: { workers: [] } }),
}))
vi.mock('./lib/api', () => ({ api: apiMock }))
vi.mock('./lib/api/approvals', () => ({ approvalsApi: { pending: apiMock.getPendingApprovals } }))
vi.mock('./lib/payStubsApi', () => ({
  payStubsApi: { requests: vi.fn().mockResolvedValue({ requests: [] }) },
}))
vi.mock('./contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin', currentUser: { id: 1 } }),
}))
vi.mock('./providers/PostHogProvider', () => ({ PostHogPageView: () => null }))
vi.mock('./components/auth/ProtectedRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./components/layouts/AdminLayout', () => ({
  default: () => (
    <ToastProvider>
      <Link to="/admin/reports">Go to Reports</Link>
      <Outlet />
    </ToastProvider>
  ),
}))
vi.mock('./components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
vi.mock('./components/time-tracking/WhosWorking', () => ({ default: () => null }))

// The time sections are sibling routes with the same wrappers. Each needs its
// own TimeTracking instance, or one section's period leaks into the next.
describe('App time-section routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getTimeEntry.mockResolvedValue({ error: 'No linked fixture', status: 404 })
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({
      data: {
        pending_entries: [],
        count: 0,
        summary: null,
        review_summary: { complete: true, batch_limit: 100 },
      },
    })
    apiMock.getHoursReport.mockResolvedValue({ error: 'No report rows in this test' })
  })
  afterEach(() => window.history.pushState({}, '', '/'))

  it('opens Reports without the period from a dated Approvals view', async () => {
    window.history.pushState({}, '', '/admin/approvals?start_date=2026-08-01&end_date=2026-08-15')
    render(<App />)
    await waitFor(() =>
      expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(
        expect.objectContaining({ start_date: '2026-08-01', end_date: '2026-08-15' }),
      ),
    )
    fireEvent.click(await screen.findByRole('button', { name: /Filters/ }))
    expect(await screen.findByDisplayValue('2026-08-01')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('link', { name: 'Go to Reports' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument()
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalled())
    expect(apiMock.getHoursReport).not.toHaveBeenCalledWith(
      expect.objectContaining({ start_date: '2026-08-01' }),
    )
    expect(screen.queryByDisplayValue('2026-08-01')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('2026-08-15')).not.toBeInTheDocument()
    await waitFor(() => expect(window.location.search).not.toContain('2026-08-01'))
  })
})
