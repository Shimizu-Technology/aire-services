import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, type LeaveRequest } from '../../lib/api'
import MyLeave from './MyLeave'

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ currentUser: { id: 5 } }),
}))
const request = {
  id: 9,
  user: { id: 5 },
  leave_type: 'paid_time_off',
  start_date: '2026-12-01',
  end_date: '2026-12-01',
  status: 'pending',
  reason: 'Family visit',
  review_note: null,
} as LeaveRequest
beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getLeaveRequests').mockResolvedValue({
    data: {
      leave_requests: [request],
      pagination: { current_page: 1, per_page: 100, total_count: 1, total_pages: 1 },
    },
    status: 200,
  })
})
const open = () =>
  render(
    <MemoryRouter>
      <MyLeave />
    </MemoryRouter>
  )

it('sends a leave request, preserving the half-day instruction', async () => {
  const create = vi
    .spyOn(api, 'createLeaveRequest')
    .mockResolvedValue({ data: { leave_request: request }, status: 201 })
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Request time off' }))
  fireEvent.change(screen.getByLabelText(/Start date/), {
    target: { value: '2026-12-04' },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Half day' }))
  fireEvent.change(screen.getByLabelText('Note'), {
    target: { value: 'Morning appointment' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      leave_type: 'paid_time_off',
      start_date: '2026-12-04',
      end_date: '2026-12-04',
      reason: 'Half day requested.\nMorning appointment',
    })
  )
  expect(
    await screen.findByText('Your request was sent for approval.')
  ).toBeInTheDocument()
})

it('cancels only a pending request owned by the viewer', async () => {
  const cancel = vi
    .spyOn(api, 'cancelLeaveRequest')
    .mockResolvedValue({
      data: { leave_request: { ...request, status: 'cancelled' } },
      status: 200,
    })
  open()
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(9))
  expect(await screen.findByText('Your request was cancelled.')).toBeInTheDocument()
})

it('filters another person’s requests even when a supervisor reuses MyLeave', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue({
    data: {
      leave_requests: [
        request,
        {
          ...request,
          id: 10,
          user: { ...request.user, id: 6 },
          reason: 'Other person',
        },
      ],
      pagination: { current_page: 1, per_page: 100, total_count: 2, total_pages: 1 },
    },
  })
  open()
  expect(await screen.findByText('Family visit')).toBeInTheDocument()
  expect(screen.queryByText('Other person')).not.toBeInTheDocument()
})
