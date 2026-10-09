import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TimeTracking from './TimeTracking'
import type { HoursReportEntry, HoursReportResponse } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  getTimeEntry: vi.fn(),
  getTimeEntries: vi.fn(),
  getTimeCategories: vi.fn(),
  getUsers: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getPendingApprovals: vi.fn(),
  getHoursReport: vi.fn(),
  updateTimeEntry: vi.fn(),
}))

vi.mock('../../lib/api', () => ({ api: apiMock }))

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ isClerkEnabled: true, userRole: 'admin' }),
}))

function TimeRouteHarness() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <>
      <button type="button" onClick={() => navigate('/admin/time?tab=reports&start_date=2026-07-01&end_date=2026-07-15')}>Open July report</button>
      <button type="button" onClick={() => navigate('/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15&approval_status=denied&overtime_status=denied')}>Open denied report</button>
      <button type="button" onClick={() => navigate('/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15&status=terminated')}>Open terminated report</button>
      <button type="button" onClick={() => navigate('/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15&user_id=7&approval_group=maintenance&role=employee&clock_source=kiosk&entry_method=clock')}>Open filtered report</button>
      <button type="button" onClick={() => navigate(location.pathname + location.search + '&context=changed')}>Change unrelated context</button>
      <output data-testid="location-search">{location.search}</output>
      <TimeTracking />
    </>
  )
}

function makeHoursReport(startDate: string, endDate: string, totalHours: number): HoursReportResponse {
  return {
    start_date: startDate,
    end_date: endDate,
    context_start_date: startDate,
    context_end_date: endDate,
    generated_at: '2026-08-31T00:00:00Z',
    ready: true,
    quality: { status: 'clear', missing_category_count: 0, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 },
    filters: {},
    summary: {
      employee_count: 0,
      total_hours: totalHours,
      regular_hours: totalHours,
      overtime_hours: 0,
      break_hours: 0,
      entries_count: 0,
      pending_count: 0,
      denied_count: 0,
      pending_overtime_count: 0,
      denied_overtime_count: 0,
      open_clock_count: 0,
      uncategorized_count: 0,
    },
    breakdowns: { by_category: [], by_source: [] },
    employees: [],
  }
}

describe('TimeTracking routed report periods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getHoursReport.mockResolvedValue({ error: 'No report rows in this test' })
  })

  it.each(['day', 'week'])('shows loaded %s entries before animation timers run', async (view) => {
    vi.useFakeTimers()
    try {
      apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [{
        id: 91, work_date: '2026-10-01', hours: 8.25, user: { id: 7, full_name: 'Casey' },
        description: 'Recorded operational work', approval_status: 'approved',
        formatted_start_time: '8:00 AM', formatted_end_time: '4:15 PM',
        time_category: { id: 3, name: 'Operations' },
      }] } })
      // Resolve the data load without advancing entrance-animation timers.
      await act(async () => {
        render(<MemoryRouter initialEntries={[`/admin/time?date=2026-10-01&view=${view}`]}><TimeRouteHarness /></MemoryRouter>)
      })
      expect(screen.getByText('8.25h')).toBeVisible()
      expect(screen.getByText('Casey')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for employee options before opening the exact scheduled employee', async () => {
    let resolveUsers!: (value: unknown) => void
    apiMock.getUsers.mockReturnValue(new Promise((resolve) => { resolveUsers = resolve }))
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [{ id: 3, name: 'Operations' }] } })
    apiMock.getSchedule.mockResolvedValue({ data: { schedule: {
      id: 9, user_id: 7, work_date: '2026-10-06', start_time: '09:00', end_time: '17:00', formatted_time_range: '9:00 AM - 5:00 PM',
    } } })
    render(<MemoryRouter initialEntries={['/admin/time?prefill=true&schedule_id=9&user_id=7&start_date=2026-10-01&end_date=2026-10-15']}><TimeRouteHarness /></MemoryRouter>)
    expect(screen.getByTestId('location-search')).toHaveTextContent('prefill=true')
    expect(apiMock.getSchedule).not.toHaveBeenCalled()
    await act(async () => { resolveUsers({ data: { users: [{ id: 7, email: 'casey@example.test', display_name: 'Casey', time_category_ids: [3] }] } }) })
    await waitFor(() => expect(screen.getByLabelText('Entry Owner')).toHaveValue('7'))
    expect(screen.getByLabelText('Work category')).toHaveValue('3')
    expect(screen.getByDisplayValue('09:00')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('prefill=true')
    expect(screen.getByTestId('location-search')).toHaveTextContent('start_date=2026-10-01')
    expect(screen.getByTestId('location-search')).toHaveTextContent('user_id=7')
  })

  it('keeps one shift request when unrelated URL context changes while loading', async () => {
    let resolveShift!: (value: unknown) => void
    apiMock.getUsers.mockResolvedValue({ data: { users: [{ id: 7, email: 'casey@example.test', display_name: 'Casey' }] } })
    apiMock.getSchedule.mockReturnValue(new Promise((resolve) => { resolveShift = resolve }))
    render(<MemoryRouter initialEntries={['/admin/time?prefill=true&schedule_id=9&user_id=7']}><TimeRouteHarness /></MemoryRouter>)
    await waitFor(() => expect(apiMock.getSchedule).toHaveBeenCalledTimes(1))
    screen.getAllByRole('button', { name: '+ Add' }).forEach(button => expect(button).toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Change unrelated context' }))
    expect(apiMock.getSchedule).toHaveBeenCalledTimes(1)
    await act(async () => { resolveShift({ data: { schedule: { id: 9, user_id: 7, work_date: '2026-10-06', start_time: '09:00', end_time: '17:00', formatted_time_range: '9:00 AM - 5:00 PM' } } }) })
    await waitFor(() => expect(screen.getByLabelText('Entry Owner')).toHaveValue('7'))
    expect(screen.getByTestId('location-search')).toHaveTextContent('context=changed')
    expect(apiMock.getSchedule).toHaveBeenCalledTimes(1)
  })

  it('retains a failed shift link and retries without substituting the administrator', async () => {
    apiMock.getUsers.mockResolvedValue({ data: { users: [{ id: 7, email: 'casey@example.test', display_name: 'Casey', time_category_ids: [] }] } })
    apiMock.getSchedule.mockResolvedValueOnce({ error: 'Shift temporarily unavailable' }).mockResolvedValueOnce({ data: { schedule: {
      id: 9, user_id: 7, work_date: '2026-10-06', start_time: '09:00', end_time: '17:00', formatted_time_range: '9:00 AM - 5:00 PM',
    } } })
    render(<MemoryRouter initialEntries={['/admin/time?prefill=true&schedule_id=9&user_id=7']}><TimeRouteHarness /></MemoryRouter>)
    await screen.findByText('Shift temporarily unavailable')
    expect(screen.getByTestId('location-search')).toHaveTextContent('schedule_id=9')
    expect(screen.queryByRole('heading', { name: 'Log Time' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry scheduled shift' }))
    await waitFor(() => expect(screen.getByLabelText('Entry Owner')).toHaveValue('7'))
    expect(apiMock.getSchedule).toHaveBeenCalledTimes(2)
  })

  it('refuses a shift whose owner no longer matches the link', async () => {
    apiMock.getUsers.mockResolvedValue({ data: { users: [{ id: 7, email: 'casey@example.test', display_name: 'Casey' }] } })
    apiMock.getSchedule.mockResolvedValue({ data: { schedule: { id: 9, user_id: 8 } } })
    render(<MemoryRouter initialEntries={['/admin/time?prefill=true&schedule_id=9&user_id=7']}><TimeRouteHarness /></MemoryRouter>)
    await screen.findByText('The shift employee has changed or is unavailable to your account. Open Schedule again.')
    expect(screen.queryByRole('heading', { name: 'Log Time' })).not.toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('prefill=true')
  })

  it('loads the exact original entry independently of the current page and returns to the same review', async () => {
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: { id: 90, work_date: '2026-08-20', hours: 8, user: { id: 7, full_name: 'Casey' }, description: 'Original evidence', approval_status: 'approved' } } })
    render(<MemoryRouter initialEntries={['/admin/time?user_id=7&entry_id=90&date=2026-08-20&view=day&return_to=%2Fadmin%2Fusers%2F7%3Ftab%3Dhours%26period%3D2026-08-16']}><TimeRouteHarness /></MemoryRouter>)
    await screen.findByRole('region', { name: 'Linked time entry' })
    expect(apiMock.getTimeEntry).toHaveBeenCalledWith(90)
    expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-08-20', per_page: 100, page: 1 }))
    expect(screen.getByRole('link', { name: 'Back to employee review' })).toHaveAttribute('href', '/admin/users/7?tab=hours&period=2026-08-16')
    expect(screen.getByText('Original evidence')).toBeInTheDocument()
  })

  it('refuses an exact entry owned by a different employee', async () => {
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: { id: 90, work_date: '2026-08-20', hours: 8, user: { id: 99 }, description: 'Foreign evidence' } } })
    render(<MemoryRouter initialEntries={['/admin/time?user_id=7&entry_id=90&date=2026-08-20&view=day']}><TimeRouteHarness /></MemoryRouter>)
    await screen.findByText('The linked entry does not match the selected employee. Return to the employee review.')
    expect(screen.queryByText('Foreign evidence')).not.toBeInTheDocument()
  })

  it('shows full filtered totals and pages bounded entry rows through the URL', async () => {
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [], pagination: { current_page: 1, per_page: 100, total_count: 201, total_pages: 3 }, summary: { entry_count: 201, total_hours: 602.5, total_break_hours: 0 } } })
    render(<MemoryRouter initialEntries={['/admin/time?user_id=7&date=2026-08-20&view=day']}><TimeRouteHarness /></MemoryRouter>)
    await screen.findByText(/201 entries · 602.50h/)
    fireEvent.click(screen.getByRole('button', { name: 'Next entries' }))
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ page: 2, per_page: 100, user_id: 7 })))
    expect(screen.getByTestId('location-search')).toHaveTextContent('entries_page=2')
    expect(screen.getByTestId('location-search')).toHaveTextContent('date=2026-08-20')
  })

  it.each(['included', 'excluded'])('resubmits an %s report row using its current nonzero version', async (location) => {
    const report = makeHoursReport('2026-08-01', '2026-08-15', 0)
    const row: HoursReportEntry = {
      id: 90, version: 7, work_date: '2026-08-05', start_time: '08:00', end_time: '12:00',
      formatted_start_time: '8:00 AM', formatted_end_time: '12:00 PM', total_hours: 4, regular_hours: 0,
      overtime_hours: 0, break_minutes: 0, description: 'Denied source facts', entry_method: 'manual',
      clock_source: null, approval_status: 'denied', approved_by: null, approved_at: null,
      overtime_status: 'none', time_category: { id: 3, name: 'Operations' }, breaks: [], quality_flags: [],
    }
    report.employees = [{
      id: 7, email: 'casey@example.test', first_name: 'Casey', last_name: 'Employee', display_name: 'Casey Employee',
      full_name: 'Casey Employee', role: 'employee', is_intern: false, status: 'active', terminated_at: null,
      termination_effective_on: null, total_hours: 0, regular_hours: 0, overtime_hours: 0, break_hours: 0,
      entries_count: 1, days_worked: 1, first_work_date: row.work_date, last_work_date: row.work_date, ready: true,
      issues: { pending_count: 0, denied_count: 1, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0 },
      quality: report.quality, categories: [], weeks: [],
      days: location === 'included' ? [{ work_date: row.work_date, total_hours: 4, regular_hours: 0, overtime_hours: 0, break_hours: 0, entries: [row] }] : [],
      excluded_entries: location === 'excluded' ? [row] : [],
    }]
    apiMock.getHoursReport.mockResolvedValue({ data: report })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [{ id: 3, name: 'Operations' }] } })
    apiMock.updateTimeEntry.mockResolvedValue({ data: { time_entry: {} } })
    render(<MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}><TimeRouteHarness /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /^Edit$/ }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Time Entry' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Submit denied time for review' }))
    expect(within(dialog).getByLabelText('End Time *')).toHaveValue('12:00')
    expect(within(dialog).getByLabelText('End Time *')).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Correction reason *'), { target: { value: 'Request separate review' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(90,
      { review_action: 'resubmit_denied', expected_version: 7 }, 'Request separate review'))
  })

  it('synchronizes report requests when same-route payroll dates change', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-08-01',
      end_date: '2026-08-15',
    })))

    fireEvent.click(screen.getByRole('button', { name: 'Open July report' }))

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-07-01',
      end_date: '2026-07-15',
    })))
  })

  it('defaults historical reports to every employment status and provides quick periods', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' })))
    expect(screen.getByDisplayValue('All statuses')).toBeInTheDocument()

    const guamDateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Pacific/Guam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).reduce<Record<string, string>>((parts, part) => {
      if (part.type !== 'literal') parts[part.type] = part.value
      return parts
    }, {})
    const guamToday = `${guamDateParts.year}-${guamDateParts.month}-${guamDateParts.day}`

    fireEvent.click(screen.getByRole('button', { name: 'Year to date' }))
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      start_date: `${guamDateParts.year}-01-01`,
      end_date: guamToday,
      status: 'all',
    })))
    expect(screen.getByTestId('location-search')).toHaveTextContent('status=all')
  })

  it('carries an edited report period into approvals', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalled())

    fireEvent.change(screen.getByDisplayValue('2026-08-01'), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByDisplayValue('2026-08-15'), { target: { value: '2026-07-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approvals' }))

    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalledWith(expect.objectContaining({
      start_date: '2026-07-16',
      end_date: '2026-07-31',
    })))
  })

  it('clears the approval-only cutoff when navigating from approvals to reports', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=approvals&start_date=2026-08-01&end_date=2026-08-15&through_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )
    await waitFor(() => expect(apiMock.getPendingApprovals).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Hours Reports' }))

    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('tab=reports'))
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('through_date=')
  })

  it('synchronizes status filters when same-route query parameters change', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Open denied report' }))

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      approval_status: 'denied',
      overtime_status: 'denied',
    })))

    fireEvent.click(screen.getByRole('button', { name: 'Open terminated report' }))

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      status: 'terminated',
    })))
    expect(await screen.findByDisplayValue('Terminated only')).toBeInTheDocument()
  })

  it('synchronizes every URL-backed report filter during same-route navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Open filtered report' }))

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 7,
      approval_group: 'maintenance',
      role: 'employee',
      clock_source: 'kiosk',
      entry_method: 'clock',
    })))
  })

  it('canonicalizes a routed employee ID before selecting and requesting it', async () => {
    apiMock.getUsers.mockResolvedValue({
      data: {
        users: [{
          id: 7,
          full_name: 'Seven Employee',
          display_name: 'Seven Employee',
          email: 'seven@example.com',
          employment_status: 'active',
        }],
      },
    })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15&user_id=007']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({ user_id: 7 })))
    expect(await screen.findByDisplayValue('Seven Employee')).toHaveValue('7')
    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('user_id=7'))
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('user_id=007')
  })

  it('opens the linked missing-category remediation report', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15&category_status=uncategorized']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({
      category_status: 'uncategorized',
    })))
    expect(screen.getByDisplayValue('Missing category (needs correction)')).toBeInTheDocument()
    expect(apiMock.getTimeEntries.mock.calls.every(([params]) => (
      params.time_category_id === undefined || Number.isFinite(params.time_category_id)
    ))).toBe(true)
  })

  it('ignores an older report response that resolves after a newer period', async () => {
    let resolveOldReport: (value: { data: HoursReportResponse }) => void = () => undefined
    const oldReportRequest = new Promise<{ data: HoursReportResponse }>((resolve) => {
      resolveOldReport = resolve
    })
    apiMock.getHoursReport
      .mockReset()
      .mockReturnValueOnce(oldReportRequest)
      .mockResolvedValueOnce({ data: makeHoursReport('2026-07-01', '2026-07-15', 22) })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )
    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: 'Open July report' }))
    expect(await screen.findAllByText('22.00')).not.toHaveLength(0)

    await act(async () => {
      resolveOldReport({ data: makeHoursReport('2026-08-01', '2026-08-15', 11) })
      await oldReportRequest
    })

    expect(screen.getAllByText('22.00')).not.toHaveLength(0)
    expect(screen.queryByText('11.00')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Payroll' })).toHaveAttribute(
      'href',
      '/admin/payroll?start_date=2026-07-01&end_date=2026-07-15',
    )
  })

  it('clears prior report results when the next request fails', async () => {
    apiMock.getHoursReport
      .mockReset()
      .mockResolvedValueOnce({ data: makeHoursReport('2026-08-01', '2026-08-15', 11) })
      .mockResolvedValueOnce({ error: 'This report contains too many detailed entries' })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    expect((await screen.findAllByText('11.00')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open July report' }))

    await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('11.00')).not.toBeInTheDocument())
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the hours report')
    expect(screen.getByRole('alert')).toHaveTextContent('This report contains too many detailed entries')
    expect(screen.queryByText('No hours match this range.')).not.toBeInTheDocument()
  })

  it('shows exact two-decimal report totals without rounding 11.95 to 11.9', async () => {
    const report = makeHoursReport('2026-08-01', '2026-08-15', 11.95)
    report.breakdowns = {
      by_category: [{ id: 1, key: 'admin', name: 'Admin Duties', total_hours: 11.95, regular_hours: 11.95, overtime_hours: 0, break_hours: 0, entries_count: 1 }],
      by_source: [{ source: 'mobile', total_hours: 11.95, regular_hours: 11.95, overtime_hours: 0, break_hours: 0, entries_count: 1 }],
    }
    apiMock.getHoursReport.mockResolvedValue({ data: report })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    expect((await screen.findAllByText('11.95')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('11.95h').length).toBeGreaterThan(0)
    expect(screen.queryByText('11.9')).not.toBeInTheDocument()
  })

  it('counts payment attestations separately from paid and payable report statuses', async () => {
    const report = makeHoursReport('2026-08-01', '2026-08-15', 8)
    report.summary = {
      ...report.summary,
      entries_count: 1,
      payroll_statuses: { payment_attested_pending_evidence: 1 },
    }
    apiMock.getHoursReport.mockResolvedValue({ data: report })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    const metric = await screen.findByText('Check evidence pending')
    expect(metric.parentElement).toHaveTextContent('1')
    expect(screen.getByText('Paid').parentElement).toHaveTextContent('0')
  })

  it('keeps payroll status and exact hours visible in the mobile employee summary', async () => {
    const report = makeHoursReport('2026-05-01', '2026-05-15', 6.1)
    report.summary = { ...report.summary, employee_count: 1, entries_count: 1 }
    report.employees = [{
      id: 5,
      email: 'kami@example.com',
      first_name: 'Kami',
      last_name: 'Lifecycle',
      display_name: 'Kami Lifecycle',
      full_name: 'Kami Lifecycle',
      role: 'employee',
      is_intern: false,
      employee_type: 'Staff',
      status: 'active',
      terminated_at: null,
      termination_effective_on: null,
      approval_group_label: 'Maintenance',
      approval_group_labels: ['Maintenance'],
      total_hours: 6.1,
      regular_hours: 6.1,
      overtime_hours: 0,
      break_hours: 0,
      entries_count: 1,
      days_worked: 1,
      first_work_date: '2026-05-01',
      last_work_date: '2026-05-01',
      ready: true,
      quality: { status: 'clear', missing_category_count: 0, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 },
      issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0 },
      categories: [{ id: 1, key: 'other', name: 'Other', total_hours: 6.1, regular_hours: 6.1, overtime_hours: 0, break_hours: 0, entries_count: 1 }],
      weeks: [],
      days: [{
        work_date: '2026-05-01', total_hours: 6.1, regular_hours: 6.1, overtime_hours: 0, break_hours: 0,
        entries: [{
          id: 52, work_date: '2026-05-01', start_time: '09:00', end_time: '15:06', formatted_start_time: '9:00 AM', formatted_end_time: '3:06 PM',
          total_hours: 6.1, regular_hours: 6.1, overtime_hours: 0, break_minutes: 0, description: null, entry_method: 'clock', clock_source: 'kiosk',
          approval_status: 'approved', approved_by: null, approved_at: null, overtime_status: 'none', time_category: { id: 1, key: 'other', name: 'Other' }, breaks: [],
          payroll_lifecycle: { status: 'partially_paid', label: 'Partially paid', payment_method: 'paper_check', payment_reference: '990610', settlements: [] },
          quality_flags: [],
        }],
      }],
    }]
    apiMock.getHoursReport.mockResolvedValue({ data: report })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-05-01&end_date=2026-05-15']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    const employeeCard = await screen.findByRole('button', { name: /Kami Lifecycle.*Partially paid.*Regular.*6\.10h.*Total.*6\.10h.*Ready/i })
    expect(employeeCard).toBeInTheDocument()
    expect(employeeCard).toHaveTextContent('Maintenance · Staff')
    fireEvent.click(employeeCard)
    expect(screen.getByRole('dialog', { name: 'Kami Lifecycle' })).toHaveTextContent('6.10h total')
    let finishReload!: (value: { data: HoursReportResponse }) => void
    apiMock.getHoursReport.mockImplementationOnce(() => new Promise((resolve) => { finishReload = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Open July report' }))
    await waitFor(() => expect(finishReload).toBeDefined())
    expect(screen.getByRole('dialog', { name: 'Kami Lifecycle' })).toHaveTextContent('6.10h total')
    const reloaded = { ...report, employees: [{ ...report.employees[0], total_hours: 9 }] }
    await act(async () => finishReload({ data: reloaded }))
    expect(screen.getByRole('dialog', { name: 'Kami Lifecycle' })).toHaveTextContent('9.00h total')
  })

  it('labels a legacy missing category as uncategorized in detailed entries', async () => {
    const report = makeHoursReport('2026-08-01', '2026-08-31', 3)
    report.ready = false
    report.quality = { status: 'needs_review', missing_category_count: 1, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 }
    report.summary = { ...report.summary, employee_count: 1, entries_count: 1, uncategorized_count: 1 }
    report.breakdowns.by_category = [{ id: null, key: null, name: 'Uncategorized', total_hours: 3, regular_hours: 3, overtime_hours: 0, break_hours: 0, entries_count: 1 }]
    report.breakdowns.by_source = [{ source: 'legacy', total_hours: 3, regular_hours: 3, overtime_hours: 0, break_hours: 0, entries_count: 1 }]
    report.employees = [{
      id: 2,
      email: 'legacy@example.com',
      first_name: 'Legacy',
      last_name: 'Entry',
      display_name: 'Legacy Entry',
      full_name: 'Legacy Entry',
      role: 'employee',
      is_intern: false,
      employee_type: 'Staff',
      status: 'active',
      terminated_at: null,
      termination_effective_on: null,
      total_hours: 3,
      regular_hours: 3,
      overtime_hours: 0,
      break_hours: 0,
      entries_count: 1,
      days_worked: 1,
      first_work_date: '2026-08-16',
      last_work_date: '2026-08-16',
      ready: false,
      quality: { status: 'needs_review', missing_category_count: 1, missing_description_count: 0, long_shift_count: 0, overlapping_entry_count: 0 },
      issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 1 },
      categories: report.breakdowns.by_category,
      weeks: [],
      days: [{
        work_date: '2026-08-16', total_hours: 3, regular_hours: 3, overtime_hours: 0, break_hours: 0,
        entries: [{
          id: 53, work_date: '2026-08-16', start_time: '09:00', end_time: '12:00', formatted_start_time: '9:00 AM', formatted_end_time: '12:00 PM',
          total_hours: 3, regular_hours: 3, overtime_hours: 0, break_minutes: 0, description: 'Legacy category remediation', entry_method: 'manual', clock_source: 'legacy',
          approval_status: null, approved_by: null, approved_at: null, overtime_status: 'none', time_category: null, breaks: [],
          quality_flags: ['missing_category'],
        }],
      }],
    }]
    apiMock.getHoursReport.mockResolvedValue({ data: report })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-31']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    const qualityPanel = (await screen.findByRole('heading', { name: 'Time data worth reviewing' })).closest('section')
    expect(qualityPanel).not.toBeNull()
    expect(within(qualityPanel!).getByText('Missing categories')).toBeInTheDocument()
    expect(within(qualityPanel!).getByText('1')).toBeInTheDocument()
    expect(screen.getAllByText('Missing category', { exact: true }).length).toBeGreaterThan(0)
    expect(await screen.findByRole('row', { name: /Sun, Aug 16 Legacy Entry.*Uncategorized.*3.00.*Edit/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('heading', { name: 'Edit Time Entry' })).toBeInTheDocument()
  })
})
