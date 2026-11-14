import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { api, type LeaveRequest } from '../../lib/api'
import LeaveRequestsPanel from '../time-tracking/LeaveRequestsPanel'
import { SupervisorLeaveRedirect } from '../../pages/admin/AdminRedirects'

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    isClerkEnabled: true,
    userRole: 'manager',
    currentUser: { id: 3, time_tracking_enabled: true },
  }),
}))
vi.mock('../../lib/api', () => ({
  api: { getLeaveRequests: vi.fn(), createLeaveRequest: vi.fn(), cancelLeaveRequest: vi.fn() },
}))

export const leaveFixture: LeaveRequest = {
  id: 41,
  leave_type: 'paid_time_off',
  start_date: '2026-12-01',
  end_date: '2026-12-02',
  status: 'pending',
  total_days: 2,
  reason: 'Own leave',
  review_note: null,
  reviewed_at: null,
  cancelled_at: null,
  created_at: '2026-11-14T00:00:00Z',
  updated_at: '2026-11-14T00:00:00Z',
  user: { id: 3, full_name: 'Roke Aguon', display_name: 'Roke', email: 'roke@aire.test' },
  reviewed_by: null,
  cancelled_by: null,
}
it('lets a supervisor submit and cancel their own request at mine=1', async () => {
  let current: LeaveRequest | null = null
  const team = {
    ...leaveFixture,
    id: 42,
    reason: 'Team pending request',
    user: { ...leaveFixture.user, id: 7, full_name: 'Team Person' },
  }
  vi.mocked(api.getLeaveRequests).mockImplementation(async (_status, page) => ({
    data: {
      leave_requests: page === 1 ? [team] : current ? [current] : [],
      pagination: {
        current_page: page ?? 1,
        per_page: 100,
        total_count: current ? 2 : 1,
        total_pages: 2,
      },
    },
  }))
  vi.mocked(api.createLeaveRequest).mockImplementation(async () => {
    current = leaveFixture
    return { data: { leave_request: current } }
  })
  vi.mocked(api.cancelLeaveRequest).mockImplementation(async () => {
    current = { ...leaveFixture, status: 'cancelled' }
    return { data: { leave_request: current } }
  })
  render(
    <MemoryRouter initialEntries={['/admin/leave?mine=1']}>
      <SupervisorLeaveRedirect>
        <LeaveRequestsPanel
          canApproveLeave
          currentUserId={3}
        />
      </SupervisorLeaveRedirect>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'My requests' })
  expect(screen.queryByText('Team pending request')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-12-01' } })
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-12-02' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
  expect(await screen.findByRole('button', { name: 'Cancel request' })).toBeEnabled()
  expect(api.getLeaveRequests).toHaveBeenCalledWith(undefined, 2, 100)
  expect(screen.queryByText('Team pending request')).not.toBeInTheDocument()
  expect(api.createLeaveRequest).toHaveBeenCalledWith(
    expect.objectContaining({ start_date: '2026-12-01', end_date: '2026-12-02' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
  await waitFor(() => expect(api.cancelLeaveRequest).toHaveBeenCalledWith(41))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument(),
  )
})
