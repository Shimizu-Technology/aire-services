import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  return render(<MemoryRouter><ToastProvider><LeaveOverview requests={rows} viewerId={4} onChanged={changed} matchesPerson={() => true} matchesDates={() => true} /></ToastProvider></MemoryRouter>)
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
  await screen.findByText('No approved absences this week · All departments.')
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
  expect(screen.getByRole('button', { name: /Undo approval for Ana/ })).toBeInTheDocument()
})
it('shows correction reasons in history and requires a reason to save', async () => {
  const approved = { ...decided(), undo_expires_at: new Date(Date.now() - 1).toISOString(), decision_history: [{ action: 'leave_request.decision_changed', at: new Date().toISOString(), actor: 'Chels', from: 'declined', to: 'approved', reason: 'Coverage arranged' }] }
  vi.mocked(api.getLeaveRequests).mockResolvedValue(response([approved]))
  vi.mocked(api.changeLeaveDecision).mockResolvedValue({ data: { leave_request: { ...row, version: 2 } } })
  show()
  await screen.findByRole('button', { name: /Change decision for Ana/ })
  fireEvent.click(screen.getByRole('button', { name: 'Past decisions' }))
  expect(await screen.findByText(/Coverage arranged/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Change decision for Ana/ }))
  expect(screen.getByRole('button', { name: 'Save decision' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Note for the employee (required)'), { target: { value: 'Please check the new dates with us.' } })
  fireEvent.change(screen.getByLabelText('Internal reason (managers only)'), { target: { value: 'Wrong date' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }))
  await waitFor(() => expect(api.changeLeaveDecision).toHaveBeenCalledWith(1, 1, 'pending', 'Wrong date', 'Please check the new dates with us.'))
})
it('reports an unavailable roster instead of claiming nobody is off', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue({ error: 'Could not connect' })
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect')
  expect(screen.queryByText('No approved absences this week · All departments.')).not.toBeInTheDocument()
})
it('loads only the first history page until Show more and date-filters approved leave', async () => {
  vi.mocked(api.getLeaveRequests).mockImplementation(async (status, page) => status === 'approved' ? response([]) : ({ data: { leave_requests: [{ ...decided(), id: page || 1 }], pagination: { current_page: page || 1, per_page: 25, total_pages: 2, total_count: 26 } } }))
  show()
  await screen.findByText('Just decided')
  expect(api.getLeaveRequests).toHaveBeenCalledWith('approved', 1, 100, undefined, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  expect(api.getLeaveRequests).not.toHaveBeenCalledWith(undefined, 2, 25, 'decisions')
  fireEvent.click(screen.getByRole('button', { name: 'Past decisions' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
  await waitFor(() => expect(api.getLeaveRequests).toHaveBeenCalledWith(undefined, 2, 25, 'decisions'))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument())
})
it('reloads after a sheet conflict and shows a single page alert', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue(response([decided()]))
  vi.mocked(api.changeLeaveDecision).mockResolvedValue({ error: 'Stale', status: 409 })
  show()
  await screen.findByText('Just decided')
  fireEvent.click(screen.getByRole('button', { name: /Change decision for Ana/ }))
  expect(screen.getByText(/Only managers and admins see this reason/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Note for the employee (required)'), { target: { value: 'Please check the new dates with us.' } })
  fireEvent.change(screen.getByLabelText('Internal reason (managers only)'), { target: { value: 'Coverage changed' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save decision' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.getByRole('alert')).toHaveTextContent('This leave request changed')
  expect(changed).toHaveBeenCalled()
})
it('keeps the expired Undo guidance visible and offers no Undo after a correction', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue(response([{ ...decided(), undo_expires_at: new Date(Date.now() - 1).toISOString() }]))
  show()
  expect(await screen.findByText('Undo time is over — use Change decision.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Undo approval/ })).not.toBeInTheDocument()
})

it('replaces Undo with expiry guidance when its single timeout fires', async () => {
  vi.useFakeTimers()
  try {
    vi.mocked(api.getLeaveRequests).mockResolvedValue(response([{ ...decided(), undo_expires_at: new Date(Date.now() + 1000).toISOString() }]))
    await act(async () => { show() })
    expect(screen.getByRole('button', { name: /Undo approval for Ana/ })).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1001) })
    expect(screen.queryByRole('button', { name: /Undo approval for Ana/ })).not.toBeInTheDocument()
    expect(screen.getByText('Undo time is over — use Change decision.')).toBeInTheDocument()
  } finally { vi.useRealTimers() }
})


function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.search}</output><button onClick={() => navigate(-1)}>Browser Back</button></>
}

it.each(['approved', 'past'])('restores %s and the Sunday week from the URL, preserving filters through Back', async (view) => {
  render(<MemoryRouter initialEntries={[`/admin/approvals?kind=leave&dept=cfi&leave_view=${view}&week=2026-11-16`]}>
    <ToastProvider><LeaveOverview requests={[]} viewerId={4} onChanged={changed} matchesPerson={() => true} matchesDates={() => true} /></ToastProvider>
    <LocationProbe />
  </MemoryRouter>)
  expect(screen.getByRole('button', { name: view === 'approved' ? 'Approved' : 'Past decisions' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText(/Sun, Nov 15 – Sat, Nov 21/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
  expect(screen.getByText(/Sun, Nov 22 – Sat, Nov 28/)).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent(`kind=leave&dept=cfi&leave_view=${view}&week=2026-11-22`)
  fireEvent.click(screen.getByRole('button', { name: 'Waiting' }))
  expect(screen.getByTestId('location')).toHaveTextContent('leave_view=waiting')
  fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }))
  expect(screen.getByRole('button', { name: view === 'approved' ? 'Approved' : 'Past decisions' })).toHaveAttribute('aria-pressed', 'true')
})

it('includes Sunday absences and excludes the following Sunday from the roster', async () => {
  vi.mocked(api.getLeaveRequests).mockResolvedValue(response([
    { ...decided(), start_date: '2026-11-15', end_date: '2026-11-15' },
    { ...decided(), id: 2, user: { ...row.user, full_name: 'Next Sunday' }, start_date: '2026-11-22', end_date: '2026-11-22' },
  ]))
  render(<MemoryRouter initialEntries={['/admin/approvals?kind=leave&week=2026-11-15']}><ToastProvider>
    <LeaveOverview requests={[]} viewerId={4} onChanged={changed} matchesPerson={() => true} matchesDates={() => true} />
  </ToastProvider></MemoryRouter>)
  const roster = screen.getByRole('region', { name: 'Who is off this week' })
  await waitFor(() => expect(roster).toHaveTextContent('Ana Rivera'))
  expect(roster).not.toHaveTextContent('Next Sunday')
})
