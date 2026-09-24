import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TimeTracking from './TimeTracking'
import type { HoursReportResponse } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(),
  getTimeCategories: vi.fn(),
  getUsers: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getPendingApprovals: vi.fn(),
  getHoursReport: vi.fn(),
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
          payroll_lifecycle: { status: 'payment_issued', label: 'Paid', payment_method: 'paper_check', payment_reference: '990610', settlements: [] },
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

    const employeeCard = await screen.findByRole('button', { name: /Kami Lifecycle.*Paid.*Regular.*6\.10h.*Total.*6\.10h.*Ready/i })
    expect(employeeCard).toBeInTheDocument()
    expect(employeeCard).toHaveTextContent('Maintenance · Staff')
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
