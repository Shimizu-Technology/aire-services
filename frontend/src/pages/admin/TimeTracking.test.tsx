vi.mock('../../components/time-tracking/PayrollCutoffNotice', () => ({ default: () => null }))
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      <button type="button" onClick={() => { const next = new URLSearchParams(location.search); next.set('entry_id', '91'); navigate(location.pathname + '?' + next) }}>Open next linked entry</button>
      <button type="button" onClick={() => { const next = new URLSearchParams(location.search); next.set('user_id', '8'); navigate(location.pathname + '?' + next) }}>Change linked employee</button>
      <button type="button" onClick={() => { const next = new URLSearchParams(location.search); next.delete('tab'); navigate(location.pathname + '?' + next) }}>Open linked entry view</button>
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

function linkedFixture(id = 90) {
  return {
    id, version: 7, work_date: '2026-08-20', start_time: '08:00', end_time: '12:00',
    formatted_start_time: '8:00 AM', formatted_end_time: '12:00 PM', hours: 4, total_hours: 4,
    regular_hours: 4, overtime_hours: 0, break_minutes: 0, description: `Loaded entry ${id}`,
    entry_method: 'clock', clock_source: 'kiosk', status: 'completed', approval_status: 'approved',
    approved_by: null, approved_at: null, overtime_status: 'none', time_category: { id: 3, name: 'Operations' },
    user: { id: 7, full_name: 'Casey Employee' }, breaks: [], quality_flags: [],
  }
}

function prepareLinkedReport() {
  const entry = linkedFixture()
  const report = makeHoursReport('2026-08-16', '2026-08-31', 4)
  report.employees = [{
    id: 7, email: 'casey@example.test', first_name: 'Casey', last_name: 'Employee', display_name: 'Casey Employee', full_name: 'Casey Employee',
    role: 'employee', is_intern: false, status: 'active', terminated_at: null, termination_effective_on: null,
    total_hours: 4, regular_hours: 4, overtime_hours: 0, break_hours: 0, entries_count: 1, days_worked: 1,
    first_work_date: entry.work_date, last_work_date: entry.work_date, ready: true,
    quality: report.quality, issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0 },
    categories: [], weeks: [], days: [{ work_date: entry.work_date, total_hours: 4, regular_hours: 4, overtime_hours: 0, break_hours: 0, entries: [{ ...entry, quality_flags: [] }] }],
  }]
  apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: entry } })
  apiMock.getHoursReport.mockResolvedValue({ data: report })
  apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [{ id: 3, name: 'Operations' }] } })
  apiMock.getUsers.mockResolvedValue({ data: { users: [{ id: 7, display_name: 'Casey Employee', time_category_ids: [3] }] } })
  apiMock.updateTimeEntry.mockResolvedValue({ data: { time_entry: { ...entry, description: 'Saved change' } } })
  const query = new URLSearchParams({ tab: 'reports', start_date: report.start_date, end_date: report.end_date, user_id: '7', entry_id: '90', return_to: '/admin/users/7?tab=hours&period=2026-08-16' })
  render(<MemoryRouter initialEntries={[`/admin/time?${query}`]}><TimeRouteHarness /></MemoryRouter>)
}

async function saveLinkedReportEdit() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const dialog = screen.getByRole('dialog', { name: 'Edit Time Entry' })
  fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Saved change' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }))
  await waitFor(() => expect(apiMock.updateTimeEntry).toHaveBeenCalledTimes(1))
}

function cutoffEntryId() {
  return new URL(screen.getByRole('link', { name: 'Open payroll cutoffs' }).getAttribute('href')!, 'https://local.invalid').searchParams.get('entry_id')
}

describe('TimeTracking routed report periods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getTimeEntry.mockReset().mockResolvedValue({ error: 'No linked fixture', status: 404 })
    apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    apiMock.getCurrentUser.mockResolvedValue({ data: { user: { id: 1, is_admin: true } } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { approval_groups: [] } })
    apiMock.getPendingApprovals.mockResolvedValue({ data: { pending_entries: [], count: 0, summary: null } })
    apiMock.getHoursReport.mockResolvedValue({ error: 'No report rows in this test' })
  })

  it.each([
    ['2026-10-24T14:30:00Z', '2026-10-25', '2026-10-25', '2026-10-01'],
    ['2026-10-31T14:30:00Z', '2026-11-01', '2026-11-01', '2026-11-01'],
  ])('defaults entries and reports to Guam at %s', async (instant, today, week, monthStart) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(instant))
    try {
      render(<MemoryRouter initialEntries={['/admin/time']}><TimeRouteHarness /></MemoryRouter>)
      await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ week })))
      fireEvent.click(screen.getByRole('button', { name: 'Log Time' }))
      expect(await screen.findByDisplayValue(today)).toHaveAttribute('type', 'date')
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      fireEvent.click(screen.getByRole('button', { name: 'Hours Reports' }))
      await waitFor(() => expect(apiMock.getHoursReport).toHaveBeenCalledWith(expect.objectContaining({ start_date: monthStart, end_date: today })))
    } finally {
      vi.useRealTimers()
    }
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

  it.each(['network', 'server'])('retains the same linked context after an edit refresh %s failure and retries only the read', async (failure) => {
    prepareLinkedReport()
    await waitFor(() => expect(cutoffEntryId()).toBe('90'))
    let finish!: (value: unknown) => void
    let reject!: (reason: Error) => void
    apiMock.getTimeEntry.mockImplementationOnce(() => new Promise((resolve, rejectPromise) => { finish = resolve; reject = rejectPromise }))
    await saveLinkedReportEdit()
    expect(await screen.findByText(/Refreshing linked time entry/)).toBeInTheDocument()
    expect(cutoffEntryId()).toBe('90')
    await act(async () => { if (failure === 'network') reject(new Error('Network unavailable')); else finish({ error: 'Read temporarily unavailable', status: 500 }) })
    const retainedContextAlert = screen.getAllByRole('alert').find((element) => element.textContent?.includes('The last loaded review context is retained'))
    expect(retainedContextAlert).toBeInTheDocument()
    expect(cutoffEntryId()).toBe('90')
    expect(screen.getByRole('link', { name: 'Back to employee review' })).toHaveAttribute('href', '/admin/users/7?tab=hours&period=2026-08-16')
    fireEvent.click(screen.getByRole('button', { name: 'Open linked entry view' }))
    const retained = await screen.findByRole('region', { name: 'Linked time entry' })
    expect(retained).toHaveTextContent('Loaded entry 90')
    expect(within(retained).getByRole('button', { name: 'Show this work day' })).toBeDisabled()
    const restored = { ...linkedFixture(), description: 'Current saved record', hours: 5 }
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: restored } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry linked entry' }))
    await waitFor(() => expect(retained).toHaveTextContent('Current saved record'))
    expect(retained).toHaveTextContent('5.00h')
    expect(within(retained).getByRole('button', { name: 'Show this work day' })).toBeEnabled()
    expect(screen.queryByText(/The last loaded review context is retained/)).not.toBeInTheDocument()
    expect(apiMock.getTimeEntry).toHaveBeenCalledTimes(3)
    expect(apiMock.updateTimeEntry).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('location-search')).toHaveTextContent('entry_id=90')
    expect(screen.getByTestId('location-search')).toHaveTextContent('return_to=')
  })

  it('drops prior context on an entry change and ignores its later refresh response', async () => {
    prepareLinkedReport()
    await waitFor(() => expect(cutoffEntryId()).toBe('90'))
    let finishOld!: (value: unknown) => void
    apiMock.getTimeEntry.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    await saveLinkedReportEdit()
    await screen.findByText(/Refreshing linked time entry/)
    let finishNew!: (value: unknown) => void
    apiMock.getTimeEntry.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Open next linked entry' }))
    expect(cutoffEntryId()).toBeNull()
    await screen.findByText('Loading linked time entry…')
    await act(async () => { finishNew({ data: { time_entry: linkedFixture(91) } }) })
    await waitFor(() => expect(cutoffEntryId()).toBe('91'))
    await act(async () => { finishOld({ data: { time_entry: { ...linkedFixture(), description: 'Stale response' } } }) })
    expect(cutoffEntryId()).toBe('91')
    fireEvent.click(screen.getByRole('button', { name: 'Open linked entry view' }))
    expect(await screen.findByRole('region', { name: 'Linked time entry' })).toHaveTextContent('Loaded entry 91')
    expect(screen.queryByText('Stale response')).not.toBeInTheDocument()
  })

  it('clears prior entry content when the employee scope changes even before its read completes', async () => {
    prepareLinkedReport()
    await waitFor(() => expect(cutoffEntryId()).toBe('90'))
    apiMock.getTimeEntry.mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Change linked employee' }))
    expect(cutoffEntryId()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open linked entry view' }))
    expect(screen.queryByRole('region', { name: 'Linked time entry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show this work day' })).not.toBeInTheDocument()
  })

  it.each([401, 403, 404])('clears previously loaded linked data on an authoritative %s refresh denial', async (status) => {
    prepareLinkedReport()
    await waitFor(() => expect(cutoffEntryId()).toBe('90'))
    apiMock.getTimeEntry.mockResolvedValue({ error: 'Linked entry unavailable to this account', status })
    await saveLinkedReportEdit()
    await screen.findByText('Linked entry unavailable to this account')
    expect(cutoffEntryId()).toBeNull()
    expect(screen.queryByText(/last loaded review context is retained/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open linked entry view' }))
    expect(screen.queryByRole('region', { name: 'Linked time entry' })).not.toBeInTheDocument()
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

  it.each(['Prepare payroll cutoff', 'Open payroll cutoffs'])('keeps the selected report and employee context through %s', async (name) => {
    apiMock.getHoursReport.mockResolvedValue({ data: makeHoursReport('2028-02-16', '2028-02-29', 0) })
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: { id: 90, work_date: '2028-02-20', hours: 8, user: { id: 7 }, approval_status: 'approved' } } })
    const returnTo = '/admin/users/7?tab=hours&period=2028-02-16'
    const query = new URLSearchParams({ tab: 'reports', start_date: '2028-02-16', end_date: '2028-02-29', user_id: '7', entry_id: '90', return_to: returnTo })
    render(<MemoryRouter initialEntries={[`/admin/time?${query}`]}><TimeRouteHarness /></MemoryRouter>)

    const link = await screen.findByRole('link', { name })
    await waitFor(() => expect(new URL(link.getAttribute('href')!, 'https://local.invalid').searchParams.get('entry_id')).toBe('90'))
    const href = new URL(link.getAttribute('href')!, 'https://local.invalid')
    expect(href.pathname).toBe('/admin/payroll')
    expect(Object.fromEntries(href.searchParams)).toEqual({ start_date: '2028-02-16', end_date: '2028-02-29', user_id: '7', entry_id: '90', return_to: returnTo })
    fireEvent.click(link)
    expect(screen.getByTestId('location-search')).toHaveTextContent(href.search)
  })

  it.each(['employee', 'period'])('drops the old linked entry when the selected report %s changes', async (scope) => {
    apiMock.getUsers.mockResolvedValue({ data: { users: [{ id: 7, display_name: 'Casey' }, { id: 8, display_name: 'Alex' }] } })
    apiMock.getHoursReport.mockResolvedValue({ data: makeHoursReport('2028-02-16', '2028-02-29', 0) })
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: { id: 90, work_date: '2028-02-20', hours: 8, user: { id: 7 }, approval_status: 'approved' } } })
    const returnTo = '/admin/users/7?tab=hours&period=2028-02-16'
    const query = new URLSearchParams({ tab: 'reports', start_date: '2028-02-16', end_date: '2028-02-29', user_id: '7', entry_id: '90', return_to: returnTo })
    render(<MemoryRouter initialEntries={[`/admin/time?${query}`]}><TimeRouteHarness /></MemoryRouter>)
    const link = await screen.findByRole('link', { name: 'Open payroll cutoffs' })
    await waitFor(() => expect(new URL(link.getAttribute('href')!, 'https://local.invalid').searchParams.get('entry_id')).toBe('90'))

    if (scope === 'employee') {
      await act(async () => { fireEvent.change(screen.getByRole('option', { name: 'Alex' }).parentElement!, { target: { value: '8' } }) })
    } else {
      await act(async () => { fireEvent.change(screen.getByDisplayValue('2028-02-29'), { target: { value: '2028-03-15' } }) })
      await act(async () => { fireEvent.change(screen.getByDisplayValue('2028-02-16'), { target: { value: '2028-03-01' } }) })
    }
    const updated = new URL(link.getAttribute('href')!, 'https://local.invalid').searchParams
    expect(updated.has('entry_id')).toBe(false)
    expect(updated.get('return_to')).toBe(returnTo)
    expect(updated.get('user_id')).toBe(scope === 'employee' ? '8' : '7')
    expect(updated.get('start_date')).toBe(scope === 'employee' ? '2028-02-16' : '2028-03-01')
    expect(updated.get('end_date')).toBe(scope === 'employee' ? '2028-02-29' : '2028-03-15')
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

  it('expands mobile entry cards and returns from Edit without losing the report context', async () => {
    const report = makeHoursReport('2026-08-01', '2026-08-15', 4)
    const first: HoursReportEntry = {
      id: 90, version: 7, work_date: '2026-08-05', start_time: '08:00', end_time: '12:00',
      formatted_start_time: '8:00 AM', formatted_end_time: '12:00 PM', total_hours: 4, regular_hours: 4,
      overtime_hours: 0, break_minutes: 15, description: 'Recorded work shift', entry_method: 'clock', clock_source: 'kiosk',
      approval_status: 'approved', approved_by: null, approved_at: null, overtime_status: 'none',
      time_category: { id: 3, name: 'Operations' }, breaks: [{ id: 1, start_time: '10:00', end_time: '10:15', duration_minutes: 15 }], quality_flags: [],
      payroll_lifecycle: { status: 'ready_for_cutoff', label: 'Ready for cutoff', payment_method: null, payment_reference: null, settlements: [] },
    }
    const pending: HoursReportEntry = { ...first, id: 91, start_time: '14:00', end_time: '16:00', formatted_start_time: '2:00 PM', formatted_end_time: '4:00 PM', total_hours: 2, regular_hours: 0, break_minutes: 0, description: 'Pending additional work', entry_method: 'manual', clock_source: 'admin', approval_status: 'pending', overtime_status: 'pending', breaks: [], payroll_lifecycle: { status: 'awaiting_approval', label: 'Awaiting approval', payment_method: null, payment_reference: null, settlements: [] } }
    report.summary = { ...report.summary, employee_count: 1, entries_count: 1, pending_count: 1 }
    report.employees = [{
      id: 7, email: 'casey@example.test', first_name: 'Casey', last_name: 'Employee', display_name: 'Casey Employee',
      full_name: 'Casey Employee', role: 'employee', is_intern: false, status: 'active', terminated_at: null,
      termination_effective_on: null, total_hours: 4, regular_hours: 4, overtime_hours: 0, break_hours: 0.25,
      entries_count: 1, days_worked: 1, first_work_date: first.work_date, last_work_date: first.work_date, ready: true,
      issues: { pending_count: 1, denied_count: 0, pending_overtime_count: 1, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0 },
      quality: report.quality, categories: [], weeks: [],
      days: [{ work_date: first.work_date, total_hours: 4, regular_hours: 4, overtime_hours: 0, break_hours: 0.25, entries: [first] }], excluded_entries: [pending],
    }]
    apiMock.getHoursReport.mockResolvedValue({ data: report })
    apiMock.getUsers.mockResolvedValue({ data: { users: [{ id: 7, email: 'casey@example.test', display_name: 'Casey Employee', role: 'employee', time_category_ids: [3] }] } })
    apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [{ id: 3, name: 'Operations' }] } })
    const interaction = userEvent.setup()
    render(<MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15&user_id=7']}><TimeRouteHarness /></MemoryRouter>)
    const group = await screen.findByRole('article', { name: /Entries for Casey Employee/ })
    const mobile = screen.getByRole('region', { name: 'Detailed entries on mobile' })
    expect(within(mobile).queryByRole('table')).not.toBeInTheDocument()
    const expand = within(group).getByRole('button', { name: /Review 2 entries for Casey Employee/ })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    const controlledDetails = document.getElementById(expand.getAttribute('aria-controls')!)
    expect(controlledDetails).toHaveAttribute('hidden')
    expect(within(group).queryByRole('button', { name: 'Edit time entry 90 for Casey Employee' })).not.toBeInTheDocument()
    expect(group).toHaveTextContent('6.00h')
    expect(group).toHaveTextContent('15m')
    await interaction.click(expand)
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    expect(group).toHaveTextContent('8:00 AM – 12:00 PM')
    expect(group).toHaveTextContent('Operations')
    expect(group).toHaveTextContent('kiosk · clock')
    expect(group).toHaveTextContent('admin · manual')
    expect(group).toHaveTextContent('Pending additional work')
    expect(group).toHaveTextContent('OT pending')
    expect(group).toHaveTextContent('Awaiting approval')
    expect(group).toHaveTextContent('Break 10:00–10:15 · 15m')
    const edit = within(group).getByRole('button', { name: 'Edit time entry 90 for Casey Employee' })
    await interaction.click(edit)
    const dialog = screen.getByRole('dialog', { name: 'Edit Time Entry' })
    expect(within(dialog).getByLabelText('Start Time *')).toHaveValue('08:00')
    const description = within(dialog).getByLabelText('Description')
    await interaction.clear(description)
    await interaction.type(description, 'Unsaved review note')
    await interaction.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Edit Time Entry' })).not.toBeInTheDocument()
    expect(edit).toHaveFocus()
    expect(expand).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('location-search')).toHaveTextContent('start_date=2026-08-01')
    expect(screen.getByTestId('location-search')).toHaveTextContent('end_date=2026-08-15')
    expect(screen.getByTestId('location-search')).toHaveTextContent('user_id=7')
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
  })

  it.each(['{Enter}', ' '])('opens the desktop employee review by keyboard %s and restores focus on Escape', async (key) => {
    const report = makeHoursReport('2026-08-01', '2026-08-15', 9)
    report.summary = { ...report.summary, employee_count: 1, entries_count: 1 }
    report.employees = [{
      id: 7, email: 'casey@example.test', first_name: 'Casey', last_name: 'Employee', display_name: 'Casey Employee',
      full_name: 'Casey Employee', role: 'employee', is_intern: false, status: 'active', terminated_at: null,
      termination_effective_on: null, total_hours: 9, regular_hours: 9, overtime_hours: 0, break_hours: 0,
      entries_count: 1, days_worked: 1, first_work_date: '2026-08-05', last_work_date: '2026-08-05', ready: true,
      issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 0 },
      quality: report.quality, categories: [], weeks: [], days: [], excluded_entries: [],
    }]
    apiMock.getHoursReport.mockResolvedValue({ data: report })
    const keyboard = userEvent.setup()
    render(<MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}><TimeRouteHarness /></MemoryRouter>)
    const reviewButton = await screen.findByRole('button', { name: 'Review hours for Casey Employee' })
    expect(reviewButton).toHaveAttribute('type', 'button')
    expect(reviewButton.tabIndex).toBe(0)
    reviewButton.focus()
    await keyboard.keyboard(key)
    const drawer = screen.getByRole('dialog', { name: 'Casey Employee' })
    expect(drawer).toHaveTextContent('9.00h total')
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus())
    await keyboard.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Casey Employee' })).not.toBeInTheDocument()
    expect(reviewButton).toHaveFocus()
  })

  it.each([
    { label: 'valid timestamps', attestedAt: '2026-09-18T18:00:00Z', resolvedAt: '2026-09-20T14:30:00Z', malformed: false },
    { label: 'unparseable timestamps', attestedAt: 'not-a-timestamp', resolvedAt: '', malformed: true },
    { label: 'null and missing timestamps', attestedAt: null, resolvedAt: undefined, malformed: true },
    { label: 'impossible calendar dates', attestedAt: '2026-02-30T00:00:00Z', resolvedAt: '2026-04-31T00:00:00Z', malformed: true },
  ])('keeps payroll status and exact hours visible with $label', async ({ attestedAt, resolvedAt, malformed }) => {
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
          payroll_lifecycle: { status: 'partially_paid', label: 'Partially paid', payment_method: 'paper_check', payment_reference: '990610', settlements: [],
            resolved_payment_report: { id: 'report-52', attested_at: attestedAt as string,
              reason: 'Owner reported the original work paid; exact check evidence was pending.',
              resolved_at: resolvedAt as string, resolution_reason: 'Matched the original exact issued payment evidence.',
              manual_allocation_id: 'allocation-52', issued_event_id: 'issue-52' } },
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
    expect(screen.getByRole('dialog', { name: 'Kami Lifecycle' })).toHaveTextContent('Matched payment report')
    expect(screen.getByRole('dialog', { name: 'Kami Lifecycle' })).toHaveTextContent(malformed ? 'Reported Date unknown · matched to issued evidence Date unknown' : 'Reported Sat, Sep 19 · matched to issued evidence Mon, Sep 21')
    expect(screen.getByRole('dialog', { name: 'Kami Lifecycle' })).not.toHaveTextContent('Invalid Date')
    expect(screen.getByRole('dialog', { name: 'Kami Lifecycle' })).toHaveTextContent('Original report retained. Current payment status is shown above.')
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
  it.each([0, 2])('shows every readiness cause with %i missing categories and an interval hold', async (missing) => {
    const report = makeHoursReport('2026-08-01', '2026-08-15', 4)
    report.ready = false
    report.summary = { ...report.summary, allocation_hold_count: 1, uncategorized_count: missing }
    apiMock.getHoursReport.mockResolvedValue({ data: report })
    render(<MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-15']}><TimeRouteHarness /></MemoryRouter>)
    await screen.findByText('Action required before cutoff')
    expect(screen.getByText(/Overnight time or break placement needs administrator review/)).toBeInTheDocument()
    if (missing > 0) {
      expect(screen.getByText(/2 approved entries are missing a work category/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Show entries missing categories' })).toBeInTheDocument()
    } else {
      expect(screen.queryByRole('button', { name: 'Show entries missing categories' })).not.toBeInTheDocument()
    }
  })

})
