import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('labels a legacy missing category as uncategorized in detailed entries', async () => {
    const report = makeHoursReport('2026-08-01', '2026-08-31', 3)
    report.ready = false
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
      total_hours: 3,
      regular_hours: 3,
      overtime_hours: 0,
      break_hours: 0,
      entries_count: 1,
      ready: false,
      issues: { pending_count: 0, denied_count: 0, pending_overtime_count: 0, denied_overtime_count: 0, open_clock_count: 0, uncategorized_count: 1 },
      categories: report.breakdowns.by_category,
      weeks: [],
      days: [{
        work_date: '2026-08-16', total_hours: 3, regular_hours: 3, overtime_hours: 0, break_hours: 0,
        entries: [{
          id: 53, work_date: '2026-08-16', start_time: '09:00', end_time: '12:00', formatted_start_time: '9:00 AM', formatted_end_time: '12:00 PM',
          total_hours: 3, regular_hours: 3, overtime_hours: 0, break_minutes: 0, description: 'Legacy category remediation', entry_method: 'manual', clock_source: 'legacy',
          approval_status: null, approved_by: null, approved_at: null, overtime_status: 'none', time_category: null, breaks: [],
        }],
      }],
    }]
    apiMock.getHoursReport.mockResolvedValue({ data: report })

    render(
      <MemoryRouter initialEntries={['/admin/time?tab=reports&start_date=2026-08-01&end_date=2026-08-31']}>
        <TimeRouteHarness />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('row', { name: /Sun, Aug 16 Legacy Entry.*Uncategorized.*3.00.*Edit/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('heading', { name: 'Edit Time Entry' })).toBeInTheDocument()
  })
})
