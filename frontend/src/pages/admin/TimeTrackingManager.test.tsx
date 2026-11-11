vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimeTracking from './TimeTracking'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(), getTimeCategories: vi.fn(), getUsers: vi.fn(),
  getCurrentUser: vi.fn(), getAdminAppSettings: vi.fn(), getPendingApprovals: vi.fn(),
  getClockStatus: vi.fn(), getHoursReport: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isClerkEnabled: true, userRole: 'manager' }) }))
vi.mock('../../components/time-tracking/WhosWorking', () => ({ default: () => <div>Who is working</div> }))

const manager = {
  id: 1, role: 'manager', is_admin: false,
  capabilities: { approve_time: true, manage_team_time: true, approve_leave: true, unlock_kiosk: true, export_hours_reports: true, send_pay_statements: true,
    manage_settings: false, manage_users: false, manage_payroll: false, manage_schedules: false, manage_site: false, view_activity: false, preview_pay: false, manage_my_pay_access: false },
}

const report = {
  start_date: '2026-11-01', end_date: '2026-11-15', context_start_date: '2026-11-01', context_end_date: '2026-11-15',
  ready: true, employees: [], breakdowns: { by_category: [], by_source: [] },
  quality: { status: 'clear', missing_category_count: 0, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 },
  summary: { total_hours: 0, regular_hours: 0, overtime_hours: 0, break_hours: 0, entries_count: 0, employee_count: 0,
    pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0, payroll_statuses: {} },
}

function openPage(query: string) {
  return render(<MemoryRouter initialEntries={['/admin/time' + query]}><TimeTracking /></MemoryRouter>)
}

describe('TimeTracking for a manager', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach(mock => mock.mockReset())
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [
      { id: 1, full_name: 'Roke Manager', display_name: 'Roke', email: 'roke@example.test', role: 'manager' },
      { id: 2, full_name: 'Ana Worker', display_name: 'Ana', email: 'ana@example.test', role: 'employee' },
    ], approval_groups: [{ key: 'cfi', label: 'CFI' }] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: manager } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getClockStatus.mockResolvedValue({ data: { clocked_in: false, time_tracking_enabled: false, can_clock_in: false } })
    apiMock.getHoursReport.mockResolvedValue({ data: report })
  })

  it('works the team timecards, with approvals, reports and payroll left to the navigation', async () => {
    openPage('?date=2026-11-01&view=day')
    expect(await screen.findByRole('heading', { level: 1, name: 'Timecards' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('All Employees')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Approval types' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Payroll' })).not.toBeInTheDocument()
    expect(screen.getByText('Who is working')).toBeInTheDocument()
  })

  it('makes the manager choose who worked rather than logging time as themselves', async () => {
    openPage('?date=2026-11-01&view=day')
    const logTime = await screen.findByRole('button', { name: 'Log Time' })
    await waitFor(() => expect(logTime).toBeEnabled())
    fireEvent.click(logTime)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Entry Owner')).toHaveValue('')
    expect(within(dialog).getByRole('option', { name: 'Choose who worked…' })).toBeInTheDocument()
  })

  it('pre-selects the filtered person as the entry owner', async () => {
    openPage('?date=2026-11-01&view=day&user_id=2')
    const logTime = await screen.findByRole('button', { name: 'Log Time' })
    await waitFor(() => expect(logTime).toBeEnabled())
    fireEvent.click(logTime)
    expect(within(await screen.findByRole('dialog')).getByLabelText('Entry Owner')).toHaveValue('2')
  })

  it('takes department labels from the staff list instead of admin Settings', async () => {
    openPage('?tab=approvals')
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalled())
    expect(apiMock.getAdminAppSettings).not.toHaveBeenCalled()
  })

  it('exports hours without offering the payroll cutoff', async () => {
    openPage('?tab=reports&start_date=2026-11-01&end_date=2026-11-15')
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalled())
    expect(await screen.findByText('Live hours, not a finalized payroll record')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Prepare payroll cutoff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open payroll cutoffs' })).not.toBeInTheDocument()
  })
})
