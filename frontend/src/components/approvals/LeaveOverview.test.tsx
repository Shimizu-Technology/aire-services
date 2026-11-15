import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, type LeaveRequest } from '../../lib/api'
import { approvalsApi } from '../../lib/api/approvals'
import { ToastProvider } from '../ui'
import LeaveOverview from './LeaveOverview'
vi.mock('../../lib/api', () => ({ api: { getLeaveRequests: vi.fn(), approveLeaveRequest: vi.fn(), undoLeaveDecision: vi.fn(), changeLeaveDecision: vi.fn() } }))
vi.mock('../../lib/api/approvals', () => ({ approvalsApi: { approvedLeave: vi.fn() } }))
const row: LeaveRequest = { id: 1, version: 0, user: { id: 3, full_name: 'Ana Rivera', email: 'ana@example.invalid', department: 'Ops/Maint' }, leave_type: 'unpaid', status: 'pending', start_date: '2026-11-17', end_date: '2026-11-17', total_days: 1, reviewed_at: null, reviewed_by: null, cancelled_at: null, cancelled_by: null, review_note: null, reason: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }
const decided = (): LeaveRequest => ({ ...row, version: 1, status: 'approved', reviewed_by: { id: 4, full_name: 'Mindy' }, reviewed_at: new Date().toISOString(), undo_expires_at: new Date(Date.now() + 900000).toISOString() })
const response = (rows: LeaveRequest[]) => ({ data: { leave_requests: rows, pagination: { current_page: 1, per_page: 100, total_pages: 1, total_count: rows.length } } })
const changed = vi.fn(async () => {})
function show(rows: LeaveRequest[] = []) {
  return render(<ToastProvider><LeaveOverview requests={rows} viewerId={4} onChanged={changed} matchesPerson={() => true} matchesDates={() => true} /></ToastProvider>)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getLeaveRequests).mockResolvedValue(response([]))
  vi.mocked(approvalsApi.approvedLeave).mockResolvedValue(response([]))
})
it('keeps a decided row with versioned Undo and refreshes the pending inbox', async () => {
  const approved = decided()
  vi.mocked(api.approveLeaveRequest).mockImplementation(async () => {
    vi.mocked(api.getLeaveRequests).mockResolvedValue(response([approved]))
    return { data: { leave_request: approved } }
  })
  vi.mocked(api.undoLeaveDecision).mockImplementation(async () => {
    vi.mocked(api.getLeaveRequests).mockResolvedValue(response([]))
    return { data: { leave_request: { ...row, version: 2 } } }
  })
  show([row])
  await screen.findByText('No approved absences this week in this department.')
  fireEvent.click(screen.getByRole('button', { name: 'Approve leave for Ana Rivera' }))
  expect(await screen.findByText('Just decided')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!)
  await waitFor(() => expect(api.undoLeaveDecision).toHaveBeenCalledWith(1, 1))
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
})
it('restores recent decisions after a page reload', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue(response([decided()]))
  show()
  expect(await screen.findByText('Just decided')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
})
it('shows correction reasons in history and requires a reason to save', async () => {
  const approved = { ...decided(), undo_expires_at: new Date(Date.now() - 1).toISOString(), decision_history: [{ action: 'leave_request.decision_changed', at: new Date().toISOString(), actor: 'Chels', from: 'declined', to: 'approved', reason: 'Coverage arranged' }] }
  vi.mocked(api.getLeaveRequests).mockResolvedValue(response([approved]))
  vi.mocked(api.changeLeaveDecision).mockResolvedValue({ data: { leave_request: { ...row, version: 2 } } })
  show()
  await screen.findByText('No approved absences this week in this department.')
  fireEvent.click(screen.getByRole('tab', { name: 'Past decisions' }))
  expect(await screen.findByText(/Coverage arranged/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Change decision' }))
  expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Wrong date' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }))
  await waitFor(() => expect(api.changeLeaveDecision).toHaveBeenCalledWith(1, 1, 'pending', 'Wrong date'))
})
it('reports an unavailable roster instead of claiming nobody is off', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue({ error: 'Could not connect' })
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect')
  expect(screen.queryByText('No approved absences this week in this department.')).not.toBeInTheDocument()
})
