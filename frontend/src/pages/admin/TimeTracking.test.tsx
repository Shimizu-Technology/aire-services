import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TimeTracking from './TimeTracking'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(),
  getTimeCategories: vi.fn(),
  getUsers: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getPendingApprovals: vi.fn(),
  getHoursReport: vi.fn(),
}))

vi.mock('../../lib/api', () => ({ api: apiMock }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin' }),
}))

function TimeRouteHarness() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/admin/time?tab=reports&start_date=2026-07-01&end_date=2026-07-15')}>Open July report</button>
      <TimeTracking />
    </>
  )
}

describe('TimeTracking routed report periods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getHoursReport.mockResolvedValue({ error: 'No report rows in this test' })
  })

  it('synchronizes report requests when same-route payroll dates change', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-08-01',
      end_date: '2026-08-15',
    })))

    fireEvent.click(screen.getByRole('button', { name: 'Open July report' }))

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-07-01',
      end_date: '2026-07-15',
    })))
  })

  it('carries an edited report period into approvals', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalled())

    fireEvent.change(screen.getByDisplayValue('2026-08-01'), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByDisplayValue('2026-08-15'), { target: { value: '2026-07-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }))

    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-07-16',
      end_date: '2026-07-31',
    })))
  })
})
