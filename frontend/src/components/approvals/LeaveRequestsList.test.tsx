import { render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { LeaveRequest } from '../../lib/api'
import { approvalsApi } from '../../lib/api/approvals'
import { ToastProvider } from '../ui'
import LeaveRequestsList from './LeaveRequestsList'
vi.mock('../../lib/api/approvals', () => ({ approvalsApi: { approvedLeave: vi.fn() } }))
it('bounds every approved-leave page to the displayed pending date range', async () => {
  const rows = [
    {
      id: 1,
      user: { id: 1, full_name: 'Grace' },
      leave_type: 'sick',
      start_date: '2026-11-10',
      end_date: '2026-11-11',
    },
    {
      id: 2,
      user: { id: 2, full_name: 'Marcus' },
      leave_type: 'sick',
      start_date: '2026-11-15',
      end_date: '2026-11-18',
    },
  ] as LeaveRequest[]
  vi.mocked(approvalsApi.approvedLeave).mockResolvedValue({
    data: {
      leave_requests: [],
      pagination: { current_page: 1, per_page: 100, total_pages: 2, total_count: 101 },
    },
  })
  render(
    <ToastProvider>
      <LeaveRequestsList
        requests={rows}
        onChanged={vi.fn()}
      />
    </ToastProvider>,
  )
  await waitFor(() => expect(approvalsApi.approvedLeave).toHaveBeenCalledTimes(2))
  expect(vi.mocked(approvalsApi.approvedLeave).mock.calls).toEqual([
    ['2026-11-10', '2026-11-18', 1],
    ['2026-11-10', '2026-11-18', 2],
  ])
})
