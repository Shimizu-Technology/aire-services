vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from './Dashboard'
const mocks = vi.hoisted(() => ({ getWhosWorking: vi.fn(), getPendingApprovals: vi.fn(), getSchedules: vi.fn(), getUsers: vi.fn(), getPayrollBatches: vi.fn(), getPayrollCutoff: vi.fn(), getMySchedule: vi.fn(), getTimeEntries: vi.fn(), role: 'admin' }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: mocks.role, isClerkEnabled: true }) }))
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
    mocks.role = 'admin'
    mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [] } })
    mocks.getPayrollCutoff.mockResolvedValue({ data: { cutoff: { period: null, stage: 'none' } } })
  })
  it.each(['finalizing', 'passed', 'none'])("keeps the locked period during %s rather than today's period", async stage => {
    mocks.getPayrollCutoff.mockResolvedValue({ data: { preparation_period: stage === 'finalizing' ? { id: 9, start_date: '2026-10-16', end_date: '2026-10-31' } : null, cutoff: { period: { id: 9, start_date: '2026-10-16', end_date: '2026-10-31' }, stage } } })
    mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: stage === 'finalizing' ? [] : [{ id: 'test', start_date: '2026-10-16', end_date: '2026-10-31', finalized_at: '2026-11-07T07:00:00Z', processing: { status: 'payment_prepared' } }] } })
    open()
    expect(await screen.findByRole('heading', { name: 'Oct 16, 2026–Oct 31, 2026' })).toBeInTheDocument()
    for (const link of screen.getAllByRole('link', { name: /Prepare Payroll|Prepare payroll cutoff/ })) {
      expect(link).toHaveAttribute('href', '/admin/payroll?start_date=2026-10-16&end_date=2026-10-31')
    }
    expect(mocks.getPendingApprovals).toHaveBeenCalledWith({ start_date: '2026-10-16', end_date: '2026-10-31', per_page: 1 })
    expect(screen.getByRole('link', { name: 'Review approvals' })).toHaveAttribute('href', '/admin/time?start_date=2026-10-16&end_date=2026-10-31&tab=approvals')
  })

  it('keeps a latest batch being processed even when no reminder period is returned', async () => {
    mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [{ id: 'test', start_date: '2026-10-16', end_date: '2026-10-31', finalized_at: '2026-11-07T07:00:00Z', processing: { status: 'imported' } }] } })
    open()
    expect(await screen.findByRole('heading', { name: 'Oct 16, 2026–Oct 31, 2026' })).toBeInTheDocument()
  })

  it('uses the current period after the latest published batch has been paid', async () => {
    mocks.getPayrollCutoff.mockResolvedValue({ data: { cutoff: { period: { id: 9, start_date: '2026-10-16', end_date: '2026-10-31' }, stage: 'none' } } })
    mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [{ id: 'test', start_date: '2026-10-16', end_date: '2026-10-31', finalized_at: '2026-11-07T07:00:00Z', processing: { status: 'payment_issued' } }] } })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-08T00:00:00Z'))
    try {
      open()
      expect(await screen.findByRole('heading', { name: 'Nov 1, 2026–Nov 15, 2026' })).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })

  it('prepares the published period even days before its reminder begins', async () => {
    mocks.getPayrollCutoff.mockResolvedValue({ data: { preparation_period: { id: 2, start_date: '2026-11-01', end_date: '2026-11-15' }, cutoff: { period: null, stage: 'none' } } })
    open()
    expect(await screen.findByRole('heading', { name: 'Nov 1, 2026–Nov 15, 2026' })).toBeInTheDocument()
    expect(mocks.getPendingApprovals).toHaveBeenCalledWith({ start_date: '2026-11-01', end_date: '2026-11-15', per_page: 1 })
    expect(screen.getByRole('link', { name: 'Prepare payroll cutoff' })).toHaveAttribute('href', '/admin/payroll?start_date=2026-11-01&end_date=2026-11-15')
  })

  it('uses today while paused even with a committed old batch and failed attention', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-02T00:00:00Z'))
    mocks.getPayrollCutoff.mockResolvedValue({ data: { connected_payroll: { enabled: false }, attention: { period: { start_date: '2026-10-16', end_date: '2026-10-31' } }, cutoff: { period: null, stage: 'none' } } })
    mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [{ start_date: '2026-10-16', end_date: '2026-10-31', finalized_at: '2026-11-07T07:00:00Z', processing: { status: 'committed' } }] } })
    try {
      open()
      expect(await screen.findByRole('heading', { name: 'Dec 1, 2026–Dec 15, 2026' })).toBeInTheDocument()
      expect(mocks.getPendingApprovals).toHaveBeenCalledWith({ start_date: '2026-12-01', end_date: '2026-12-15', per_page: 1 })
    } finally { vi.useRealTimers() }
  })

  it('requests the employee activity for Guam today after month end', async () => {
    mocks.role = 'employee'
    mocks.getMySchedule.mockResolvedValue({ data: { schedules: [] } })
    mocks.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-31T14:30:00Z'))
    try {
      open()
      await waitFor(() => expect(mocks.getTimeEntries).toHaveBeenCalledWith({ date: '2026-11-01', per_page: 20 }))
    } finally {
      mocks.role = 'admin'
      vi.useRealTimers()
    }
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
  it('gives a manager the approvals picture without the payroll workspace', async () => {
    mocks.role = 'manager'
    try {
      open()
      expect(await screen.findByText('Approvals this pay period')).toBeInTheDocument()
      expect(mocks.getPayrollBatches).not.toHaveBeenCalled()
      expect(screen.queryByRole('link', { name: /Prepare Payroll|Prepare payroll cutoff/ })).not.toBeInTheDocument()
      expect(screen.getAllByRole('link', { name: 'Review Approvals' })[0].getAttribute('href')).toContain('tab=approvals')
      expect(screen.getAllByRole('link', { name: 'View Schedule' }).length).toBeGreaterThan(0)
      const actions = screen.getByRole('heading', { name: 'Action Center' }).closest('section') as HTMLElement
      const titles = Array.from(actions.querySelectorAll('h3')).map((heading) => heading.textContent)
      expect(titles).toEqual(['Time & Payroll', 'Pending Approvals', 'Leave Requests', 'Hours Reports'])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      mocks.role = 'admin'
    }
  })

  it('keeps the full action center for an owner', async () => {
    mocks.role = 'owner'
    try {
      open()
      expect(await screen.findByText('Payroll readiness')).toBeInTheDocument()
      expect(mocks.getPayrollBatches).toHaveBeenCalled()
      const actions = screen.getByRole('heading', { name: 'Action Center' }).closest('section') as HTMLElement
      expect(actions.querySelectorAll('h3')).toHaveLength(7)
    } finally {
      mocks.role = 'admin'
    }
  })
})
