vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard, { MyTimeHome } from './Dashboard'
const mocks = vi.hoisted(() => ({ getWhosWorking: vi.fn(), getPendingApprovals: vi.fn(), getSchedules: vi.fn(), getUsers: vi.fn(), getPayrollBatches: vi.fn(), getPayrollCutoff: vi.fn(), getMySchedule: vi.fn(), getTimeEntries: vi.fn(), role: 'admin', schedulesEnabled: false }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: mocks.role, isClerkEnabled: true, currentUser: { id: 9, schedules_enabled: mocks.schedulesEnabled } }) }))
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
    expect(screen.getByRole('link', { name: 'Review approvals' })).toHaveAttribute('href', '/admin/approvals?start_date=2026-10-16&end_date=2026-10-31')
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
  it('counts people still clocked in from an earlier day as active', async () => {
    mocks.getWhosWorking.mockResolvedValue({ data: { workers: [
      { user: { id: 1 }, status: 'clocked_in', open_since_work_date: '2026-11-10', open_entry_id: 5 },
      { user: { id: 2 }, status: 'on_break', open_since_work_date: null },
      { user: { id: 3 }, status: 'clocked_out' },
    ] } })
    open()
    const card = (await screen.findByText('Active Right Now')).parentElement as HTMLElement
    expect(card).toHaveTextContent('2')
    expect(card).toHaveTextContent('Includes 1 still clocked in from an earlier day')
    expect(screen.getByText('Shifts and overtime waiting for approval')).toBeInTheDocument()
    expect(screen.queryByText(/Manual entries or overtime/)).not.toBeInTheDocument()
  })

  it('gives a manager the approvals picture without the payroll workspace', async () => {
    mocks.role = 'manager'
    try {
      open()
      expect(await screen.findByText('Approvals this pay period')).toBeInTheDocument()
      expect(mocks.getPayrollBatches).not.toHaveBeenCalled()
      expect(screen.queryByRole('link', { name: /Prepare Payroll|Prepare payroll cutoff/ })).not.toBeInTheDocument()
      expect(screen.getAllByRole('link', { name: 'Review Approvals' })[0].getAttribute('href')).toMatch(/^\/admin\/approvals\?/)
      // "Use schedules" is off, so nothing points at the Schedule page.
      expect(screen.queryByRole('link', { name: 'View Schedule' })).not.toBeInTheDocument()
      const actions = screen.getByRole('heading', { name: 'Action Center' }).closest('section') as HTMLElement
      const titles = Array.from(actions.querySelectorAll('h3')).map((heading) => heading.textContent)
      expect(titles).toEqual(['Timecards', 'Pending Approvals', 'Leave Requests', 'Hours Reports'])
      expect(within(actions).getByRole('link', { name: /Timecards/ })).toHaveAttribute('href', '/admin/timecards')
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
      expect(actions.querySelectorAll('h3')).toHaveLength(5)
      expect(within(actions).queryByRole('heading', { name: 'Schedule' })).not.toBeInTheDocument()
      expect(within(actions).getByRole('heading', { name: 'Team' })).toBeInTheDocument()
      expect(within(actions).queryByRole('heading', { name: 'Users' })).not.toBeInTheDocument()
      // One way to payroll: the readiness card, not the header or the Action Center.
      expect(screen.getAllByRole('link', { name: /^(prepare payroll|payroll cutoffs)/i }).map((link) => link.textContent)).toEqual(['Prepare payroll cutoff'])
    } finally {
      mocks.role = 'admin'
    }
  })

  it('skips schedules and their cards while "Use schedules" is off', async () => {
    open()
    expect(await screen.findByText('Active Right Now')).toBeInTheDocument()
    expect(mocks.getSchedules).not.toHaveBeenCalled()
    expect(screen.queryByText('Scheduled Today')).not.toBeInTheDocument()
    expect(screen.queryByText('Weekly Scheduled Hours')).not.toBeInTheDocument()
  })

  it('shows schedule cards when "Use schedules" is on, and a schedule failure leaves the snapshot up', async () => {
    mocks.schedulesEnabled = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T00:00:00Z'))
    mocks.getSchedules.mockResolvedValueOnce({ data: { schedules: [
      { work_date: '2026-11-10', hours: 8 },
      { work_date: '2026-11-11', hours: 4.5 },
    ] } })
    try {
      open()
      const today = (await screen.findByText('Scheduled Today')).parentElement as HTMLElement
      expect(mocks.getSchedules).toHaveBeenCalledTimes(1)
      expect(within(today).getByText('1')).toBeInTheDocument()
      expect((screen.getByText('Weekly Scheduled Hours').parentElement as HTMLElement)).toHaveTextContent('12.5h')

      mocks.getSchedules.mockResolvedValueOnce({ error: 'Schedules unavailable' })
      fireEvent.click(screen.getByRole('button', { name: 'Refresh snapshot' }))
      await waitFor(() => expect(mocks.getSchedules).toHaveBeenCalledTimes(2))
      await waitFor(() => expect((screen.getByText('Scheduled Today').parentElement as HTMLElement)).toHaveTextContent('—'))
      expect(screen.getByText('Weekly Scheduled Hours').parentElement as HTMLElement).toHaveTextContent('—')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText('3 approvals covering 10.00 hours still need review.', { exact: false })).toBeInTheDocument()
    } finally {
      mocks.schedulesEnabled = false
      vi.useRealTimers()
    }
  })

  it('brings Schedule back when "Use schedules" is on', async () => {
    mocks.role = 'owner'
    mocks.schedulesEnabled = true
    try {
      open()
      expect(await screen.findByText('Payroll readiness')).toBeInTheDocument()
      const actions = screen.getByRole('heading', { name: 'Action Center' }).closest('section') as HTMLElement
      expect(actions.querySelectorAll('h3')).toHaveLength(6)
      expect(screen.getAllByRole('link', { name: 'Adjust Schedule' }).length).toBeGreaterThan(0)
    } finally {
      mocks.role = 'admin'
      mocks.schedulesEnabled = false
    }
  })
})

describe('My Time', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMySchedule.mockResolvedValue({ data: { schedules: [] } })
    mocks.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
  })

  it.each([
    ['employee', '/admin/my-hours'],
    ['manager', '/admin/timecards?user_id=9'],
  ])('links a %s to their own hours and leave, without schedules while they are off', async (role, hoursHref) => {
    mocks.role = role
    try {
      render(<MemoryRouter><MyTimeHome /></MemoryRouter>)
      expect(screen.getByRole('heading', { level: 1, name: 'My Time' })).toBeInTheDocument()
      expect(await screen.findByRole('link', { name: /My Hours/ })).toHaveAttribute('href', hoursHref)
      expect(screen.getByRole('link', { name: /Request Leave/ })).toHaveAttribute('href', '/admin/leave')
      expect(screen.queryByRole('heading', { name: 'My Upcoming Schedule' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Full Schedule/ })).not.toBeInTheDocument()
      await waitFor(() => expect(mocks.getTimeEntries).toHaveBeenCalled())
      expect(mocks.getMySchedule).not.toHaveBeenCalled()
    } finally {
      mocks.role = 'admin'
    }
  })

  it('shows upcoming shifts and the full schedule when schedules are on', async () => {
    mocks.role = 'employee'
    mocks.schedulesEnabled = true
    try {
      render(<MemoryRouter><MyTimeHome /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'My Upcoming Schedule' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Full Schedule/ })).toHaveAttribute('href', '/admin/schedule')
      expect(mocks.getMySchedule).toHaveBeenCalledTimes(1)
    } finally {
      mocks.role = 'admin'
      mocks.schedulesEnabled = false
    }
  })
})
