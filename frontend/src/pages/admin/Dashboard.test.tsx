import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from './Dashboard'
const mocks = vi.hoisted(() => ({ getWhosWorking: vi.fn(), getPendingApprovals: vi.fn(), getSchedules: vi.fn(), getUsers: vi.fn(), getPayrollBatches: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: 'admin', isClerkEnabled: true }) }))
vi.mock('../../components/time-tracking/WhosWorking', () => ({ default: () => <div>Staffing widget</div> }))
vi.mock('../../components/time-tracking/ClockInOutCard', () => ({ default: () => null }))
function open() { render(<MemoryRouter><Dashboard /></MemoryRouter>) }
describe('Dashboard unavailable snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWhosWorking.mockResolvedValue({ data: { workers: [] } })
    mocks.getPendingApprovals.mockResolvedValue({ data: { count: 3, summary: { total_hours: 10 } } })
    mocks.getSchedules.mockResolvedValue({ data: { schedules: [] } })
    mocks.getUsers.mockResolvedValue({ data: { users: [] } })
    mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [] } })
  })
  it('does not report operational clearance when one endpoint returns an error', async () => {
    mocks.getPendingApprovals.mockResolvedValueOnce({ error: 'Approvals unavailable' })
    open()
    await screen.findByRole('alert')
    expect(screen.queryByText('No approvals are currently waiting.', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText('Active Right Now')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry dashboard snapshot' }))
    await screen.findByText('3 approvals covering 10.00 hours still need review.', { exact: false })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('retains and labels the last successful snapshot if refresh fails', async () => {
    open()
    await screen.findByText('3 approvals covering 10.00 hours still need review.', { exact: false })
    mocks.getPendingApprovals.mockResolvedValue({ error: 'Approvals unavailable' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last successful snapshot')
    expect(screen.getByText('3 approvals covering 10.00 hours still need review.', { exact: false })).toBeInTheDocument()
  })
})
