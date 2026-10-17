import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimeTracking from './TimeTracking'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(), getTimeCategories: vi.fn(), getUsers: vi.fn(),
  getCurrentUser: vi.fn(), getAdminAppSettings: vi.fn(), getPendingApprovals: vi.fn(),
  getClockStatus: vi.fn(), getHoursReport: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin' }) }))
vi.mock('../../components/time-tracking/WhosWorking', () => ({ default: () => null }))

function Harness() {
  const location = useLocation()
  return <><output data-testid="search">{location.search}</output><TimeTracking /></>
}
function openPage(query = '?date=2026-11-01&view=day&user_id=2') {
  return render(<MemoryRouter initialEntries={['/admin/time' + query]}><Harness /></MemoryRouter>)
}

describe('TimeTracking admin review context', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach(mock => mock.mockReset())
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [
      { id: 1, full_name: 'Synthetic Authority', display_name: 'Synthetic', email: 'authority@example.test' },
      { id: 2, full_name: 'Synthetic Employee', display_name: 'Synthetic', email: 'employee@example.test' },
      { id: 3, display_name: 'Casey', email: 'casey@example.test', employment_status: 'inactive' },
    ] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getClockStatus.mockResolvedValue({ data: { clocked_in: false, time_tracking_enabled: false, can_clock_in: false } })
  })

  it('distinguishes identical display names while preserving employee IDs and filters', async () => {
    openPage()
    const employee = await screen.findByDisplayValue('Synthetic Employee')
    expect(within(employee).getByRole('option', { name: 'Synthetic Authority' })).toHaveValue('1')
    expect(within(employee).getByRole('option', { name: 'Synthetic Employee' })).toHaveValue('2')
    expect(within(employee).getByRole('option', { name: 'Casey (inactive)' })).toHaveValue('3')
    fireEvent.change(employee, { target: { value: '1' } })
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 1, date: '2026-11-01' })))
    expect(screen.getByTestId('search')).toHaveTextContent('user_id=1')
    expect(screen.getByTestId('search')).toHaveTextContent('view=day')
  })

  it('does not show the administrator personal clock notice while reviewing another employee', async () => {
    openPage()
    await screen.findByDisplayValue('Synthetic Employee')
    await waitFor(() => expect(apiMock.getClockStatus).toHaveBeenCalled())
    expect(screen.queryByText('Time tracking is not enabled')).not.toBeInTheDocument()
    expect(screen.queryByText(/Your account does not require clock-ins/)).not.toBeInTheDocument()
  })

  it('shows the personal notice for an explicit self review and hides it after selecting someone else', async () => {
    openPage('?date=2026-11-01&view=day&user_id=1')
    expect(await screen.findByText('Time tracking is not enabled')).toBeVisible()
    fireEvent.change(await screen.findByDisplayValue('Synthetic Authority'), { target: { value: '2' } })
    await waitFor(() => expect(screen.queryByText('Time tracking is not enabled')).not.toBeInTheDocument())
  })

  it('keeps the disabled-clock explanation on an employee personal view', async () => {
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 2, is_admin: false } } })
    openPage('?date=2026-11-01&view=day')
    expect(await screen.findByText('Time tracking is not enabled')).toBeVisible()
  })

  it('reports accounting-correction entries separately from paid entries', async () => {
    apiMock.getHoursReport.mockResolvedValue({ data: {
      start_date: '2026-11-01', end_date: '2026-11-15', context_start_date: '2026-11-01', context_end_date: '2026-11-15',
      ready: true, employees: [], breakdowns: { by_category: [], by_source: [] },
      quality: { status: 'clear', missing_category_count: 0, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 },
      summary: { total_hours: 3, regular_hours: 3, overtime_hours: 0, break_hours: 0, entries_count: 1, employee_count: 1,
        pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0,
        uncategorized_count: 0, payroll_statuses: { accounting_correction_committed: 1, payment_issued: 0, committed: 0 } },
    } })
    openPage('?tab=reports&start_date=2026-11-01&end_date=2026-11-15&user_id=2')
    const summary = await screen.findByRole('region', { name: 'Payroll lifecycle' })
    expect(within(summary).getByText('Accounting corrections').parentElement).toHaveTextContent('1')
    expect(within(summary).getByText('Paid').parentElement).toHaveTextContent('0')
    expect(within(summary).getByText('In payroll').parentElement).toHaveTextContent('0')
    expect(within(summary).getByText(/Accounting corrections are recorded entries, not payments/)).toBeVisible()
  })
})
