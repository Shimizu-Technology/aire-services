vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard, { MyTimeHome } from './Dashboard'
vi.mock('./Today', () => ({ default: () => <h1>Today page</h1> }))
const mocks = vi.hoisted(() => ({ getWhosWorking: vi.fn(), getPendingApprovals: vi.fn(), getSchedules: vi.fn(), getUsers: vi.fn(), getPayrollBatches: vi.fn(), getPayrollCutoff: vi.fn(), getMySchedule: vi.fn(), getTimeEntries: vi.fn(), role: 'manager', schedulesEnabled: false }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: mocks.role, isClerkEnabled: true, currentUser: { id: 9, schedules_enabled: mocks.schedulesEnabled } }) }))
vi.mock('../../components/time-tracking/WhosWorking', () => ({ default: () => <div>Staffing widget</div> }))
vi.mock('../../components/time-tracking/ClockInOutCard', () => ({ default: () => null }))
function open() { render(<MemoryRouter><Dashboard /></MemoryRouter>) }
describe('Dashboard unavailable snapshots (manager view)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWhosWorking.mockResolvedValue({ data: { workers: [] } })
    mocks.getPendingApprovals.mockResolvedValue({ data: { count: 3, summary: { total_hours: 10 } } })
    mocks.getSchedules.mockResolvedValue({ data: { schedules: [] } })
    mocks.getUsers.mockResolvedValue({ data: { users: [] } })
    mocks.role = 'manager'
    mocks.getPayrollBatches.mockResolvedValue({ data: { payroll_batches: [] } })
    mocks.getPayrollCutoff.mockResolvedValue({ data: { cutoff: { period: null, stage: 'none' } } })
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
      mocks.role = 'manager'
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
      mocks.role = 'manager'
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

})

describe('Dashboard route split', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWhosWorking.mockResolvedValue({ data: { workers: [] } })
    mocks.getPendingApprovals.mockResolvedValue({ data: { count: 0, summary: { total_hours: 0 } } })
    mocks.getUsers.mockResolvedValue({ data: { users: [] } })
    mocks.getPayrollCutoff.mockResolvedValue({ data: { cutoff: { period: null, stage: 'none' } } })
    mocks.getMySchedule.mockResolvedValue({ data: { schedules: [] } })
    mocks.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
  })

  it.each(['owner', 'admin'])('shows Today to an %s', async role => {
    mocks.role = role
    try {
      open()
      expect(await screen.findByRole('heading', { name: 'Today page' })).toBeInTheDocument()
      expect(screen.queryByText('Active Right Now')).not.toBeInTheDocument()
    } finally {
      mocks.role = 'manager'
    }
  })

  it('keeps the manager view as it was', async () => {
    open()
    expect(await screen.findByText('Approvals this pay period')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Today page' })).not.toBeInTheDocument()
  })

  it('keeps My Time for an employee', async () => {
    mocks.role = 'employee'
    try {
      open()
      expect(await screen.findByRole('heading', { level: 1, name: 'My Time' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Today page' })).not.toBeInTheDocument()
    } finally {
      mocks.role = 'manager'
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
      mocks.role = 'manager'
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
      mocks.role = 'manager'
      mocks.schedulesEnabled = false
    }
  })
})
