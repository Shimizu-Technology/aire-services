import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LeaveRequestsPanel from './LeaveRequestsPanel'
import type { LeaveRequest, PaginationMeta } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getLeaveRequests: vi.fn(),
  createLeaveRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
  declineLeaveRequest: vi.fn(),
  cancelLeaveRequest: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

const pagination: PaginationMeta = {
  current_page: 1,
  per_page: 25,
  total_count: 1,
  total_pages: 1,
}

function makeRequest(overrides: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: 1,
    leave_type: 'paid_time_off',
    start_date: '2026-05-20',
    end_date: '2026-05-22',
    status: 'pending',
    reason: 'Family travel',
    review_note: null,
    total_days: 3,
    reviewed_at: null,
    cancelled_at: null,
    created_at: '2026-05-01T02:00:00.000Z',
    updated_at: '2026-05-01T02:00:00.000Z',
    user: {
      id: 10,
      email: 'alice@example.com',
      display_name: 'Alice',
      full_name: 'Alice Smith',
    },
    reviewed_by: null,
    cancelled_by: null,
    ...overrides,
  }
}

describe('LeaveRequestsPanel transparency timeline', () => {
  beforeEach(() => {
    apiMock.getLeaveRequests.mockReset()
    apiMock.createLeaveRequest.mockReset()
    apiMock.approveLeaveRequest.mockReset()
    apiMock.declineLeaveRequest.mockReset()
    apiMock.cancelLeaveRequest.mockReset()
  })

  it('shows when requests were sent, reviewed, and cancelled', async () => {
    const pending = makeRequest({ id: 1 })
    const approved = makeRequest({
      id: 2,
      status: 'approved',
      reviewed_at: '2026-05-02T03:00:00.000Z',
      updated_at: '2026-05-02T03:00:00.250Z',
      review_note: 'Approved for staffing coverage.',
      reviewed_by: {
        id: 1,
        full_name: 'Admin User',
      },
    })
    const cancelled = makeRequest({
      id: 3,
      status: 'cancelled',
      cancelled_at: '2026-05-03T04:00:00.000Z',
      updated_at: '2026-05-03T04:00:00.250Z',
      cancelled_by: {
        id: 10,
        full_name: 'Alice Smith',
      },
    })

    apiMock.getLeaveRequests.mockImplementation((status: string) => {
      if (status === 'pending') {
        return Promise.resolve({ data: { leave_requests: [pending], pagination } })
      }

      return Promise.resolve({
        data: {
          leave_requests: [approved, cancelled],
          pagination: { ...pagination, total_count: 2 },
        },
      })
    })

    render(<LeaveRequestsPanel canApproveLeave />)

    expect(await screen.findByText('Pending approvals (1)')).toBeInTheDocument()
    expect(screen.getByText('Completed requests')).toBeInTheDocument()
    expect(screen.getAllByText('Sent')).toHaveLength(3)
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Reviewed')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText(/May 2, 2026.* by Admin User/)).toBeInTheDocument()
    expect(screen.getByText(/May 3, 2026.* by Alice Smith/)).toBeInTheDocument()
    expect(screen.getByText(/Approved for staffing coverage/)).toBeInTheDocument()
    expect(screen.queryByText('Last updated')).not.toBeInTheDocument()
  })

  it('puts pending approvals above the folded request form for approvers', async () => {
    apiMock.getLeaveRequests.mockImplementation((status: string) => Promise.resolve({
      data: { leave_requests: status === 'pending' ? [makeRequest({ id: 1 })] : [], pagination },
    }))
    render(<LeaveRequestsPanel canApproveLeave />)
    const pendingHeading = await screen.findByText('Pending approvals (1)')
    const requestHeading = screen.getByRole('heading', { name: 'Request your own leave' })
    expect(pendingHeading.compareDocumentPosition(requestHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument()
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting admin review')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    expect(screen.getByLabelText('Start date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide form' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides the request form from approvers who do not track time', async () => {
    apiMock.getLeaveRequests.mockResolvedValue({ data: { leave_requests: [], pagination: { ...pagination, total_count: 0 } } })
    render(<LeaveRequestsPanel canApproveLeave canRequestLeave={false} />)
    expect(await screen.findByText('Pending approvals (0)')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Request your own leave' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request leave' })).not.toBeInTheDocument()
  })

  it('keeps the request form open first for employees', async () => {
    apiMock.getLeaveRequests.mockResolvedValue({ data: { leave_requests: [makeRequest({ id: 1 })], pagination } })
    render(<LeaveRequestsPanel canApproveLeave={false} />)
    const form = screen.getByRole('heading', { name: 'Leave requests' }).closest('section') as HTMLElement
    expect(within(form).getByLabelText('Start date')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Submit request' })).toBeInTheDocument()
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.getByText('My requests')).toBeInTheDocument()
  })
})
